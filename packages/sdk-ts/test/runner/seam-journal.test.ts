/**
 * WP-245 / F-47 — seam telemetry journal contract.
 */
import { describe, expect, test } from "vitest";

import { Journal, type TaskSpec } from "../../src/index.js";

const spec: TaskSpec = {
  name: "seam-journal-test",
  goal: "prove seam events are idempotent",
  repos: [{ url: "/tmp/src", writable: true }],
  acceptanceCriteria: [{ id: "AC-1", description: "seam event persisted" }],
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

describe("seam journal telemetry (WP-245 / F-47)", () => {
  test("appendOnce keyed by seamEventIndex never double-journals a seam event", () => {
    const journal = new Journal(":memory:");
    journal.createRun("run-seam", spec);

    const seam = {
      kind: "seam" as const,
      payload: {
        seamEventIndex: 0,
        atStep: 1,
        path: "step-1.txt",
        byteCount: 18,
      },
      costDeltaUsd: 0,
      artifactRefs: [],
    };

    journal.appendOnce({ field: "seamEventIndex", value: 0 }, seam);
    journal.appendOnce({ field: "seamEventIndex", value: 0 }, seam);

    expect(journal.entries("seam")).toHaveLength(1);
    expect((journal.entries("seam")[0]!.payload as { byteCount: number }).byteCount).toBe(18);

    journal.close();
  });
});
