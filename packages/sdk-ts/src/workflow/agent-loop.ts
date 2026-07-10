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
  sleep,
  workflowInfo,
} from "@temporalio/workflow";

import type { RunnerActivities } from "../runner/activities.js";
import {
  QUERY_STATUS,
  SIGNAL_APPROVE,
  SIGNAL_CANCEL,
  SIGNAL_INJECT,
  SIGNAL_RESUME,
  SIGNAL_SUSPEND,
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
  shouldParkForWindow,
  type ContextWindowPacingPolicy,
} from "../runner/pacing.js";
import { calibrateContextWindow, resolveContextWindowForSpec } from "../runner/context-window.js";
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
import {
  decideMemoryEviction,
  formatPointerReference,
  recallPointerExcerpt,
  resolveMemoryRecallRequest,
  shouldPointerize,
  type MemoryEvictionPolicy,
  type MemoryPointerPolicy,
} from "../runner/memory-pointer.js";
import { isCompletionMilestone } from "./judge-trigger.js";
import { decideEscalationWait } from "./escalation-wait.js";
import {
  buildCriterionFeedback,
  buildRemediationBrief,
  decideRemediation,
} from "./remediation.js";
import { decideSoakDelay } from "./soak.js";
import { decideStepForcing } from "./step-forcing.js";
import { decideWorkChunk } from "./work-chunk.js";

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
const UNATTENDED_MEMORY_EVICTION_POLICY: MemoryEvictionPolicy = { maxRefs: CARRIED_REFS_WINDOW };

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
export const suspendSignal = defineSignal(SIGNAL_SUSPEND);
export const resumeSignal = defineSignal(SIGNAL_RESUME);
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

function projectMemoryRefs(
  refs: ArtifactRef[],
  policy: MemoryEvictionPolicy | undefined,
): ArtifactRef[] {
  if (policy === undefined) return refs.slice(-CARRIED_REFS_WINDOW);
  const keptNonDigestRefs = new Set(
    decideMemoryEviction(
      refs.filter((ref) => ref.kind !== "context_snapshot"),
      policy,
    ).keep,
  );
  return refs.filter((ref) => ref.kind === "context_snapshot" || keptNonDigestRefs.has(ref));
}

function applyMemoryEviction(
  refs: ArtifactRef[],
  policy: MemoryEvictionPolicy | undefined,
): number {
  if (policy === undefined) return 0;

  const digestRefs = refs.filter((ref) => ref.kind === "context_snapshot");
  const nonDigestRefs = refs.filter((ref) => ref.kind !== "context_snapshot");
  const eviction = decideMemoryEviction(nonDigestRefs, policy);

  refs.length = 0;
  refs.push(...eviction.keep, ...digestRefs);
  return eviction.evicted.length;
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
  let controlEventIndex = 0;
  let soakReentries = 0;
  let soakSleptMs = 0;
  let consecutiveFailures = 0;
  let parkInjected = false;
  let badDiffInjected = false;
  let cancelRequested = false;
  let suspendRequested = false;
  let resumeRequested = false;
  let lastVerdict: { kind: JudgeVerdict["kind"]; atStep: number } | undefined;
  let lastGoodCheckpointId: string | undefined;
  // F-125: the auto-calibrated pacing window, locked once from step 1's observed
  // resident tokens. Workflow state → deterministic across a resume replay.
  let calibratedWindowTokens: number | undefined;
  let judgeFeedback: string | undefined;
  let failure: { reason: string; lastCheckpoint: string } | undefined;
  const recentSummaries: string[] = [];
  const stepCosts: number[] = [];
  const stepTokens: number[] = [];
  // Memory Pointer carrier (WP-202/203, CM-3): pointers to large prior-step
  // outputs and the latest compaction digest, surfaced into each step's
  // context so externalized material is recoverable without rotting context.
  const carriedRefs: ArtifactRef[] = [];
  let pendingMemoryRecallNote: string | undefined;
  let memoryRecalls = 0;
  let memoryEvictions = 0;
  const pendingInjections: string[] = [];
  const pendingTopUps: number[] = [];
  const pendingApprovals: ApproveDecision[] = [];
  const checkpoints: Checkpoint[] = [];
  let consumedWorkChunks = 0;
  // WP-519 (ADR-009 D3): bounded heal state — attempts used since the last
  // terminal seal (the bound), the global journal index (idempotency key,
  // keeps counting across resumable-FAILED reopenings), and whether the NEXT
  // step is a remediation attempt that must be re-judged off-cadence.
  let remediationAttempts = 0;
  let remediationIndexBase = 0;
  let remediationPending = false;
  let lastRemediationBrief: string | undefined;

  setHandler(cancelSignal, () => {
    cancelRequested = true;
  });
  setHandler(injectSignal, (text) => {
    pendingInjections.push(text);
  });
  setHandler(suspendSignal, () => {
    suspendRequested = true;
  });
  setHandler(resumeSignal, () => {
    if (status === "SUSPENDED" && suspendRequested) resumeRequested = true;
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
  const memoryEvictionPolicy =
    spec.unattended === undefined ? undefined : UNATTENDED_MEMORY_EVICTION_POLICY;

  async function seal(
    terminal: "SUCCESS" | "FAILED" | "CANCELLED",
    reason?: string,
    // WP-520 (ADR-009 D4): a resumable FAILED is healable — `chikory resume`
    // re-enters it with the failure evidence (and remediation brief, if any)
    // in context. Omitted → a dead seal, the default.
    opts?: { resumable?: boolean; remediation?: { attempts: number; brief: string } },
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
      memoryCounters: { recalls: memoryRecalls, evicted: memoryEvictions },
      ...(handoff !== undefined ? { handoff } : {}),
      ...(opts?.resumable === true ? { resumable: true } : {}),
      ...(opts?.remediation !== undefined ? { remediation: opts.remediation } : {}),
    });
    status = terminal;
    return status;
  }

  async function parkIfOperatorSuspended(): Promise<RunStatus | undefined> {
    if (!suspendRequested) return undefined;
    await activities.recordControlEvent({
      runId,
      controlEventIndex: controlEventIndex++,
      event: "suspend",
      atStep: stepIndex,
    });
    status = "SUSPENDED";
    await condition(() => resumeRequested || cancelRequested);
    if (cancelRequested) return seal("CANCELLED", "cancelled while operator-suspended");
    resumeRequested = false;
    suspendRequested = false;
    await activities.recordControlEvent({
      runId,
      controlEventIndex: controlEventIndex++,
      event: "resume",
      atStep: stepIndex,
    });
    status = "RUNNING";
    return undefined;
  }

  async function soakBeforeNextStep(): Promise<RunStatus | undefined> {
    if (stepIndex >= maxSteps) return undefined;
    const soakDelay = decideSoakDelay(
      { completedReentries: soakReentries, totalSleptMs: soakSleptMs },
      spec.soak,
    );
    if (soakDelay === null) return undefined;

    status = "SUSPENDED";
    await sleep(soakDelay.sleepMs);
    soakReentries += 1;
    soakSleptMs += soakDelay.sleepMs;
    await activities.recordControlEvent({
      runId,
      controlEventIndex: controlEventIndex++,
      event: "resume",
      atStep: stepIndex,
      source: "soak",
      details: {
        sleepMs: soakDelay.sleepMs,
        completedReentries: soakReentries,
        totalSleptMs: soakSleptMs,
      },
    });
    if (cancelRequested) return seal("CANCELLED", "cancelled during soak delay");
    status = "RUNNING";
    return undefined;
  }

  const prepared = await activities.prepareRun({ runId, spec });
  if (prepared.status === "FAILED") return seal("FAILED", prepared.reason);
  const { baseCommit } = prepared;
  // Judge diffs cover everything since the last verdict (or the run base).
  let sinceCommit = baseCommit;
  const restored = await activities.restoreWorkflowState({ runId, baseCommit });
  stepIndex = restored.stepIndex;
  spentUsd = restored.spentUsd;
  spentTokens = restored.spentTokens;
  budgetUsd = restored.budgetUsd;
  judgeIndex = restored.judgeIndex;
  injectionIndex = restored.injectionIndex;
  budgetEventIndex = restored.budgetEventIndex;
  seamEventIndex = restored.seamEventIndex;
  pacingEventIndex = restored.pacingEventIndex;
  escalationIndex = restored.escalationIndex;
  controlEventIndex = restored.controlEventIndex;
  consecutiveFailures = restored.consecutiveFailures;
  recentSummaries.push(...restored.recentSummaries);
  stepCosts.push(...restored.stepCosts);
  stepTokens.push(...restored.stepTokens);
  if (restored.lastVerdict !== undefined) lastVerdict = restored.lastVerdict;
  if (restored.lastGoodCheckpointId !== undefined) {
    lastGoodCheckpointId = restored.lastGoodCheckpointId;
  }
  if (restored.judgeFeedback !== undefined) judgeFeedback = restored.judgeFeedback;
  checkpoints.push(...restored.checkpoints);
  memoryRecalls = restored.memoryCounters.recalls;
  memoryEvictions = restored.memoryCounters.evicted;
  soakReentries = restored.soakState.completedReentries;
  soakSleptMs = restored.soakState.totalSleptMs;
  consumedWorkChunks = restored.consumedWorkChunks;
  remediationAttempts = restored.remediationAttempts;
  remediationIndexBase = restored.remediationIndexBase;
  sinceCommit = restored.sinceCommit ?? baseCommit;

  for (;;) {
    if (cancelRequested) return seal("CANCELLED", "cancelled by user");
    const operatorParkTerminal = await parkIfOperatorSuspended();
    if (operatorParkTerminal !== undefined) return operatorParkTerminal;
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

    const activeWorkChunk = decideWorkChunk(
      { consumedChunks: consumedWorkChunks },
      spec.boundedWorkUnit,
    );
    const stepInstruction =
      activeWorkChunk.action === "use_chunk" ? activeWorkChunk.chunk.directive : spec.goal;

    const memoryRecallNote = pendingMemoryRecallNote;
    pendingMemoryRecallNote = undefined;
    const context: ContextBundle = {
      goal: stepInstruction,
      acceptanceCriteria: spec.acceptanceCriteria,
      planItem: stepInstruction,
      notes:
        memoryRecallNote === undefined
          ? {}
          : { "memory.recall": memoryRecallNote },
      recentSteps: recentSummaries.slice(-RECENT_STEPS_WINDOW),
      judgeFeedback,
      injections,
      memoryRefs: projectMemoryRefs(carriedRefs, memoryEvictionPolicy),
    };

    const record = await activities.executeStep({
      runId,
      stepIndex,
      instruction: stepInstruction,
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
    // The next step's marginal addition to OUR window is ~one more summary, not
    // the executor subprocess's internal throughput (WP-254).
    const estimatedNextStepTokens = estimateTokensFromText(record.summary);
    // Default 200k window; a dogfood/test may shrink it via the frozen
    // `debug.contextWindowTokens` seam to force a deterministic pressure
    // decision (WP-207 act half — replay-safe, never read from env here).
    const baseWindowTokens =
      spec.debug?.contextWindowTokens ??
      resolveContextWindowForSpec(spec, DEFAULT_CONTEXT_WINDOW_TOKENS);
    // F-125: when `pacing.autoCalibrate` is opted in, size the window from this
    // run's OWN first-step assembled-context tokens (locked once, on step 1) so a
    // static per-workload guess can no longer mis-size it. Purely derived from the
    // journaled step result → a Temporal replay recomputes the identical window.
    if (spec.pacing?.autoCalibrate === true && calibratedWindowTokens === undefined) {
      calibratedWindowTokens = calibrateContextWindow(residentInputTokens + estimatedNextStepTokens);
    }
    const effectiveWindowTokens =
      spec.pacing?.autoCalibrate === true && calibratedWindowTokens !== undefined
        ? calibratedWindowTokens
        : baseWindowTokens;
    const pacing = decideContextWindowPacing(
      {
        currentInputTokens: residentInputTokens,
        currentOutputTokens: 0,
        estimatedNextStepTokens,
        contextWindowTokens: effectiveWindowTokens,
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
    const requestedRecall = resolveMemoryRecallRequest(record.summary, carriedRefs);
    if (requestedRecall !== null) {
      const recalledExcerpt = await recallPointerExcerpt(
        formatPointerReference(requestedRecall),
        (idPrefix, bytes) =>
          activities.recallArtifactExcerpt({ runId, idPrefix, bytes }),
      );
      if (recalledExcerpt !== null) {
        memoryRecalls += 1;
        pendingMemoryRecallNote = `${formatPointerReference(requestedRecall)}\n\n${recalledExcerpt}`;
      }
    }
    memoryEvictions += applyMemoryEviction(carriedRefs, memoryEvictionPolicy);

    // Judge on cadence or a completion milestone (JD-2); each pass is one
    // activity (WP-121/131).
    const completionMilestone = isCompletionMilestone(record);
    const workChunkMilestone = activeWorkChunk.action === "use_chunk";
    // A remediation attempt (WP-519) is re-judged off-cadence: the heal is
    // only real if the judge re-checks the stuck criterion right away.
    const remediationMilestone = remediationPending;
    remediationPending = false;
    let verdict: JudgeVerdict | undefined;
    if (
      stepIndex % spec.judge.cadence === 0 ||
      completionMilestone ||
      workChunkMilestone ||
      remediationMilestone
    ) {
      verdict = await activities.judgeStep({
        runId,
        judgeIndex: judgeIndex++,
        atStep: stepIndex - 1,
        criteria: spec.acceptanceCriteria,
        sinceCommit,
        ...(activeWorkChunk.action === "use_chunk"
          ? { activeWorkChunkDirective: activeWorkChunk.chunk.directive }
          : {}),
        // F-112: while consuming a NON-FINAL chunk, a terminal AC a later chunk
        // will satisfy fails by design — suppress the Rule 3 consecutive-fail
        // HALT until the final chunk + completion re-verification.
        workChunkInProgress:
          activeWorkChunk.action === "use_chunk" &&
          consumedWorkChunks < (spec.boundedWorkUnit?.workChunks?.length ?? 0) - 1,
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
      memoryCounters: { recalls: memoryRecalls, evicted: memoryEvictions },
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
      memoryEvictions += applyMemoryEviction(carriedRefs, memoryEvictionPolicy);
    }

    // F-127 durable-resume drill: once THIS step's checkpoint (and compaction)
    // are durably sealed, the seam hard-exits the worker so `chikory resume`
    // continues from the sealed checkpoint with zero re-execution — a reproducible
    // crash the suspend/resume axis can be proven on. Gate rides the frozen input
    // (replay-safe); the activity reads `CHIKORY_KILL_AT_STEP` (unset on the
    // resuming worker → no-op), so the crash fires exactly once.
    if (spec.debug?.killAtStep === stepIndex - 1) {
      await activities.maybeCrashForResumeDrill({ runId, atStep: stepIndex - 1 });
    }

    // Verdict gating (WP-132). PROCEED advances the diff base and the
    // rollback anchor; HALT seals a resumable FAILED; ESCALATE parks the run
    // for `chikory approve` (CONTRACTS.md §4, durable-runner.md).
    if (verdict !== undefined) {
      sinceCommit = Object.values(checkpoint.gitCommits)[0] ?? sinceCommit;
      if (verdict.kind === "PROCEED") {
        lastGoodCheckpointId = checkpoint.id;
        if (activeWorkChunk.action === "use_chunk") consumedWorkChunks++;
        // Run-level SUCCESS needs PROCEED *and* every criterion passing — a
        // non-PROCEED verdict with passing criteria (e.g. a secret in the
        // diff) must never seal SUCCESS.
        const acceptanceCriteriaMet = allCriteriaPass(verdict);
        const stepForcing = decideStepForcing(
          {
            durableStepsSealed: checkpoints.length,
            executorClaimedCompletion: record.claimsComplete === true,
            acceptanceCriteriaMet,
          },
          spec.boundedWorkUnit,
        );
        const nextWorkChunk = decideWorkChunk(
          { consumedChunks: consumedWorkChunks },
          spec.boundedWorkUnit,
        );
        if (nextWorkChunk.action === "use_chunk") {
          judgeFeedback = nextWorkChunk.chunk.directive;
          const soakTerminal = await soakBeforeNextStep();
          if (soakTerminal !== undefined) return soakTerminal;
          continue;
        }
        if (stepForcing.deferCompletionMilestone) {
          judgeFeedback = stepForcing.incrementDirective;
          const soakTerminal = await soakBeforeNextStep();
          if (soakTerminal !== undefined) return soakTerminal;
          continue;
        }
        if (acceptanceCriteriaMet) return seal("SUCCESS");
        // WP-519 slice (a) (ADR-009 D3): failing-criterion rationale rides
        // into the next step on EVERY judge pass, not only at completion
        // milestones — the executor never retries blind against evidence the
        // judge already holds.
        judgeFeedback =
          buildCriterionFeedback(verdict.form) ??
          (completionMilestone ? verdict.rationale : undefined);
      } else if (verdict.kind === "HALT") {
        // WP-519 (ADR-009 D3) remediation-before-HALT: instead of discarding
        // the judge's diagnosis, fold it into a remediation brief, roll back
        // to the last-good checkpoint, and grant ONE bounded retry that is
        // re-judged off-cadence. Still stuck → seal *resumable* FAILED
        // (WP-520), the diagnosis preserved for `chikory resume`. Chunk-aware
        // for free: rule 3 is already suppressed on non-final chunks (WP-273),
        // so remediation only triggers where HALT would have.
        const remediation = decideRemediation({ attemptsUsed: remediationAttempts });
        if (remediation.action === "remediate") {
          remediationAttempts = remediation.attempt;
          remediationIndexBase += 1;
          const brief = buildRemediationBrief(verdict.form, verdict.rationale);
          lastRemediationBrief = brief;
          await activities.recordRemediation({
            runId,
            remediationIndex: remediationIndexBase - 1,
            atStep: stepIndex - 1,
            trigger: verdict.rationale,
            brief,
            ...(lastGoodCheckpointId !== undefined ? { rollbackTo: lastGoodCheckpointId } : {}),
          });
          if (lastGoodCheckpointId !== undefined) {
            await activities.restoreCheckpoint({ runId, checkpointId: lastGoodCheckpointId });
            // The next judge diff must cover the remediation attempt's own
            // work from the restored state, not the undo of the halted work.
            const restoredCheckpoint = checkpoints.find((c) => c.id === lastGoodCheckpointId);
            const restoredCommit = restoredCheckpoint
              ? Object.values(restoredCheckpoint.gitCommits)[0]
              : undefined;
            if (restoredCommit !== undefined) sinceCommit = restoredCommit;
          }
          judgeFeedback = brief;
          remediationPending = true;
          continue;
        }
        return seal(
          "FAILED",
          `judge HALT: ${verdict.rationale} (remediation exhausted after ${remediationAttempts} attempt${remediationAttempts === 1 ? "" : "s"})`,
          {
            resumable: true,
            ...(lastRemediationBrief !== undefined
              ? { remediation: { attempts: remediationAttempts, brief: lastRemediationBrief } }
              : {}),
          },
        );
      } else if (verdict.kind === "BRANCH") {
        judgeFeedback = verdict.rationale;
      } else if (verdict.kind === "ESCALATE") {
        judgeFeedback = verdict.rationale;
        const escalationWait = decideEscalationWait(
          { source: "judge", reason: verdict.escalateReason ?? verdict.rationale },
          spec.unattended,
        );
        if (escalationWait.action === "seal_resumable_failed") {
          return seal("FAILED", escalationWait.failureReason, { resumable: true });
        }
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
      const escalationWait = decideEscalationWait(
        { source: "runner", reason },
        spec.unattended,
      );
      if (escalationWait.action === "seal_resumable_failed") {
        return seal("FAILED", escalationWait.failureReason, { resumable: true });
      }
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

    // Window gate (WP-250): if even an empty execution window cannot fit the
    // estimated next step, stop spending compute at a durable checkpoint and
    // wait for an operator to resume after changing the task/model/context
    // conditions. This is a condition wait, so worker restarts replay back to
    // the same SUSPENDED state without re-running the completed step.
    if (shouldParkForWindow(pacing)) {
      await activities.recordBudgetEvent({
        runId,
        budgetEventIndex: budgetEventIndex++,
        event: "halt",
        cause: "window",
        remainingUsd: budgetUsd - spentUsd,
        details: {
          projectedTokens: pacing.projectedTokens,
          remainingTokens: pacing.remainingTokens,
          utilizationPercent: Math.round(pacing.utilization * 100),
          atStep: stepIndex,
        },
      });
      status = "SUSPENDED";
      await condition(() => resumeRequested || cancelRequested);
      if (cancelRequested) return seal("CANCELLED", "cancelled while parked for context window");
      resumeRequested = false;
      await activities.recordBudgetEvent({
        runId,
        budgetEventIndex: budgetEventIndex++,
        event: "top_up",
        cause: "window",
        remainingUsd: budgetUsd - spentUsd,
        details: { resumed: 1, atStep: stepIndex },
      });
      status = "RUNNING";
    }

    const soakTerminal = await soakBeforeNextStep();
    if (soakTerminal !== undefined) return soakTerminal;
  }
}
