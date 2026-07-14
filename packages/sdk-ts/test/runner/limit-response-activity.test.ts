import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, test } from "vitest";

import {
  applyLimitResponse,
  classifyLimitSignal,
  createRunnerActivities,
  decideLimitParkDelay,
  decideLimitResponse,
  endpointLedgerPath,
  Journal,
  journalPath,
  learnEndpointReset,
  observeEndpointReset,
  resolveEndpointCapabilities,
  runTotals,
  workspaceDir,
  type LimitObservationPayload,
  type LimitSignalPayload,
  type AdapterRegistry,
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
    adapters: AdapterRegistry = scriptedRegistry,
  ) {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-limit-response-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const repoUrl = await initSourceRepo(join(tmp, "src"), scriptedConfig);
    const dataDir = join(tmp, "data");
    const spec = makeSpec({ repoUrl, ...overrides });
    const activities = createRunnerActivities({ dataDir, adapters });
    await activities.prepareRun({ runId, spec });
    return { activities, dataDir, spec };
  }

  function limitObservationRows(dataDir: string) {
    const db = new DatabaseSync(endpointLedgerPath(dataDir), { readOnly: true });
    try {
      return db
        .prepare(
          `SELECT endpoint_target, window_kind, observed_at_ms, reset_at_ms, consumed_tokens_at_hit
             FROM limit_observations
            ORDER BY window_kind`,
        )
        .all() as Array<{
        endpoint_target: string;
        window_kind: string;
        observed_at_ms: number;
        reset_at_ms: number | null;
        consumed_tokens_at_hit: number;
      }>;
    } finally {
      db.close();
    }
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
            review: { provider: "openai-compat", model: "gpt-5.6-sol xhigh" },
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

  test("writes one cross-run observation per declared window for a real limit hit", async () => {
    delete process.env["CHIKORY_LIMIT_AT_STEP"];
    const runId = "run-limit-response-ledger-real";
    const { activities, dataDir, spec } = await preparedRun(
      runId,
      { executor: { adapter: "codex", family: "openai" } },
      { httpLimitSteps: [2], httpLimitRetryAfterSeconds: 12 },
      { codex: scriptedRegistry.scripted! },
    );
    const context = {
      goal: spec.goal,
      acceptanceCriteria: spec.acceptanceCriteria,
      planItem: spec.goal,
      notes: {},
      recentSteps: [],
      injections: [],
      memoryRefs: [],
    };

    await activities.executeStep({
      runId,
      stepIndex: 0,
      instruction: spec.goal,
      context,
      limits: { maxSeconds: 600 },
    });
    await activities.executeStep({
      runId,
      stepIndex: 1,
      instruction: spec.goal,
      context,
      limits: { maxSeconds: 600 },
    });

    const rows = limitObservationRows(dataDir);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.window_kind)).toEqual(["rolling-5h", "weekly"]);
    for (const row of rows) {
      expect(row.endpoint_target).toBe("codex");
      expect(row.consumed_tokens_at_hit).toBe(150);
      expect(row.observed_at_ms).toBeGreaterThan(0);
      expect(row.reset_at_ms).toBe(row.observed_at_ms + 12_000);
    }
  });

  test("writes no cross-run observations for the injected limit seam", async () => {
    process.env["CHIKORY_LIMIT_AT_STEP"] = "0";
    const runId = "run-limit-response-ledger-injected";
    const { activities, dataDir, spec } = await preparedRun(
      runId,
      { executor: { adapter: "codex", family: "openai" } },
      {},
      { codex: scriptedRegistry.scripted! },
    );

    await activities.executeStep({
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

    expect(limitObservationRows(dataDir)).toEqual([]);
  });

  test("learns a park reset from scripted HTTP 429 observation history without the injected seam", async () => {
    delete process.env["CHIKORY_LIMIT_AT_STEP"];
    const runId = "run-limit-response-http-429";
    const { activities, dataDir, spec } = await preparedRun(
      runId,
      {
        judge: { family: "anthropic", cadence: 2, allowSameFamily: true },
        routing: {
          stages: {
            plan: { provider: "anthropic", model: "claude-fable-5" },
            code: { provider: "anthropic", model: "claude-fable-5" },
            review: { provider: "anthropic", model: "claude-fable-5" },
            judge: { provider: "anthropic", model: "claude-fable-5" },
          },
        },
      },
      { httpLimitSteps: [1, 2], httpLimitRetryAfterSeconds: 12 },
    );

    const firstRecord = await activities.executeStep({
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
    expect(firstRecord.status).toBe("FAILED");
    expect(firstRecord.limitParkResponse).toEqual({
      action: "park-until-reset",
      reason: "no-legal-headroom",
    });

    const record = await activities.executeStep({
      runId,
      stepIndex: 1,
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

    expect(typeof learnEndpointReset).toBe("function");
    const firstClassified = classifyLimitSignal({
      capability: resolveEndpointCapabilities(spec.routing).code[0]!,
      signal: {
        kind: "http",
        statusCode: 429,
        headers: { "retry-after": "12" },
        body: "scripted HTTP 429 at attempt 1",
      },
      nowMs: 1_000,
    });
    const secondClassified = classifyLimitSignal({
      capability: resolveEndpointCapabilities(spec.routing).code[0]!,
      signal: {
        kind: "http",
        statusCode: 429,
        headers: { "retry-after": "12" },
        body: "scripted HTTP 429 at attempt 2",
      },
      nowMs: 20_000,
    });
    expect(firstClassified).toBeDefined();
    expect(secondClassified).toBeDefined();
    const firstObservation = observeEndpointReset(firstClassified!, 1_000);
    const secondObservation = observeEndpointReset(secondClassified!, 20_000);
    expect(
      learnEndpointReset({
        signal: firstClassified!,
        observedAtMs: 1_000,
        observations: [firstObservation],
      }),
    ).toBeUndefined();
    expect(
      learnEndpointReset({
        signal: secondClassified!,
        observedAtMs: 20_000,
        observations: [firstObservation, secondObservation],
      }),
    ).toMatchObject({
      signal: {
        source: "http-429",
        retryAfterMs: 12_000,
        retryAtMs: 32_000,
      },
      observationCount: 2,
      retryAfterMs: 12_000,
      resetAtMs: 32_000,
    });

    expect(record.status).toBe("FAILED");
    expect(record.limitParkResponse).toMatchObject({
      action: "park-until-reset",
      reason: "no-legal-headroom",
      retryAfterMs: 12_000,
    });
    expect(existsSync(join(workspaceDir(dataDir, runId), "scripted-count.txt"))).toBe(true);
    expect(existsSync(join(workspaceDir(dataDir, runId), "step-1.txt"))).toBe(false);

    const journal = new Journal(journalPath(dataDir, runId));
    try {
      const limitSignals = journal.entries("limit_signal");
      expect(limitSignals).toHaveLength(2);
      const firstLimitPayload = limitSignals[0]!.payload as LimitSignalPayload;
      expect(firstLimitPayload.signal).not.toHaveProperty("retryAfterMs");
      expect(firstLimitPayload.chosenResponse).toEqual({
        action: "park-until-reset",
        reason: "no-legal-headroom",
      });
      const limitPayload = limitSignals[1]!.payload as LimitSignalPayload;
      expect(limitPayload.signal).toMatchObject({
        source: "http-429",
        reason: "scripted HTTP 429 at attempt 2",
        retryAfterMs: 12_000,
      });
      expect(limitPayload.signal.retryAtMs).toBeGreaterThan(0);
      expect(limitPayload).not.toHaveProperty("endpointResetObservation");
      const observations = journal.entries("limit_observation");
      expect(observations).toHaveLength(2);
      const observationPayload = observations[1]!.payload as LimitObservationPayload;
      expect(observationPayload.endpointCapabilityId).toBe("provider:anthropic:anthropic");
      expect(observationPayload.signal).toEqual(limitPayload.signal);
      expect(observationPayload.observation).toEqual({
        endpointCapabilityId: "provider:anthropic:anthropic",
        endpointTarget: "anthropic",
        family: "anthropic",
        source: "http-429",
        observedAtMs: limitPayload.signal.retryAtMs! - 12_000,
        resetAtMs: limitPayload.signal.retryAtMs,
        retryAfterMs: 12_000,
      });
      const duplicate = journal.appendOnce(
        { field: "atStep", value: observationPayload.atStep },
        {
          kind: "limit_observation",
          payload: observationPayload,
          costDeltaUsd: 0,
          artifactRefs: [],
        },
      );
      expect(duplicate.existed).toBe(true);
      expect(duplicate.entry.idx).toBe(observations[1]!.idx);
      expect(journal.entries("limit_observation")).toHaveLength(2);
      expect(limitPayload.chosenResponse).toEqual({
        action: "park-until-reset",
        reason: "no-legal-headroom",
        retryAfterMs: 12_000,
        retryAtMs: limitPayload.signal.retryAtMs,
      });
      const stepPayload = journal.entries("step")[1]!.payload as StepPayload;
      expect(stepPayload.limitResponse).toEqual(limitPayload.limitResponse);
      expect(stepPayload.limitParkResponse).toEqual(limitPayload.chosenResponse);
      expect(runTotals(journal)).toMatchObject({
        limitSignals: 2,
        limitSleptMs: 0,
        limitSleepConservedMs: 0,
      });
    } finally {
      journal.close();
    }
  });

  test("journals and abstains on thin scripted CLI usage-limit stderr history", async () => {
    delete process.env["CHIKORY_LIMIT_AT_STEP"];
    const runId = "run-limit-response-cli-stderr";
    const stderr = "You've hit your usage limit. Please try again in 45 seconds.";
    const { activities, dataDir, spec } = await preparedRun(
      runId,
      {
        judge: { family: "anthropic", cadence: 2, allowSameFamily: true },
        routing: {
          stages: {
            plan: { provider: "anthropic", model: "claude-fable-5" },
            code: { provider: "anthropic", model: "claude-fable-5" },
            review: { provider: "anthropic", model: "claude-fable-5" },
            judge: { provider: "anthropic", model: "claude-fable-5" },
          },
        },
      },
      { cliLimitSteps: [1], cliLimitStderr: stderr },
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

    expect(typeof learnEndpointReset).toBe("function");
    const classified = classifyLimitSignal({
      capability: resolveEndpointCapabilities(spec.routing).code[0]!,
      signal: {
        kind: "cli-stderr",
        exitCode: 1,
        stderr,
      },
      nowMs: 1_000,
    });
    expect(classified).toBeDefined();
    const observation = observeEndpointReset(classified!, 1_000);
    expect(
      learnEndpointReset({
        signal: classified!,
        observedAtMs: 1_000,
        observations: [observation],
      }),
    ).toBeUndefined();

    expect(record.status).toBe("FAILED");
    expect(record.limitParkResponse).toEqual({
      action: "park-until-reset",
      reason: "no-legal-headroom",
    });
    expect(existsSync(join(workspaceDir(dataDir, runId), "scripted-count.txt"))).toBe(true);
    expect(existsSync(join(workspaceDir(dataDir, runId), "step-1.txt"))).toBe(false);

    const journal = new Journal(journalPath(dataDir, runId));
    try {
      const limitSignals = journal.entries("limit_signal");
      expect(limitSignals).toHaveLength(1);
      const limitPayload = limitSignals[0]!.payload as LimitSignalPayload;
      expect(limitPayload.signal).toMatchObject({
        source: "cli-usage-limit",
        reason: stderr,
      });
      expect(limitPayload.signal).not.toHaveProperty("retryAfterMs");
      expect(limitPayload.signal).not.toHaveProperty("retryAtMs");
      expect(limitPayload).not.toHaveProperty("endpointResetObservation");
      const observations = journal.entries("limit_observation");
      expect(observations).toHaveLength(1);
      const observationPayload = observations[0]!.payload as LimitObservationPayload;
      expect(observationPayload.endpointCapabilityId).toBe("provider:anthropic:anthropic");
      expect(observationPayload.signal).toEqual(limitPayload.signal);
      expect(observationPayload.observation).toEqual({
        endpointCapabilityId: "provider:anthropic:anthropic",
        endpointTarget: "anthropic",
        family: "anthropic",
        source: "cli-usage-limit",
        observedAtMs: expect.any(Number),
        resetAtMs: expect.any(Number),
        retryAfterMs: 45_000,
      });
      expect(limitPayload.chosenResponse).toEqual({
        action: "park-until-reset",
        reason: "no-legal-headroom",
      });
      const stepPayload = journal.entries("step")[0]!.payload as StepPayload;
      expect(stepPayload.limitResponse).toEqual(limitPayload.limitResponse);
      expect(stepPayload.limitParkResponse).toEqual(limitPayload.chosenResponse);
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
