import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  createRunnerActivities,
  decideSoakDelay,
  Journal,
  journalPath,
  type ArtifactRef,
  type StepRecord,
  type SoakPolicy,
  type SoakState,
} from "../../src/index.js";

import { initSourceRepo, makeSpec, scriptedRegistry } from "./helpers.js";

const ref: ArtifactRef = {
  id: "artifact",
  kind: "diff",
  bytes: 1,
  summary: "artifact",
};

function stepRecord(step: number): StepRecord {
  return {
    status: "SUCCESS",
    diffRef: ref,
    summary: `step ${step}`,
    toolCalls: 1,
    tokens: { input: 10, output: 5 },
    costUsd: 0.01,
    costEstimated: false,
    durationMs: 1,
    transcriptRef: { ...ref, kind: "transcript" },
  };
}

describe("decideSoakDelay", () => {
  test("no policy returns null and preserves the default no-soak path", () => {
    expect(decideSoakDelay({ completedReentries: 0, totalSleptMs: 0 })).toBeNull();
  });

  test("opt-in policy returns the first durable re-entry delay", () => {
    expect(
      decideSoakDelay(
        { completedReentries: 0, totalSleptMs: 0 },
        { sleepMs: 250, maxReentries: 2, maxTotalSleepMs: 1_000 },
      ),
    ).toEqual({ sleepMs: 250 });
  });

  test("returns null when the re-entry count bound is exhausted", () => {
    expect(
      decideSoakDelay(
        { completedReentries: 2, totalSleptMs: 500 },
        { sleepMs: 250, maxReentries: 2, maxTotalSleepMs: 1_000 },
      ),
    ).toBeNull();
  });

  test("returns null when the total sleep bound would be exhausted", () => {
    expect(
      decideSoakDelay(
        { completedReentries: 1, totalSleptMs: 900 },
        { sleepMs: 250, maxReentries: 3, maxTotalSleepMs: 1_000 },
      ),
    ).toBeNull();
  });

  test("does not mutate its inputs", () => {
    const state: SoakState = { completedReentries: 1, totalSleptMs: 250 };
    const policy: SoakPolicy = { sleepMs: 250, maxReentries: 3, maxTotalSleepMs: 1_000 };
    const originalState = { ...state };
    const originalPolicy = { ...policy };

    decideSoakDelay(state, policy);

    expect(state).toEqual(originalState);
    expect(policy).toEqual(originalPolicy);
  });
});

describe("restoreWorkflowState soak resume state", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  test("rehydrates soak counters and consumed chunk position from the journal", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-soak-restore-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const repoUrl = await initSourceRepo(join(tmp, "src"));
    const dataDir = join(tmp, "data");
    const runId = "run-soak-restore";
    const chunks = [
      { name: "chunk-0", directive: "complete chunk zero only" },
      { name: "chunk-1", directive: "complete chunk one only" },
    ];
    const spec = makeSpec({
      repoUrl,
      maxSteps: 3,
      boundedWorkUnit: { minDurableSteps: chunks.length, workChunks: chunks },
      soak: { sleepMs: 750, maxReentries: 1, maxTotalSleepMs: 750 },
    });
    const activities = createRunnerActivities({ dataDir, adapters: scriptedRegistry });
    const prepared = await activities.prepareRun({ runId, spec });
    expect(prepared.status).toBe("SUCCESS");
    if (prepared.status !== "SUCCESS") throw new Error(prepared.reason);

    const journal = new Journal(journalPath(dataDir, runId));
    try {
      journal.append({
        kind: "step",
        payload: {
          stepIndex: 0,
          instruction: chunks[0]!.directive,
          planItem: chunks[0]!.directive,
          record: stepRecord(0),
        },
        costDeltaUsd: 0.01,
        tokens: { input: 10, output: 5 },
        artifactRefs: [ref],
      });
      journal.append({
        kind: "verdict",
        payload: {
          judgeIndex: 0,
          atStep: 0,
          verdict: { kind: "PROCEED", rationale: "chunk zero accepted" },
        },
        costDeltaUsd: 0,
        artifactRefs: [],
      });
      journal.append({
        kind: "control_event",
        payload: {
          controlEventIndex: 0,
          event: "resume",
          source: "soak",
          atStep: 1,
          details: { sleepMs: 750, completedReentries: 1, totalSleptMs: 750 },
        },
        costDeltaUsd: 0,
        artifactRefs: [],
      });
    } finally {
      journal.close();
    }

    const restored = await activities.restoreWorkflowState({
      runId,
      baseCommit: prepared.baseCommit,
    });

    expect(restored.stepIndex).toBe(1);
    expect(restored.controlEventIndex).toBe(1);
    expect(restored.soakState).toEqual({ completedReentries: 1, totalSleptMs: 750 });
    expect(
      decideSoakDelay(restored.soakState, {
        sleepMs: 750,
        maxReentries: 1,
        maxTotalSleepMs: 750,
      }),
    ).toBeNull();
    expect(restored.consumedWorkChunks).toBe(1);
  });
});
