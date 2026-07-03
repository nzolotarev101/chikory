/**
 * Pure intra-run step-forcing decision. This is deliberately isolated from
 * Temporal, journals, clocks, and I/O so the durable loop can opt into a
 * bounded work-unit floor without changing sealed step/checkpoint contracts.
 */
import type { BoundedWorkUnitPolicy } from "../types.js";

export interface StepForcingState {
  /** Durable checkpoints sealed so far, including the current step if already written. */
  durableStepsSealed: number;
  /** Whether the executor explicitly claimed completion on the current step. */
  executorClaimedCompletion: boolean;
  /** Whether the judge-confirmed acceptance criteria are all met. */
  acceptanceCriteriaMet: boolean;
}

export type StepForcingDecision =
  | {
      action: "allow_completion";
      deferCompletionMilestone: false;
      incrementDirective?: undefined;
    }
  | {
      action: "force_continue";
      deferCompletionMilestone: true;
      incrementDirective: string;
    };

const DEFAULT_INCREMENT_DIRECTIVE =
  "Continue with the next bounded work-unit increment. Do not declare the overall run complete yet; advance one concrete part of the goal and leave a durable checkpoint.";

export function decideStepForcing(
  state: StepForcingState,
  policy?: BoundedWorkUnitPolicy,
): StepForcingDecision {
  if (policy === undefined) {
    return { action: "allow_completion", deferCompletionMilestone: false };
  }

  const durableStepsSealed = Math.max(0, state.durableStepsSealed);
  const minDurableSteps = Math.max(1, policy.minDurableSteps);

  if (durableStepsSealed >= minDurableSteps && state.acceptanceCriteriaMet) {
    return { action: "allow_completion", deferCompletionMilestone: false };
  }

  const directive = policy.directive?.trim() || DEFAULT_INCREMENT_DIRECTIVE;
  const reason =
    durableStepsSealed < minDurableSteps
      ? `Durable checkpoint floor not met: ${durableStepsSealed}/${minDurableSteps} sealed.`
      : "Acceptance criteria are not judge-confirmed yet.";
  const completionClaim = state.executorClaimedCompletion
    ? " The executor claimed completion, but the active bounded-work-unit policy requires another increment."
    : "";

  return {
    action: "force_continue",
    deferCompletionMilestone: true,
    incrementDirective: `${reason}${completionClaim} ${directive}`,
  };
}
