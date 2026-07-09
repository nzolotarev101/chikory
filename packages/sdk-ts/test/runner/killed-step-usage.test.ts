/**
 * WP-515 (F-96) — honest accounting for a blind-metered step: the pure
 * per-tool-call-rate estimator, and the REAL executeStep activity folding the
 * estimate into the journal ledger before the entry lands (so both budget
 * gates and the trace see the killed step's real spend).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  createRunnerActivities,
  estimateKilledStepUsage,
  isBlindMeteredStep,
  Journal,
  journalPath,
  type AdapterRegistry,
  type ArtifactStore,
  type StepPayload,
  type StepRecord,
} from "../../src/index.js";
import { initSourceRepo, makeSpec } from "./helpers.js";

describe("isBlindMeteredStep (the F-9/F-96 class)", () => {
  const tokens = { input: 0, output: 0 };
  test("FAILED with real tool calls and zero tokens → blind", () => {
    expect(isBlindMeteredStep({ status: "FAILED", toolCalls: 57, tokens })).toBe(true);
  });
  test("metered failure is not blind", () => {
    expect(
      isBlindMeteredStep({ status: "FAILED", toolCalls: 3, tokens: { input: 10, output: 5 } }),
    ).toBe(false);
  });
  test("zero tool calls carries no evidence of spend", () => {
    expect(isBlindMeteredStep({ status: "FAILED", toolCalls: 0, tokens })).toBe(false);
  });
  test("SUCCESS steps are never estimated", () => {
    expect(isBlindMeteredStep({ status: "SUCCESS", toolCalls: 5, tokens })).toBe(false);
  });
});

describe("estimateKilledStepUsage (per-tool-call rate)", () => {
  const prior = [
    { toolCalls: 10, tokens: { input: 1000, output: 100 }, costUsd: 0.5 },
    { toolCalls: 5, tokens: { input: 500, output: 50 }, costUsd: 0.25 },
  ];

  test("scales the observed rate by the killed step's tool calls", () => {
    // rate: 1500 in / 150 out / $0.75 over 15 calls → per call 100 in, 10 out, $0.05.
    const estimate = estimateKilledStepUsage(20, prior);
    expect(estimate).toEqual({
      tokens: { input: 2000, output: 200 },
      costUsd: 1,
      perToolCallTokens: 110,
      basis: "per_tool_call_rate",
    });
  });

  test("no metered prior step → null (never invent a rate)", () => {
    expect(estimateKilledStepUsage(20, [])).toBeNull();
    expect(
      estimateKilledStepUsage(20, [
        { toolCalls: 4, tokens: { input: 0, output: 0 }, costUsd: 0 },
      ]),
    ).toBeNull();
  });

  test("zero killed tool calls → null", () => {
    expect(estimateKilledStepUsage(0, prior)).toBeNull();
  });
});

describe("executeStep folds the estimate into the ledger (WP-515)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  /** Attempt 1: metered success. Attempt 2: cap-killed shape — FAILED, 57 tool calls, $0/0 tokens. */
  function blindMeterRegistry(): AdapterRegistry {
    let attempt = 0;
    return {
      scripted: (ctx: { store: ArtifactStore }) => ({
        name: "scripted",
        modelFamily: "anthropic",
        async runStep(): Promise<StepRecord> {
          attempt += 1;
          const [diffRef, transcriptRef] = await Promise.all([
            ctx.store.put(`diff ${attempt}`, { kind: "diff", summary: `diff ${attempt}` }),
            ctx.store.put(`transcript ${attempt}`, {
              kind: "transcript",
              summary: `transcript ${attempt}`,
            }),
          ]);
          const base = { diffRef, transcriptRef, durationMs: 1, costEstimated: true };
          if (attempt === 1) {
            return {
              ...base,
              status: "SUCCESS",
              summary: "metered step",
              toolCalls: 10,
              tokens: { input: 1000, output: 100 },
              costUsd: 0.5,
            };
          }
          return {
            ...base,
            status: "FAILED",
            summary: "step killed: exceeded maxSeconds",
            toolCalls: 57,
            tokens: { input: 0, output: 0 },
            costUsd: 0,
            failure: {
              reason: "step exceeded maxSeconds=600; killed after 600.0s (1.00× cap)",
              retriable: true,
            },
          };
        },
      }),
    };
  }

  test("a cap-killed step's spend hits the journal at the observed per-tool-call rate", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-killed-usage-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const repoUrl = await initSourceRepo(join(tmp, "src"));
    const dataDir = join(tmp, "data");
    const runId = "run-killed-usage";
    const spec = makeSpec({ repoUrl });

    const activities = createRunnerActivities({ dataDir, adapters: blindMeterRegistry() });
    const prepared = await activities.prepareRun({ runId, spec });
    expect(prepared.status).toBe("SUCCESS");

    const stepInput = {
      runId,
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
    };
    const metered = await activities.executeStep({ ...stepInput, stepIndex: 0 });
    expect(metered.tokens).toEqual({ input: 1000, output: 100 });

    const killed = await activities.executeStep({ ...stepInput, stepIndex: 1 });
    // rate: 1100 tokens / $0.5 over 10 calls → ×57 calls.
    expect(killed.status).toBe("FAILED");
    expect(killed.tokens).toEqual({ input: 5700, output: 570 });
    expect(killed.costUsd).toBeCloseTo(2.85, 10);
    expect(killed.costEstimated).toBe(true);

    const journal = new Journal(journalPath(dataDir, runId));
    try {
      const entries = journal.entries("step");
      // The journal ROW carries the estimate — cost conservation (§4) now
      // includes the killed step, so both budget gates see the spend.
      expect(entries[1]!.costDeltaUsd).toBeCloseTo(2.85, 10);
      expect(entries[1]!.tokens).toEqual({ input: 5700, output: 570 });
      expect(journal.totalCostUsd()).toBeCloseTo(0.5 + 2.85, 10);
      const payload = entries[1]!.payload as StepPayload;
      expect(payload.usageEstimate).toEqual({
        basis: "per_tool_call_rate",
        perToolCallTokens: 110,
      });
      // The metered step carries no estimate marker.
      expect((entries[0]!.payload as StepPayload).usageEstimate).toBeUndefined();
    } finally {
      journal.close();
    }
  });

  test("with no metered prior step the ledger stays honest at $0 (no invented rate)", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-killed-usage-cold-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const repoUrl = await initSourceRepo(join(tmp, "src"));
    const dataDir = join(tmp, "data");
    const runId = "run-killed-usage-cold";
    const spec = makeSpec({ repoUrl });

    const blindOnly: AdapterRegistry = {
      scripted: (ctx: { store: ArtifactStore }) => ({
        name: "scripted",
        modelFamily: "anthropic",
        async runStep(): Promise<StepRecord> {
          const [diffRef, transcriptRef] = await Promise.all([
            ctx.store.put("diff", { kind: "diff", summary: "diff" }),
            ctx.store.put("transcript", { kind: "transcript", summary: "transcript" }),
          ]);
          return {
            diffRef,
            transcriptRef,
            durationMs: 1,
            costEstimated: true,
            status: "FAILED",
            summary: "step killed: exceeded maxSeconds",
            toolCalls: 57,
            tokens: { input: 0, output: 0 },
            costUsd: 0,
            failure: { reason: "step exceeded maxSeconds=600", retriable: true },
          };
        },
      }),
    };
    const coldActivities = createRunnerActivities({ dataDir, adapters: blindOnly });
    const prepared = await coldActivities.prepareRun({ runId, spec });
    expect(prepared.status).toBe("SUCCESS");
    const killed = await coldActivities.executeStep({
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

    expect(killed.tokens).toEqual({ input: 0, output: 0 });
    expect(killed.costUsd).toBe(0);
    const journal = new Journal(journalPath(dataDir, runId));
    try {
      expect((journal.entries("step")[0]!.payload as StepPayload).usageEstimate).toBeUndefined();
    } finally {
      journal.close();
    }
  });
});
