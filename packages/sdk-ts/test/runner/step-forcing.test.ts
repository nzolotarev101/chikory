import { describe, expect, test } from "vitest";

import { decideStepForcing, type StepForcingState } from "../../src/workflow/step-forcing.js";
import type { BoundedWorkUnitPolicy } from "../../src/types.js";

describe("decideStepForcing", () => {
  test("no policy never forces and leaves the default path untouched", () => {
    expect(
      decideStepForcing({
        durableStepsSealed: 0,
        executorClaimedCompletion: true,
        acceptanceCriteriaMet: false,
      }),
    ).toEqual({ action: "allow_completion", deferCompletionMilestone: false });
  });

  test("forces another increment when the durable checkpoint floor is not met", () => {
    const decision = decideStepForcing(
      {
        durableStepsSealed: 1,
        executorClaimedCompletion: true,
        acceptanceCriteriaMet: true,
      },
      { minDurableSteps: 3, directive: "Finish exactly one remaining part." },
    );

    expect(decision.action).toBe("force_continue");
    expect(decision.deferCompletionMilestone).toBe(true);
    expect(decision.incrementDirective).toContain("1/3 sealed");
    expect(decision.incrementDirective).toContain("executor claimed completion");
    expect(decision.incrementDirective).toContain("Finish exactly one remaining part.");
  });

  test("allows completion when the floor is met and criteria are satisfied", () => {
    expect(
      decideStepForcing(
        {
          durableStepsSealed: 3,
          executorClaimedCompletion: true,
          acceptanceCriteriaMet: true,
        },
        { minDurableSteps: 3 },
      ),
    ).toEqual({ action: "allow_completion", deferCompletionMilestone: false });
  });

  test("forces another increment when the floor is met but criteria are not satisfied", () => {
    const decision = decideStepForcing(
      {
        durableStepsSealed: 3,
        executorClaimedCompletion: false,
        acceptanceCriteriaMet: false,
      },
      { minDurableSteps: 3 },
    );

    expect(decision.action).toBe("force_continue");
    expect(decision.incrementDirective).toContain("Acceptance criteria are not judge-confirmed yet");
  });

  test("normalizes non-positive inputs and remains total", () => {
    const decision = decideStepForcing(
      {
        durableStepsSealed: -2,
        executorClaimedCompletion: false,
        acceptanceCriteriaMet: true,
      },
      { minDurableSteps: 0 },
    );

    expect(decision.action).toBe("force_continue");
    expect(decision.incrementDirective).toContain("0/1 sealed");
  });

  test("does not mutate its inputs", () => {
    const state: StepForcingState = {
      durableStepsSealed: 1,
      executorClaimedCompletion: true,
      acceptanceCriteriaMet: true,
    };
    const policy: BoundedWorkUnitPolicy = {
      minDurableSteps: 2,
      directive: "Advance one part.",
    };
    const originalState = { ...state };
    const originalPolicy = { ...policy };

    decideStepForcing(state, policy);

    expect(state).toEqual(originalState);
    expect(policy).toEqual(originalPolicy);
  });
});
