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
import { budgetBreached, estimateNextStepCost } from "../runner/budget.js";
import type {
  Checkpoint,
  ContextBundle,
  JudgeVerdict,
  RunStatus,
  RunStatusReport,
  StepLimits,
  TaskSpec,
} from "../types.js";

/** Step bound when the TaskSpec doesn't say otherwise (executors.md). */
export const DEFAULT_STEP_LIMITS: StepLimits = { maxSeconds: 600 };
/** Recall tier: how many step summaries ride along in context (CM-4). */
export const RECENT_STEPS_WINDOW = 5;

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
  let budgetUsd = spec.budgetUsd;
  let judgeIndex = 0;
  let injectionIndex = 0;
  let budgetEventIndex = 0;
  let escalationIndex = 0;
  let consecutiveFailures = 0;
  let cancelRequested = false;
  let lastVerdict: { kind: JudgeVerdict["kind"]; atStep: number } | undefined;
  let lastGoodCheckpointId: string | undefined;
  let judgeFeedback: string | undefined;
  let failure: { reason: string; lastCheckpoint: string } | undefined;
  const recentSummaries: string[] = [];
  const stepCosts: number[] = [];
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
    if (terminal === "FAILED") {
      failure = { reason: reason ?? "unknown", lastCheckpoint };
    }
    await activities.sealRun({ runId, status: terminal, reason, lastCheckpoint });
    status = terminal;
    return status;
  }

  const { baseCommit } = await activities.prepareRun({ runId, spec });
  // Judge diffs cover everything since the last verdict (or the run base).
  let sinceCommit = baseCommit;

  for (;;) {
    if (cancelRequested) return seal("CANCELLED", "cancelled by user");
    if (stepIndex >= maxSteps) {
      return seal("FAILED", `maxSteps (${maxSteps}) reached without meeting acceptance criteria`);
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
      memoryRefs: [],
    };

    const record = await activities.executeStep({
      runId,
      stepIndex,
      instruction: spec.goal,
      context,
      limits: DEFAULT_STEP_LIMITS,
    });
    spentUsd += record.costUsd;
    stepCosts.push(record.costUsd);
    recentSummaries.push(record.summary);
    stepIndex += 1;
    consecutiveFailures = record.status === "FAILED" ? consecutiveFailures + 1 : 0;

    // Judge every N steps (JD-2); each pass is one activity (WP-121/131).
    let verdict: JudgeVerdict | undefined;
    if (stepIndex % spec.judge.cadence === 0) {
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

    // Verdict gating (WP-132). PROCEED advances the diff base and the
    // rollback anchor; HALT seals a resumable FAILED; ESCALATE parks the run
    // for `chikory approve` (CONTRACTS.md §4, durable-runner.md).
    if (verdict !== undefined) {
      sinceCommit = Object.values(checkpoint.gitCommits)[0] ?? sinceCommit;
      if (verdict.kind === "PROCEED") {
        lastGoodCheckpointId = checkpoint.id;
        judgeFeedback = undefined;
        // Run-level SUCCESS needs PROCEED *and* every criterion passing — a
        // non-PROCEED verdict with passing criteria (e.g. a secret in the
        // diff) must never seal SUCCESS.
        if (allCriteriaPass(verdict)) return seal("SUCCESS");
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
