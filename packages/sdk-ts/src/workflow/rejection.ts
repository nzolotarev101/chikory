/**
 * Pure ESCALATE rejection decisions (WP-602).
 *
 * When an operator rejects an escalation (`chikory approve --reject`), the
 * decision determines whether the run seals dead (no reason, whitespace-only
 * reason, or rejection budget exhausted) or heals (reasoned reject within budget).
 *
 * Kept outside the Temporal workflow body so the decision is pure, replay-safe,
 * deterministic, and unit-testable.
 */
import { clampBrief, REMEDIATION_BRIEF_MAX_CHARS } from "./remediation.js";

export const DEFAULT_MAX_REJECTION_STRIKES = 1;

/** Max character limit for rejection brief, aligned with REMEDIATION_BRIEF_MAX_CHARS. */
export const REJECTION_BRIEF_MAX_CHARS = REMEDIATION_BRIEF_MAX_CHARS;

export interface RejectionState {
  /** The human operator's rejection reason supplied via `chikory approve --reject`. */
  reason?: string;
  /** Rejection strikes already spent since the run started. */
  strikesSpent: number;
  /** Maximum number of reasoned rejection heals allowed for this run. */
  maxStrikes?: number;
  /** Optional escalation reason from the verdict or runner loop-breaker. */
  escalationReason?: string;
}

export type RejectionDecision =
  | {
      action: "heal";
      brief: string;
    }
  | {
      action: "seal_dead";
      failureReason: string;
    };

/**
 * Builds the remediation brief containing the operator's verbatim rejection reason,
 * clamped to REJECTION_BRIEF_MAX_CHARS so it rides in step context without context rot.
 */
export function buildRejectionBrief(reason: string): string {
  const lines = [
    "REMEDIATION BRIEF — the operator rejected the escalation with instructions:",
    reason,
  ];
  return clampBrief(lines.join("\n\n"), REJECTION_BRIEF_MAX_CHARS);
}

/**
 * Pure decision: grant a remediation heal if the reject carries non-whitespace
 * correction words and the rejection budget has not been exhausted. Otherwise
 * seal dead naming rejection as the cause.
 */
export function decideRejection(state: RejectionState): RejectionDecision {
  const maxStrikes = state.maxStrikes ?? DEFAULT_MAX_REJECTION_STRIKES;
  const trimmed = state.reason?.trim();
  const suffix = state.escalationReason ? ` — ${state.escalationReason}` : "";

  if (!trimmed) {
    return {
      action: "seal_dead",
      failureReason: `escalation rejected with no reason${suffix}`,
    };
  }

  if (state.strikesSpent >= maxStrikes) {
    return {
      action: "seal_dead",
      failureReason: `escalation rejected: ${trimmed}${suffix}`,
    };
  }

  return {
    action: "heal",
    brief: buildRejectionBrief(trimmed),
  };
}
