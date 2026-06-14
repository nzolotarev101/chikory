import { describe, expect, test } from "vitest";

import type { StepRecord } from "../../src/types.js";
import { isCompletionMilestone } from "../../src/workflow/judge-trigger.js";

function makeRecord(
  overrides: Pick<StepRecord, "status" | "diffRef"> &
    Partial<Pick<StepRecord, "claimsComplete">>,
): StepRecord {
  return {
    summary: "test step",
    toolCalls: 0,
    tokens: { input: 0, output: 0 },
    costUsd: 0,
    costEstimated: false,
    durationMs: 0,
    transcriptRef: {
      id: "transcript",
      kind: "transcript",
      bytes: 0,
      summary: "test transcript",
    },
    ...overrides,
  };
}

describe("isCompletionMilestone", () => {
  test("returns true for SUCCESS with an empty diff and no completion claim", () => {
    const record = makeRecord({
      status: "SUCCESS",
      diffRef: { id: "diff", kind: "diff", bytes: 0, summary: "test diff" },
    });

    expect(isCompletionMilestone(record)).toBe(true);
  });

  test("returns true for SUCCESS with a non-empty diff and an explicit completion claim", () => {
    const record = makeRecord({
      status: "SUCCESS",
      diffRef: { id: "diff", kind: "diff", bytes: 1, summary: "test diff" },
      claimsComplete: true,
    });

    expect(isCompletionMilestone(record)).toBe(true);
  });

  test("returns false for SUCCESS with a non-empty diff and no completion claim", () => {
    const record = makeRecord({
      status: "SUCCESS",
      diffRef: { id: "diff", kind: "diff", bytes: 1, summary: "test diff" },
    });

    expect(isCompletionMilestone(record)).toBe(false);
  });

  test("returns false for SUCCESS with a non-empty diff and a false completion claim", () => {
    const record = makeRecord({
      status: "SUCCESS",
      diffRef: { id: "diff", kind: "diff", bytes: 1, summary: "test diff" },
      claimsComplete: false,
    });

    expect(isCompletionMilestone(record)).toBe(false);
  });

  test("returns false for FAILED with an empty diff", () => {
    const record = makeRecord({
      status: "FAILED",
      diffRef: { id: "diff", kind: "diff", bytes: 0, summary: "test diff" },
    });

    expect(isCompletionMilestone(record)).toBe(false);
  });

  test("returns false for FAILED with an explicit completion claim", () => {
    const record = makeRecord({
      status: "FAILED",
      diffRef: { id: "diff", kind: "diff", bytes: 1, summary: "test diff" },
      claimsComplete: true,
    });

    expect(isCompletionMilestone(record)).toBe(false);
  });
});
