import { describe, expect, it } from "vitest";

import {
  decideContextWindowPacing,
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
});
