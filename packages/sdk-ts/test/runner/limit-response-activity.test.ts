import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  classifyLimitSignal,
  createRunnerActivities,
  decideLimitResponse,
  Journal,
  journalPath,
  resolveEndpointCapabilities,
  runTotals,
  workspaceDir,
  type LimitSignalPayload,
  type StepPayload,
} from "../../src/index.js";
import { initSourceRepo, makeSpec, scriptedRegistry } from "./helpers.js";

describe("executeStep limit response seam", () => {
  const cleanups: Array<() => Promise<void>> = [];
  const originalLimitAtStep = process.env["CHIKORY_LIMIT_AT_STEP"];

  afterEach(async () => {
    if (originalLimitAtStep === undefined) {
      delete process.env["CHIKORY_LIMIT_AT_STEP"];
    } else {
      process.env["CHIKORY_LIMIT_AT_STEP"] = originalLimitAtStep;
    }
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  async function preparedRun(runId: string) {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-limit-response-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const repoUrl = await initSourceRepo(join(tmp, "src"));
    const dataDir = join(tmp, "data");
    const spec = makeSpec({ repoUrl });
    const activities = createRunnerActivities({ dataDir, adapters: scriptedRegistry });
    await activities.prepareRun({ runId, spec });
    return { activities, dataDir, spec };
  }

  test("leaves normal step payloads without a scheduler field when the signal is absent", async () => {
    delete process.env["CHIKORY_LIMIT_AT_STEP"];
    const runId = "run-limit-response-normal";
    const { activities, dataDir, spec } = await preparedRun(runId);

    const record = await activities.executeStep({
      runId,
      stepIndex: 0,
      instruction: spec.goal,
      context: {
        goal: spec.goal,
        acceptanceCriteria: spec.acceptanceCriteria,
        planItem: spec.goal,
        notes: {},
        recentSteps: [],
        injections: [],
        memoryRefs: [],
      },
      limits: { maxSeconds: 600 },
    });

    expect(record.summary).toBe("scripted attempt 1: ok");
    expect(existsSync(join(workspaceDir(dataDir, runId), "step-1.txt"))).toBe(true);

    const journal = new Journal(journalPath(dataDir, runId));
    try {
      const payload = journal.entries("step")[0]!.payload as StepPayload;
      expect("limitResponse" in payload).toBe(false);
      expect(payload.record.summary).toBe("scripted attempt 1: ok");
    } finally {
      journal.close();
    }
  });

  test("classifies an injected code-stage limit and journals the real WP-307 scheduler decision", async () => {
    process.env["CHIKORY_LIMIT_AT_STEP"] = "0";
    const runId = "run-limit-response-injected";
    const { activities, dataDir, spec } = await preparedRun(runId);

    const record = await activities.executeStep({
      runId,
      stepIndex: 0,
      instruction: spec.goal,
      context: {
        goal: spec.goal,
        acceptanceCriteria: spec.acceptanceCriteria,
        planItem: spec.goal,
        notes: {},
        recentSteps: [],
        injections: [],
        memoryRefs: [],
      },
      limits: { maxSeconds: 600 },
    });

    const capabilities = resolveEndpointCapabilities(spec);
    const signal = classifyLimitSignal({
      capability: capabilities.code[0]!,
      signal: {
        kind: "injected",
        reason: "CHIKORY_LIMIT_AT_STEP injected at step 0",
        retryAfterMs: 5000,
      },
    });
    expect(signal).toBeDefined();
    const expectedPlan = decideLimitResponse({
      stage: "code",
      signal: signal!,
      capabilities,
    });

    expect(record.status).toBe("SUCCESS");
    expect(record.costUsd).toBe(0);
    expect(record.toolCalls).toBe(0);
    expect(record.claimsComplete).toBe(true);
    expect(record.summary).toBe(
      "limit response: limit-independent-work after CHIKORY_LIMIT_AT_STEP injected at step 0",
    );
    expect(existsSync(join(workspaceDir(dataDir, runId), "scripted-count.txt"))).toBe(false);

    const journal = new Journal(journalPath(dataDir, runId));
    try {
      const payload = journal.entries("step")[0]!.payload as StepPayload;
      expect(payload.limitResponse).toEqual(expectedPlan);
      expect(payload.limitResponse?.steps[0]?.action).toBe("limit-independent-work");
      expect(payload.record).toEqual(record);
      const limitSignals = journal.entries("limit_signal");
      expect(limitSignals).toHaveLength(1);
      const limitPayload = limitSignals[0]!.payload as LimitSignalPayload;
      expect(limitPayload).toEqual({
        limitSignalIndex: 0,
        atStep: 0,
        stage: "code",
        signal,
        limitResponse: expectedPlan,
        chosenResponse: expectedPlan.steps[0],
      });
      expect(runTotals(journal)).toMatchObject({
        limitSignals: 1,
        limitSleptMs: 0,
        limitSleepConservedMs: 5000,
      });
    } finally {
      journal.close();
    }
  });
});
