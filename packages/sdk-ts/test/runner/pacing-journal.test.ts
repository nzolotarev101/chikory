/**
 * WP-207 / FA-3 / SE-2 — pacing telemetry journal contract.
 */
import { describe, expect, test } from "vitest";

import { Journal, type TaskSpec } from "../../src/index.js";

const spec: TaskSpec = {
  name: "pacing-journal-test",
  goal: "prove pacing events are idempotent",
  repos: [{ url: "/tmp/src", writable: true }],
  acceptanceCriteria: [{ id: "AC-1", description: "pacing event persisted" }],
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

describe("pacing journal telemetry (WP-207 / FA-3 / SE-2)", () => {
  test("appendOnce keyed by pacingEventIndex never double-journals a pacing event", () => {
    const journal = new Journal(":memory:");
    journal.createRun("run-pacing", spec);

    const pacing = {
      kind: "pacing" as const,
      payload: {
        pacingEventIndex: 0,
        atStep: 1,
        action: "compact" as const,
        projectedTokens: 180_000,
        remainingTokens: 20_000,
        utilization: 0.9,
      },
      costDeltaUsd: 0,
      artifactRefs: [],
    };

    journal.appendOnce({ field: "pacingEventIndex", value: 0 }, pacing);
    journal.appendOnce({ field: "pacingEventIndex", value: 0 }, pacing);

    expect(journal.entries("pacing")).toHaveLength(1);
    const payload = journal.entries("pacing")[0]!.payload as {
      action: string;
      utilization: number;
    };
    expect(payload.action).toBe("compact");
    expect(payload.utilization).toBe(0.9);

    journal.close();
  });
});
