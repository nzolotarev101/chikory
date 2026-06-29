/**
 * The journaled agent loop (WP-121) — Temporal workflow, durable-runner.md.
 *
 * Determinism rules: zero I/O, zero Date.now()/random outside Temporal APIs;
 * every side effect (executor step, judge pass, journal write) is an
 * activity, memoized in event history. A worker crash → deterministic
 * replay from history (DX-3 for free); journaled steps are never
 * re-executed (WP-123).
 */
import {
  condition,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
  workflowInfo,
} from "@temporalio/workflow";

import type { RunnerActivities } from "../runner/activities.js";
import {
  QUERY_STATUS,
  SIGNAL_APPROVE,
  SIGNAL_CANCEL,
  SIGNAL_INJECT,
  SIGNAL_TOP_UP,
  type ApproveDecision,
} from "../runner/api.js";
import {
  budgetBreached,
  estimateNextStepCost,
  estimateNextStepTokens,
  tokenBudgetBreached,
} from "../runner/budget.js";
import {
  decideContextWindowPacing,
  estimateResidentContextTokens,
  estimateTokensFromText,
  buildResidentContextParts,
  type ContextWindowPacingPolicy,
} from "../runner/pacing.js";
import { resolveContextWindowForSpec } from "../runner/context-window.js";
import type {
  ArtifactRef,
  ChainNodeHandoff,
  Checkpoint,
  ContextBundle,
  JudgeVerdict,
  RunStatus,
  RunStatusReport,
  StepLimits,
  TaskSpec,
} from "../types.js";
import { shouldPointerize, type MemoryPointerPolicy } from "../runner/memory-pointer.js";
import { isCompletionMilestone } from "./judge-trigger.js";

/** Step bound when the TaskSpec doesn't say otherwise (executors.md). */
export const DEFAULT_STEP_LIMITS: StepLimits = { maxSeconds: 600 };
/** Recall tier: how many step summaries ride along in context (CM-4). */
export const RECENT_STEPS_WINDOW = 5;
/**
 * Memory Pointer threshold (WP-202 / CM-3): a step output larger than this is
 * surfaced into the next step's context as a short pointer (the executor asks
 * for excerpts) rather than left to the one-line summary alone. Hardcoded
 * default — the `DEFAULT_STEP_LIMITS` precedent; a TaskSpec knob can come later.
 */
export const DEFAULT_MEMORY_POLICY: MemoryPointerPolicy = { maxInlineBytes: 16384 };
const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;
const DEFAULT_PACING_POLICY: ContextWindowPacingPolicy = { compactAtFraction: 0.8 };
/** How many recent artifact pointers ride along in context (bound growth). */
export const CARRIED_REFS_WINDOW = 6;

const activities = proxyActivities<RunnerActivities>({
  // Must exceed StepLimits.maxSeconds — the adapter owns the step bound.
  startToCloseTimeout: "15 minutes",
  // Activities heartbeat every 1s; a kill -9'd worker is detected fast and
  // the activity retried on the next worker (WP-123).
  heartbeatTimeout: "15 seconds",
  retry: {
    initialInterval: "1 second",
    backoffCoefficient: 2,
    maximumInterval: "30 seconds",
  },
});

export const cancelSignal = defineSignal(SIGNAL_CANCEL);
export const injectSignal = defineSignal<[string]>(SIGNAL_INJECT);
export const approveSignal = defineSignal<[ApproveDecision]>(SIGNAL_APPROVE);
export const topUpSignal = defineSignal<[{ amountUsd: number }]>(SIGNAL_TOP_UP);
export const statusQuery = defineQuery<RunStatusReport>(QUERY_STATUS);

/** CG-1 loop-breaker: N consecutive FAILED steps → escalate, never spin. */
export const MAX_CONSECUTIVE_FAILURES = 3;

function allCriteriaPass(verdict: JudgeVerdict | undefined): boolean {
  return (
    verdict !== undefined &&
    verdict.form.criterionResults.length > 0 &&
    verdict.form.criterionResults.every((r) => r.pass)
  );
}

/** workflowId = run-id (durable-runner.md Temporal mapping). */
export async function agentLoop(spec: TaskSpec): Promise<RunStatus> {
  const runId = workflowInfo().workflowId;

  let status: RunStatus = "RUNNING";
  let stepIndex = 0;
  let spentUsd = 0;
  let spentTokens = 0;
  let budgetUsd = spec.budgetUsd;
  let judgeIndex = 0;
  let injectionIndex = 0;
  let budgetEventIndex = 0;
  let seamEventIndex = 0;
  let pacingEventIndex = 0;
  let escalationIndex = 0;
  let consecutiveFailures = 0;
  let parkInjected = false;
  let badDiffInjected = false;
  let cancelRequested = false;
  let lastVerdict: { kind: JudgeVerdict["kind"]; atStep: number } | undefined;
  let lastGoodCheckpointId: string | undefined;
  let judgeFeedback: string | undefined;
  let failure: { reason: string; lastCheckpoint: string } | undefined;
  const recentSummaries: string[] = [];
  const stepCosts: number[] = [];
  const stepTokens: number[] = [];
  // Memory Pointer carrier (WP-202/203, CM-3): pointers to large prior-step
  // outputs and the latest compaction digest, surfaced into each step's
  // context so externalized material is recoverable without rotting context.
  const carriedRefs: ArtifactRef[] = [];
  const pendingInjections: string[] = [];
  const pendingTopUps: number[] = [];
  const pendingApprovals: ApproveDecision[] = [];
  const checkpoints: Checkpoint[] = [];

  setHandler(cancelSignal, () => {
    cancelRequested = true;
  });
  setHandler(injectSignal, (text) => {
    pendingInjections.push(text);
  });
  setHandler(topUpSignal, ({ amountUsd }) => {
    pendingTopUps.push(amountUsd);
  });
  setHandler(approveSignal, (decision) => {
    pendingApprovals.push(decision);
  });
  setHandler(statusQuery, () => ({
    status,
    currentStep: stepIndex,
    spentUsd,
    budgetUsd,
    lastVerdict,
    checkpoints,
    failure,
  }));

  const maxSteps = spec.maxSteps ?? 100;

  async function seal(
    terminal: "SUCCESS" | "FAILED" | "CANCELLED",
    reason?: string,
  ): Promise<RunStatus> {
    const lastCheckpoint = checkpoints[checkpoints.length - 1]?.id ?? "";
    let handoff: ChainNodeHandoff | undefined;
    if (terminal === "SUCCESS" && spec.chainLink !== undefined) {
      const published = await activities.publishChainHandoff({ runId });
      if (published.status === "FAILED") return seal("FAILED", published.reason);
      handoff = published.handoff;
    }
    if (terminal === "FAILED") {
      failure = { reason: reason ?? "unknown", lastCheckpoint };
    }
    await activities.sealRun({
      runId,
      status: terminal,
      reason,
      lastCheckpoint,
      ...(handoff !== undefined ? { handoff } : {}),
    });
    status = terminal;
    return status;
  }

  const prepared = await activities.prepareRun({ runId, spec });
  if (prepared.status === "FAILED") return seal("FAILED", prepared.reason);
  const { baseCommit } = prepared;
  // Judge diffs cover everything since the last verdict (or the run base).
  let sinceCommit = baseCommit;

  for (;;) {
    if (cancelRequested) return seal("CANCELLED", "cancelled by user");
    if (stepIndex >= maxSteps) {
      return seal("FAILED", `maxSteps (${maxSteps}) reached without meeting acceptance criteria`);
    }

    // WP-243 deterministic park-injection seam (dogfood/test-only). Force the
    // real SUSPEND→top-up path at a chosen step so WP-241's chain surfacing +
    // `chikory chain resume` are provable without a non-deterministic budget/
    // ESCALATE trigger (F-44). The value rides in spec.debug (frozen workflow
    // input → replay-safe; never read from env in-workflow). Fires once; the
    // journaled halt/top_up is indistinguishable from a real budget park to
    // `childParkedState`, so the whole WP-241 path exercises unchanged.
    if (!parkInjected && spec.debug?.parkBeforeStep === stepIndex) {
      parkInjected = true;
      await activities.recordBudgetEvent({
        runId,
        budgetEventIndex: budgetEventIndex++,
        event: "halt",
        cause: "debug",
        remainingUsd: budgetUsd - spentUsd,
        details: { injected: 1, atStep: stepIndex, spentUsd, budgetUsd },
      });
      status = "SUSPENDED";
      await condition(() => pendingTopUps.length > 0 || cancelRequested);
      if (cancelRequested) return seal("CANCELLED", "cancelled while halted (debug park)");
      const added = pendingTopUps.splice(0).reduce((a, b) => a + b, 0);
      budgetUsd += added;
      await activities.recordBudgetEvent({
        runId,
        budgetEventIndex: budgetEventIndex++,
        event: "top_up",
        remainingUsd: budgetUsd - spentUsd,
        details: { addedUsd: added, budgetUsd },
      });
      status = "RUNNING";
    }

    // Budget gate (WP-124, CG-2): conservative pre-step estimate; breach →
    // clean HALT(BUDGET) on the last checkpoint, suspended at zero compute
    // until `chikory resume --add-budget` tops up (DX-7).
    const estimate = estimateNextStepCost(stepCosts);
    if (budgetBreached(spentUsd, budgetUsd, estimate)) {
      await activities.recordBudgetEvent({
        runId,
        budgetEventIndex: budgetEventIndex++,
        event: "halt",
        remainingUsd: budgetUsd - spentUsd,
        details: { estimateUsd: estimate, spentUsd, budgetUsd, atStep: stepIndex },
      });
      status = "SUSPENDED";
      await condition(() => pendingTopUps.length > 0 || cancelRequested);
      if (cancelRequested) return seal("CANCELLED", "cancelled while halted at budget cap");
      const added = pendingTopUps.splice(0).reduce((a, b) => a + b, 0);
      budgetUsd += added;
      await activities.recordBudgetEvent({
        runId,
        budgetEventIndex: budgetEventIndex++,
        event: "top_up",
        remainingUsd: budgetUsd - spentUsd,
        details: { addedUsd: added, budgetUsd },
      });
      status = "RUNNING";
      continue; // re-run the gate with the new budget
    }

    // Token gate (WP-218, CG-2): mirrors the USD gate for token-denominated
    // budgets — the governance that makes spend real on $0-metered
    // subscription runs where the USD meter reads $0 (F-9). Only armed when
    // the spec opts in via `budgetTokens`. Unlike money, tokens have no
    // top-up channel, so a breach is a hard cap: record the token HALT on the
    // ledger and seal a resumable FAILED (re-launch with a higher budget).
    if (spec.budgetTokens !== undefined) {
      const tokenEstimate = estimateNextStepTokens(stepTokens);
      if (tokenBudgetBreached(spentTokens, spec.budgetTokens, tokenEstimate)) {
        await activities.recordBudgetEvent({
          runId,
          budgetEventIndex: budgetEventIndex++,
          event: "halt",
          cause: "tokens",
          remainingUsd: budgetUsd - spentUsd,
          remainingTokens: spec.budgetTokens - spentTokens,
          details: {
            estimateTokens: tokenEstimate,
            spentTokens,
            budgetTokens: spec.budgetTokens,
            atStep: stepIndex,
          },
        });
        return seal(
          "FAILED",
          `token budget exhausted: ${spentTokens}/${spec.budgetTokens} tokens spent, ` +
            `next step ~${Math.round(tokenEstimate)} tokens (re-launch with a higher budgetTokens)`,
        );
      }
    }

    // Drain pending mid-run corrections into this step's context (WP-212).
    const injections = pendingInjections.splice(0);
    for (const text of injections) {
      await activities.recordInjection({
        runId,
        injectionIndex: injectionIndex++,
        atStep: stepIndex,
        text,
      });
    }

    const context: ContextBundle = {
      goal: spec.goal,
      acceptanceCriteria: spec.acceptanceCriteria,
      planItem: spec.goal,
      notes: {},
      recentSteps: recentSummaries.slice(-RECENT_STEPS_WINDOW),
      judgeFeedback,
      injections,
      memoryRefs: carriedRefs.slice(-CARRIED_REFS_WINDOW),
    };

    const record = await activities.executeStep({
      runId,
      stepIndex,
      instruction: spec.goal,
      context,
      limits: DEFAULT_STEP_LIMITS,
    });

    // WP-244 deterministic judge-catch seam (dogfood/test-only). Right after
    // the chosen step's executor runs, overwrite a workspace file with
    // known-wrong content so the real-time judge MUST catch the regression on
    // the pass that immediately follows — via its acceptance `check` (JD-3),
    // whose exit code deterministically overrides the LLM form. Proves the
    // Agent-as-a-Judge true-positive catch on demand, independent of executor
    // skill (dogfood-045 F-46, the judge-catch analog of WP-243's park seam).
    // Fires once; rides spec.debug (frozen workflow input → replay-safe, never
    // read from env in-workflow); the idempotent activity leaves the bad diff
    // uncommitted for the judge's `git diff` evidence + check.
    if (!badDiffInjected && spec.debug?.seedBadDiff?.atStep === stepIndex) {
      badDiffInjected = true;
      await activities.seedBadDiff({
        runId,
        path: spec.debug.seedBadDiff.path,
        content: spec.debug.seedBadDiff.content,
      });
      await activities.recordSeamEvent({
        runId,
        seamEventIndex: seamEventIndex++,
        atStep: stepIndex,
        path: spec.debug.seedBadDiff.path,
        byteCount: spec.debug.seedBadDiff.content.length,
      });
    }

    spentUsd += record.costUsd;
    stepCosts.push(record.costUsd);
    stepIndex += 1;
    const recordTokens = record.tokens.input + record.tokens.output;
    spentTokens += recordTokens;
    stepTokens.push(recordTokens);
    // WP-254: the pacing numerator must measure the LIVE resident occupancy of the
    // orchestration window WE assemble for the next step — the fixed preamble (goal,
    // acceptance criteria, judge feedback, injections) plus the last
    // `RECENT_STEPS_WINDOW` summaries the next ContextBundle carries verbatim — NOT
    // the cumulative `spentTokens`/`recordTokens` of the executor subprocess (a fresh
    // `codex` process's summed cross-turn throughput, which over-read window pressure
    // ~2× and falsely parked trivial tasks: F-56). `record.summary` is pushed into
    // `recentSummaries` below, so include it here to reflect what the next step sees.
    const residentInputTokens = estimateResidentContextTokens(
      buildResidentContextParts({
        systemTexts: [
          spec.goal,
          ...spec.acceptanceCriteria.map((c) => `${c.id} ${c.description} ${c.check ?? ""}`),
          judgeFeedback ?? "",
          ...injections,
        ],
        recentSummaries: [...recentSummaries, record.summary],
        retainedSummaryCount: RECENT_STEPS_WINDOW,
      }),
    );
    const pacing = decideContextWindowPacing(
      {
        currentInputTokens: residentInputTokens,
        currentOutputTokens: 0,
        // The next step's marginal addition to OUR window is ~one more summary, not
        // the executor subprocess's internal throughput (WP-254).
        estimatedNextStepTokens: estimateTokensFromText(record.summary),
        // Default 200k window; a dogfood/test may shrink it via the frozen
        // `debug.contextWindowTokens` seam to force a deterministic pressure
        // decision (WP-207 act half — replay-safe, never read from env here).
        contextWindowTokens:
          spec.debug?.contextWindowTokens ??
          resolveContextWindowForSpec(spec, DEFAULT_CONTEXT_WINDOW_TOKENS),
      },
      DEFAULT_PACING_POLICY,
    );
    // WP-207 act half / WP-203 S2: the pacing decision now DRIVES compaction
    // cadence. Under context-window pressure (`compact` or `park`) the digest
    // folds history beyond the verbatim window NOW, instead of waiting for the
    // count-based trigger — the actionable use of the pressure signal dogfood-052
    // surfaced (602% window, PARK recommended and previously unheeded).
    const underPressure = pacing.action !== "continue";
    await activities.recordPacingEvent({
      runId,
      pacingEventIndex: pacingEventIndex++,
      atStep: stepIndex - 1,
      action: pacing.action,
      projectedTokens: pacing.projectedTokens,
      remainingTokens: pacing.remainingTokens,
      utilization: pacing.utilization,
    });
    recentSummaries.push(record.summary);
    consecutiveFailures = record.status === "FAILED" ? consecutiveFailures + 1 : 0;

    // Memory Pointer interception (WP-202 / CM-3): the step's transcript and
    // diff are already stored as artifacts; surface a pointer for any that is
    // large enough that the executor should fetch excerpts rather than rely on
    // the one-line summary. Small outputs stay summary-only (inline).
    for (const ref of [record.transcriptRef, record.diffRef]) {
      if (shouldPointerize(ref.bytes, DEFAULT_MEMORY_POLICY)) carriedRefs.push(ref);
    }

    // Judge on cadence or a completion milestone (JD-2); each pass is one
    // activity (WP-121/131).
    const completionMilestone = isCompletionMilestone(record);
    let verdict: JudgeVerdict | undefined;
    if (stepIndex % spec.judge.cadence === 0 || completionMilestone) {
      verdict = await activities.judgeStep({
        runId,
        judgeIndex: judgeIndex++,
        atStep: stepIndex - 1,
        criteria: spec.acceptanceCriteria,
        sinceCommit,
        lastGoodCheckpointId,
      });
      spentUsd += verdict.costUsd;
      lastVerdict = { kind: verdict.kind, atStep: stepIndex - 1 };

      // ROLLBACK restores BEFORE the covering checkpoint commits, so the
      // checkpoint captures the restored tree and the run resumes from a
      // verified-good state (judge.md verdict table).
      if (verdict.kind === "ROLLBACK") {
        await activities.restoreCheckpoint({ runId, checkpointId: verdict.rollbackTo! });
        judgeFeedback = verdict.rationale;
      }
    }

    // Checkpoint after the (optional) judge pass so the persisted lastGood
    // flag reflects the verdict that covers exactly this state (WP-122).
    const checkpoint = await activities.writeCheckpoint({
      runId,
      stepIndex: stepIndex - 1,
      context,
      budgetSpentUsd: spentUsd,
      lastGood: verdict?.kind === "PROCEED",
    });
    checkpoints.push(checkpoint);

    // Compaction at the checkpoint boundary (WP-203 S2 / CM-1): fold older
    // recall-tier summaries into one digest and carry its pointer forward, so
    // history beyond the verbatim window is recoverable without rotting
    // context. Best-effort and cost-guarded inside the activity.
    const compaction = await activities.compactContext({
      runId,
      stepIndex: stepIndex - 1,
      summaries: recentSummaries,
      underPressure,
    });
    if (compaction?.digestRef) {
      // Carry only the latest digest pointer (drop a superseded one); the
      // transcript/diff pointers from shouldPointerize keep their own kinds.
      const kept = carriedRefs.filter((r) => r.kind !== "context_snapshot");
      carriedRefs.length = 0;
      carriedRefs.push(...kept, compaction.digestRef);
    }

    // Verdict gating (WP-132). PROCEED advances the diff base and the
    // rollback anchor; HALT seals a resumable FAILED; ESCALATE parks the run
    // for `chikory approve` (CONTRACTS.md §4, durable-runner.md).
    if (verdict !== undefined) {
      sinceCommit = Object.values(checkpoint.gitCommits)[0] ?? sinceCommit;
      if (verdict.kind === "PROCEED") {
        lastGoodCheckpointId = checkpoint.id;
        // Run-level SUCCESS needs PROCEED *and* every criterion passing — a
        // non-PROCEED verdict with passing criteria (e.g. a secret in the
        // diff) must never seal SUCCESS.
        if (allCriteriaPass(verdict)) return seal("SUCCESS");
        judgeFeedback = completionMilestone ? verdict.rationale : undefined;
      } else if (verdict.kind === "HALT") {
        return seal("FAILED", `judge HALT: ${verdict.rationale}`);
      } else if (verdict.kind === "ESCALATE") {
        judgeFeedback = verdict.rationale;
        status = "AWAITING_APPROVAL";
        await condition(() => pendingApprovals.length > 0 || cancelRequested);
        if (cancelRequested) return seal("CANCELLED", "cancelled while awaiting approval");
        const decision = pendingApprovals.splice(0).pop()!;
        if (!decision.approved) {
          return seal(
            "FAILED",
            `judge escalation rejected${decision.reason ? `: ${decision.reason}` : ""} — ${verdict.escalateReason ?? verdict.rationale}`,
          );
        }
        status = "RUNNING";
      }
    }

    // Loop-breaker (WP-124, CG-1): a step that keeps FAILing must never
    // spin — escalate to a human (DX-8 P1 stopgap; `chikory approve`).
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      const reason = `executor FAILED ${consecutiveFailures} consecutive steps (last: ${record.failure?.reason ?? "unknown"})`;
      await activities.recordEscalation({
        runId,
        escalationIndex: escalationIndex++,
        atStep: stepIndex - 1,
        reason,
      });
      status = "AWAITING_APPROVAL";
      await condition(() => pendingApprovals.length > 0 || cancelRequested);
      if (cancelRequested) return seal("CANCELLED", "cancelled while awaiting approval");
      const decision = pendingApprovals.splice(0).pop()!;
      if (!decision.approved) {
        return seal(
          "FAILED",
          `escalation rejected${decision.reason ? `: ${decision.reason}` : ""} — ${reason}`,
        );
      }
      consecutiveFailures = 0;
      status = "RUNNING";
    }
  }
}
