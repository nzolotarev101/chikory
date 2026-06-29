import { describe, expect, it } from "vitest";

import {
  decideContextWindowPacing,
  estimateResidentContextTokens,
  estimateTokensFromText,
  buildResidentContextParts,
  CHARS_PER_TOKEN,
  type ContextWindowPacingPolicy,
  type ContextWindowUsage,
} from "../../src/runner/pacing.js";

describe("context-window pacing pure helper", () => {
  const policy: ContextWindowPacingPolicy = { compactAtFraction: 0.8 };

  it("continues under the compact threshold and reports window math", () => {
    const decision = decideContextWindowPacing(
      {
        currentInputTokens: 200,
        currentOutputTokens: 100,
        estimatedNextStepTokens: 300,
        contextWindowTokens: 1000,
      },
      policy,
    );

    expect(decision).toEqual({
      action: "continue",
      projectedTokens: 600,
      remainingTokens: 400,
      utilization: 0.6,
    });
  });

  it("continues exactly at the compact threshold", () => {
    const decision = decideContextWindowPacing(
      {
        currentInputTokens: 250,
        currentOutputTokens: 150,
        estimatedNextStepTokens: 400,
        contextWindowTokens: 1000,
      },
      policy,
    );

    expect(decision.action).toBe("continue");
    expect(decision.projectedTokens).toBe(800);
    expect(decision.remainingTokens).toBe(200);
    expect(decision.utilization).toBe(0.8);
  });

  it("compacts above the compact threshold", () => {
    const decision = decideContextWindowPacing(
      {
        currentInputTokens: 250,
        currentOutputTokens: 151,
        estimatedNextStepTokens: 400,
        contextWindowTokens: 1000,
      },
      policy,
    );

    expect(decision).toEqual({
      action: "compact",
      projectedTokens: 801,
      remainingTokens: 199,
      utilization: 0.801,
    });
  });

  it("parks when an empty window cannot fit the next step", () => {
    const decision = decideContextWindowPacing(
      {
        currentInputTokens: 0,
        currentOutputTokens: 0,
        estimatedNextStepTokens: 1001,
        contextWindowTokens: 1000,
      },
      policy,
    );

    expect(decision).toEqual({
      action: "park",
      projectedTokens: 1001,
      remainingTokens: -1,
      utilization: 1.001,
    });
  });

  it("does not mutate input objects", () => {
    const usage: ContextWindowUsage = {
      currentInputTokens: 300,
      currentOutputTokens: 200,
      estimatedNextStepTokens: 100,
      contextWindowTokens: 1000,
    };
    const localPolicy: ContextWindowPacingPolicy = { compactAtFraction: 0.7 };
    const originalUsage = { ...usage };
    const originalPolicy = { ...localPolicy };

    decideContextWindowPacing(usage, localPolicy);

    expect(usage).toEqual(originalUsage);
    expect(localPolicy).toEqual(originalPolicy);
  });

  it("estimates live resident tokens from the retained summary tail plus preamble", () => {
    expect(
      estimateResidentContextTokens({
        systemTokens: 100,
        recentSummaryTokens: [10, 20, 30, 40],
        retainedSummaryCount: 2,
      }),
    ).toBe(170);
  });

  it("retains all summaries when the retained count exceeds the available summaries", () => {
    expect(
      estimateResidentContextTokens({
        systemTokens: 100,
        recentSummaryTokens: [10, 20, 30],
        retainedSummaryCount: 10,
      }),
    ).toBe(160);
  });

  it("returns only system tokens when retained summary count is zero or negative", () => {
    expect(
      estimateResidentContextTokens({
        systemTokens: 100,
        recentSummaryTokens: [10, 20, 30],
        retainedSummaryCount: 0,
      }),
    ).toBe(100);
    expect(
      estimateResidentContextTokens({
        systemTokens: 100,
        recentSummaryTokens: [10, 20, 30],
        retainedSummaryCount: -1,
      }),
    ).toBe(100);
  });

  it("returns only system tokens when there are no recent summaries", () => {
    expect(
      estimateResidentContextTokens({
        systemTokens: 100,
        recentSummaryTokens: [],
        retainedSummaryCount: 3,
      }),
    ).toBe(100);
  });

  it("clamps negative live resident occupancy to zero", () => {
    expect(
      estimateResidentContextTokens({
        systemTokens: -100,
        recentSummaryTokens: [10, 20, 30],
        retainedSummaryCount: 2,
      }),
    ).toBe(0);
  });

  it("does not mutate resident context parts or recent summary tokens", () => {
    const parts = {
      systemTokens: 100,
      recentSummaryTokens: [10, 20, 30, 40],
      retainedSummaryCount: 2,
    };
    const originalParts = { ...parts, recentSummaryTokens: [...parts.recentSummaryTokens] };
    const originalRecentSummaryTokens = [...parts.recentSummaryTokens];

    estimateResidentContextTokens(parts);

    expect(parts).toEqual(originalParts);
    expect(parts.recentSummaryTokens).toEqual(originalRecentSummaryTokens);
  });

  it("estimates tokens from text with the chars-per-token heuristic", () => {
    expect(estimateTokensFromText("")).toBe(0);
    // exact multiple of CHARS_PER_TOKEN
    expect(estimateTokensFromText("a".repeat(CHARS_PER_TOKEN * 5))).toBe(5);
    // rounds UP a partial token
    expect(estimateTokensFromText("a".repeat(CHARS_PER_TOKEN * 5 + 1))).toBe(6);
    expect(estimateTokensFromText("a")).toBe(1);
  });

  it("builds resident context parts by token-estimating each piece", () => {
    const input = {
      systemTexts: ["a".repeat(CHARS_PER_TOKEN * 10), "b".repeat(CHARS_PER_TOKEN * 5)],
      recentSummaries: ["c".repeat(CHARS_PER_TOKEN * 3), "d".repeat(CHARS_PER_TOKEN * 4)],
      retainedSummaryCount: 2,
    };
    const originalInput = JSON.parse(JSON.stringify(input));

    const parts = buildResidentContextParts(input);

    // systemTokens = sum of per-text estimates (10 + 5)
    expect(parts.systemTokens).toBe(15);
    expect(parts.recentSummaryTokens).toEqual([3, 4]);
    expect(parts.retainedSummaryCount).toBe(2);
    // the assembled value flows through the estimator: 15 + (3 + 4) = 22
    expect(estimateResidentContextTokens(parts)).toBe(22);
    // pure: input untouched
    expect(input).toEqual(originalInput);
  });

  it("builds empty parts from empty inputs", () => {
    expect(
      buildResidentContextParts({ systemTexts: [], recentSummaries: [], retainedSummaryCount: 5 }),
    ).toEqual({ systemTokens: 0, recentSummaryTokens: [], retainedSummaryCount: 5 });
  });
});
