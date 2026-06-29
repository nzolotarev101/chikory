import { describe, expect, it } from "vitest";

import {
  describeStepDeadline,
  type StepDeadlineInput,
} from "../../src/runner/step-deadline.js";

describe("step deadline pure descriptor", () => {
  it("makes the F-59 wall-clock overrun visible", () => {
    const status = describeStepDeadline({
      startedAtMs: 0,
      endedAtMs: 1_472_000,
      maxSeconds: 600,
    });

    expect(status.elapsedSeconds).toBe(1472);
    expect(status.maxSeconds).toBe(600);
    expect(status.overran).toBe(true);
    expect(status.remainingSeconds).toBe(0);
    expect(status.overrunRatio).toBeCloseTo(2.4533);
  });

  it("reports remaining budget for an under-cap step", () => {
    const status = describeStepDeadline({
      startedAtMs: 0,
      endedAtMs: 300_000,
      maxSeconds: 600,
    });

    expect(status).toEqual({
      elapsedSeconds: 300,
      maxSeconds: 600,
      overran: false,
      remainingSeconds: 300,
      overrunRatio: 0.5,
    });
  });

  it("does not count exactly-at-cap as an overrun", () => {
    const status = describeStepDeadline({
      startedAtMs: 0,
      endedAtMs: 600_000,
      maxSeconds: 600,
    });

    expect(status).toEqual({
      elapsedSeconds: 600,
      maxSeconds: 600,
      overran: false,
      remainingSeconds: 0,
      overrunRatio: 1,
    });
  });

  it("clamps a negative span from clock skew to zero elapsed seconds", () => {
    const status = describeStepDeadline({
      startedAtMs: 500_000,
      endedAtMs: 300_000,
      maxSeconds: 600,
    });

    expect(status).toEqual({
      elapsedSeconds: 0,
      maxSeconds: 600,
      overran: false,
      remainingSeconds: 600,
      overrunRatio: 0,
    });
  });

  it("guards maxSeconds zero so overrunRatio is finite", () => {
    const status = describeStepDeadline({
      startedAtMs: 0,
      endedAtMs: 10_000,
      maxSeconds: 0,
    });

    expect(status.overrunRatio).toBe(0);
    expect(status.overrunRatio).not.toBe(Number.POSITIVE_INFINITY);
    expect(Number.isNaN(status.overrunRatio)).toBe(false);
  });

  it("does not mutate the input object", () => {
    const input: StepDeadlineInput = {
      startedAtMs: 10_000,
      endedAtMs: 20_000,
      maxSeconds: 15,
    };
    const originalInput = { ...input };

    describeStepDeadline(input);

    expect(input).toEqual(originalInput);
  });
});
