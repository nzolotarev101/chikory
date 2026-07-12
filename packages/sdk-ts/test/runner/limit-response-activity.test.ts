import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  applyLimitResponse,
  classifyLimitSignal,
  createRunnerActivities,
  decideLimitParkDelay,
  decideLimitResponse,
  Journal,
  journalPath,
  resolveEndpointCapabilities,
  runTotals,
  workspaceDir,
  type LimitSignalPayload,
  type StepPayload,
  type TaskSpec,
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

  async function preparedRun(
    runId: string,
    overrides: Partial<TaskSpec> = {},
    scriptedConfig: Parameters<typeof initSourceRepo>[1] = {},
  ) {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-limit-response-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const repoUrl = await initSourceRepo(join(tmp, "src"), scriptedConfig);
    const dataDir = join(tmp, "data");
    const spec = makeSpec({ repoUrl, ...overrides });
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
      expect(runTotals(journal)).toMatchObject({
        limitSignals: 0,
        limitSleptMs: 0,
        limitSleepConservedMs: 0,
      });
    } finally {
      journal.close();
    }
  });

  test("applies a declared code-stage failover by re-dispatching the scripted executor", async () => {
    process.env["CHIKORY_LIMIT_AT_STEP"] = "0";
    const runId = "run-limit-response-injected";
    const { activities, dataDir, spec } = await preparedRun(runId, {
      routing: {
        stages: {
          plan: { provider: "anthropic", model: "claude-fable-5" },
          code: { provider: "anthropic", model: "claude-fable-5" },
          review: { provider: "anthropic", model: "claude-fable-5" },
          judge: { provider: "gemini", model: "gemini-2.5-pro" },
        },
        failover: {
          code: [{ provider: "openai", model: "gpt-5-mini" }],
        },
      },
    });

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

    expect(typeof applyLimitResponse).toBe("function");
    const capabilities = resolveEndpointCapabilities(spec.routing);
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
    expect(record.costUsd).toBe(0.01);
    expect(record.toolCalls).toBe(1);
    expect(record.claimsComplete).toBe(false);
    expect(record.failure).toBeUndefined();
    expect(record.summary).toBe("scripted attempt 1: ok");
    expect(existsSync(join(workspaceDir(dataDir, runId), "scripted-count.txt"))).toBe(true);
    expect(existsSync(join(workspaceDir(dataDir, runId), "step-1.txt"))).toBe(true);

    const journal = new Journal(journalPath(dataDir, runId));
    try {
      const payload = journal.entries("step")[0]!.payload as StepPayload;
      expect(payload.limitResponse).toEqual(expectedPlan);
      expect(payload.limitResponse?.steps[0]).toEqual({
        action: "declared-failover",
        target: {
          stage: "code",
          index: 1,
          capability: {
            endpointKind: "provider",
            target: "openai",
            family: "openai",
            limits: { requestField: "max_completion_tokens", defaultMaxTokens: 4096 },
          },
        },
      });
      expect(payload.planItem).toBe(spec.goal);
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

  test("performs limit-independent target work and journals the throttled item as deferred", async () => {
    process.env["CHIKORY_LIMIT_AT_STEP"] = "0";
    const runId = "run-limit-response-independent-work";
    const { activities, dataDir, spec } = await preparedRun(
      runId,
      {
        routing: {
          stages: {
            plan: { provider: "anthropic", model: "claude-fable-5" },
            code: { provider: "anthropic", model: "claude-fable-5" },
            review: { provider: "openai-compat", model: "gpt-5.5" },
            judge: { provider: "gemini", model: "gemini-2.5-pro" },
          },
        },
      },
      { claimsCompleteSteps: [1] },
    );

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

    expect(typeof applyLimitResponse).toBe("function");
    const capabilities = resolveEndpointCapabilities(spec.routing);
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
    const executedPlanItem = `limit-independent review work before retrying: ${spec.goal}`;

    expect(expectedPlan.steps[0]).toMatchObject({
      action: "limit-independent-work",
      target: { stage: "review", index: 0 },
    });
    expect(record.status).toBe("SUCCESS");
    expect(record.costUsd).toBe(0.01);
    expect(record.toolCalls).toBe(1);
    expect(record.claimsComplete).toBeUndefined();
    expect(record.limitDeferredPlanItem).toBe(spec.goal);
    expect(record.summary).toContain("limit-independent review work completed");
    expect(record.summary).toContain(`deferred throttled plan item: ${spec.goal}`);
    expect(await readFile(join(workspaceDir(dataDir, runId), "step-1.txt"), "utf8")).toBe(
      executedPlanItem,
    );

    const resumedRecord = await activities.executeStep({
      runId,
      stepIndex: 1,
      instruction: spec.goal,
      context: {
        goal: spec.goal,
        acceptanceCriteria: spec.acceptanceCriteria,
        planItem: spec.goal,
        notes: {},
        recentSteps: [record.summary],
        injections: [],
        memoryRefs: [],
      },
      limits: { maxSeconds: 600 },
    });

    expect(resumedRecord.status).toBe("SUCCESS");
    expect(resumedRecord.summary).toBe("scripted attempt 2: ok");
    expect(await readFile(join(workspaceDir(dataDir, runId), "step-2.txt"), "utf8")).toBe(
      spec.goal,
    );

    const journal = new Journal(journalPath(dataDir, runId));
    try {
      const stepPayloads = journal.entries("step").map((entry) => entry.payload as StepPayload);
      expect(stepPayloads).toHaveLength(2);
      const payload = stepPayloads[0]!;
      expect(payload.limitResponse).toEqual(expectedPlan);
      expect(payload.planItem).toBe(executedPlanItem);
      expect(payload.executedPlanItem).toBe(executedPlanItem);
      expect(payload.deferredPlanItem).toBe(spec.goal);
      const returnedRecord = { ...record };
      delete returnedRecord.limitDeferredPlanItem;
      expect(payload.record).toEqual(returnedRecord);
      expect(stepPayloads[1]).toMatchObject({
        stepIndex: 1,
        planItem: spec.goal,
        record: resumedRecord,
      });
      expect(stepPayloads[1]!.limitResponse).toBeUndefined();
      expect(stepPayloads[1]!.deferredPlanItem).toBeUndefined();
      expect(stepPayloads[1]!.executedPlanItem).toBeUndefined();

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

  test("parks until reset when no legal headroom is available", async () => {
    process.env["CHIKORY_LIMIT_AT_STEP"] = "0";
    const runId = "run-limit-response-park";
    const { activities, dataDir, spec } = await preparedRun(runId, {
      judge: { family: "anthropic", cadence: 2, allowSameFamily: true },
      routing: {
        stages: {
          plan: { provider: "anthropic", model: "claude-fable-5" },
          code: { provider: "anthropic", model: "claude-fable-5" },
          review: { provider: "anthropic", model: "claude-fable-5" },
          judge: { provider: "anthropic", model: "claude-fable-5" },
        },
      },
    });

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

    expect(typeof applyLimitResponse).toBe("function");
    const capabilities = resolveEndpointCapabilities(spec.routing);
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

    expect(expectedPlan.steps).toEqual([
      {
        action: "park-until-reset",
        reason: "no-legal-headroom",
        retryAfterMs: 5000,
      },
    ]);
    expect(decideLimitParkDelay({ nowMs: 10_000 }, expectedPlan.steps[0]!)).toEqual({
      sleepMs: 5000,
    });
    expect(
      decideLimitParkDelay(
        { nowMs: 10_000 },
        {
          action: "park-until-reset",
          reason: "no-legal-headroom",
          retryAtMs: 12_500,
        },
      ),
    ).toEqual({ sleepMs: 2500 });
    expect(
      decideLimitParkDelay(
        { nowMs: 12_500 },
        {
          action: "park-until-reset",
          reason: "no-legal-headroom",
          retryAtMs: 12_500,
        },
      ),
    ).toBeNull();

    expect(record.status).toBe("FAILED");
    expect(record.failure).toEqual({
      reason:
        `limit response deferred throttled plan item "${spec.goal}" via park-until-reset; ` +
        "no executor work was performed",
      retriable: true,
    });
    expect(record.limitParkResponse).toEqual(expectedPlan.steps[0]);
    expect(record.toolCalls).toBe(0);
    expect(record.durationMs).toBe(0);
    expect(existsSync(join(workspaceDir(dataDir, runId), "scripted-count.txt"))).toBe(false);

    const journal = new Journal(journalPath(dataDir, runId));
    try {
      const payload = journal.entries("step")[0]!.payload as StepPayload;
      expect(payload.limitResponse).toEqual(expectedPlan);
      expect(payload.limitParkResponse).toEqual(expectedPlan.steps[0]);
      const returnedRecord = { ...record };
      delete returnedRecord.limitParkResponse;
      expect(payload.record).toEqual(returnedRecord);
      expect(runTotals(journal)).toMatchObject({
        limitSignals: 1,
        limitSleptMs: 0,
        limitSleepConservedMs: 0,
      });
    } finally {
      journal.close();
    }
  });
});
