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
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
  workflowInfo,
} from "@temporalio/workflow";

import type { RunnerActivities } from "../runner/activities.js";
import {
  QUERY_STATUS,
  SIGNAL_CANCEL,
  SIGNAL_INJECT,
} from "../runner/api.js";
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
export const statusQuery = defineQuery<RunStatusReport>(QUERY_STATUS);

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
  let judgeIndex = 0;
  let injectionIndex = 0;
  let cancelRequested = false;
  let lastVerdict: { kind: JudgeVerdict["kind"]; atStep: number } | undefined;
  let failure: { reason: string; lastCheckpoint: string } | undefined;
  const recentSummaries: string[] = [];
  const pendingInjections: string[] = [];
  const checkpoints: Checkpoint[] = [];

  setHandler(cancelSignal, () => {
    cancelRequested = true;
  });
  setHandler(injectSignal, (text) => {
    pendingInjections.push(text);
  });
  setHandler(statusQuery, () => ({
    status,
    currentStep: stepIndex,
    spentUsd,
    budgetUsd: spec.budgetUsd,
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

  await activities.prepareRun({ runId, spec });

  for (;;) {
    if (cancelRequested) return seal("CANCELLED", "cancelled by user");
    if (stepIndex >= maxSteps) {
      return seal("FAILED", `maxSteps (${maxSteps}) reached without meeting acceptance criteria`);
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
    recentSummaries.push(record.summary);
    stepIndex += 1;

    // Judge every N steps (JD-2); each pass is one activity (WP-121).
    let verdict: JudgeVerdict | undefined;
    if (stepIndex % spec.judge.cadence === 0) {
      verdict = await activities.judgeStep({
        runId,
        judgeIndex: judgeIndex++,
        atStep: stepIndex - 1,
        criteria: spec.acceptanceCriteria,
      });
      spentUsd += verdict.costUsd;
      lastVerdict = { kind: verdict.kind, atStep: stepIndex - 1 };
    }

    // Checkpoint after the (optional) judge pass so the persisted lastGood
    // flag reflects the verdict that covers exactly this state (WP-122;
    // WP-132's ROLLBACK restores the latest lastGood checkpoint).
    const checkpoint = await activities.writeCheckpoint({
      runId,
      stepIndex: stepIndex - 1,
      context,
      budgetSpentUsd: spentUsd,
      lastGood: verdict?.kind === "PROCEED",
    });
    checkpoints.push(checkpoint);

    if (allCriteriaPass(verdict)) return seal("SUCCESS");
  }
}
