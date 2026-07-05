/**
 * Pure ESCALATE wait decision. Kept outside the Temporal workflow body so
 * unattended behavior is opt-in, deterministic, and unit-testable.
 */
import type { UnattendedPolicy } from "../types.js";

export interface EscalationWaitState {
  /** Where the ESCALATE came from; only used for the resumable seal reason. */
  source: "judge" | "runner";
  /** Human-readable escalation reason from the verdict or runner loop-breaker. */
  reason: string;
}

export type EscalationWaitDecision =
  | {
      action: "await_approval";
      status: "AWAITING_APPROVAL";
      failureReason?: undefined;
    }
  | {
      action: "seal_resumable_failed";
      status: "FAILED";
      failureReason: string;
    };

const DEFAULT_ESCALATION_REASON = "unspecified escalation";

export function decideEscalationWait(
  state: EscalationWaitState,
  policy?: UnattendedPolicy,
): EscalationWaitDecision {
  if (policy?.escalation !== "seal_resumable_failed") {
    return { action: "await_approval", status: "AWAITING_APPROVAL" };
  }

  const reason = state.reason.trim() || DEFAULT_ESCALATION_REASON;
  return {
    action: "seal_resumable_failed",
    status: "FAILED",
    failureReason: `unattended ${state.source} escalation — ${reason}`,
  };
}
