/**
 * WP-203 / F-129 — compaction journal crash-recovery contract.
 */
import { describe, expect, test } from "vitest";

import { Journal, type CompactionResult, type TaskSpec } from "../../src/index.js";

const spec: TaskSpec = {
  name: "compaction-journal-test",
  goal: "prove re-executed compaction folds are idempotent",
  repos: [{ url: "/tmp/src", writable: true }],
  acceptanceCriteria: [{ id: "AC-1", description: "compaction fold persisted once" }],
  budgetUsd: 1,
  executor: { adapter: "scripted", family: "anthropic" },
  judge: { family: "openai-compat", cadence: 1 },
  routing: {
    stages: {
      plan: { provider: "anthropic", model: "m" },
      code: { provider: "anthropic", model: "m" },
      review: { provider: "anthropic", model: "m" },
      judge: { provider: "openai-compat", model: "fake-judge" },
    },
  },
};

describe("compaction journal telemetry (WP-203 / F-129)", () => {
  test("appendOnce keyed by stepIndex never double-journals a re-executed compaction fold", () => {
    const journal = new Journal(":memory:");
    journal.createRun("run-compaction", spec);

    const fold = {
      kind: "compaction" as const,
      payload: {
        stepIndex: 7,
        tokensBefore: 1200,
        tokensAfter: 180,
        foldedCount: 3,
        trigger: "pacing",
      },
      costDeltaUsd: 0.002,
      tokens: { input: 1200, output: 180 },
      artifactRefs: [],
    };

    const first = journal.appendOnce({ field: "stepIndex", value: 7 }, fold);
    const second = journal.appendOnce({ field: "stepIndex", value: 7 }, fold);

    const compactions = journal.entries("compaction");
    expect(first.existed).toBe(false);
    expect(second.existed).toBe(true);
    expect(second.entry.idx).toBe(first.entry.idx);
    expect(compactions).toHaveLength(1);

    const payload = compactions[0]!.payload as CompactionResult & {
      foldedCount?: number;
      trigger?: string;
    };
    expect(payload.stepIndex).toBe(7);
    expect(payload.foldedCount).toBe(3);
    expect(payload.trigger).toBe("pacing");
    expect(payload.tokensBefore).toBe(1200);
    expect(payload.tokensAfter).toBe(180);

    journal.close();
  });
});
