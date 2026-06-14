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
    transcriptRef: { uri: "memory://transcript", sha256: "transcript", bytes: 0 },
    ...overrides,
  };
}

describe("isCompletionMilestone", () => {
  test("returns true for SUCCESS with an empty diff and no completion claim", () => {
    const record = makeRecord({
      status: "SUCCESS",
      diffRef: { uri: "memory://diff", sha256: "diff", bytes: 0 },
    });

    expect(isCompletionMilestone(record)).toBe(true);
  });

  test("returns true for SUCCESS with a non-empty diff and an explicit completion claim", () => {
    const record = makeRecord({
      status: "SUCCESS",
      diffRef: { uri: "memory://diff", sha256: "diff", bytes: 1 },
      claimsComplete: true,
    });

    expect(isCompletionMilestone(record)).toBe(true);
  });

  test("returns false for SUCCESS with a non-empty diff and no completion claim", () => {
    const record = makeRecord({
      status: "SUCCESS",
      diffRef: { uri: "memory://diff", sha256: "diff", bytes: 1 },
    });

    expect(isCompletionMilestone(record)).toBe(false);
  });

  test("returns false for SUCCESS with a non-empty diff and a false completion claim", () => {
    const record = makeRecord({
      status: "SUCCESS",
      diffRef: { uri: "memory://diff", sha256: "diff", bytes: 1 },
      claimsComplete: false,
    });

    expect(isCompletionMilestone(record)).toBe(false);
  });

  test("returns false for FAILED with an empty diff", () => {
    const record = makeRecord({
      status: "FAILED",
      diffRef: { uri: "memory://diff", sha256: "diff", bytes: 0 },
    });

    expect(isCompletionMilestone(record)).toBe(false);
  });

  test("returns false for FAILED with an explicit completion claim", () => {
    const record = makeRecord({
      status: "FAILED",
      diffRef: { uri: "memory://diff", sha256: "diff", bytes: 1 },
      claimsComplete: true,
    });

    expect(isCompletionMilestone(record)).toBe(false);
  });
});
