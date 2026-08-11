/**
 * Pure heal rollback decision (WP-605, dogfood-132).
 *
 * Determines whether a self-heal (rule-3 HALT, rejected judge escalation, or
 * rejected loop-breaker escalation) restores a checkpoint or keeps the current work.
 *
 * - Condemned work (failing acceptance criteria OR destructive rubric failure)
 *   rolls back to `lastGoodCheckpointId`.
 * - Uncondemned work is kept, and the correction brief is applied on top.
 * - If `lastGoodCheckpointId` is absent/undefined, there is nothing to restore
 *   and work is kept.
 *
 * Kept outside the Temporal workflow body so the decision is pure, replay-safe,
 * deterministic, and unit-testable (the `decideRemediation`/`decideRejection` sibling).
 */

export interface HealRollbackInput {
  /** Trigger identifier ("operator_reject", "halt", or custom rationale). */
  trigger: string;
  /** Whether all acceptance criteria passed on the triggering verdict. */
  criteriaAllPass: boolean;
  /** Whether a destructive rubric item failed on the triggering verdict. */
  destructiveRubricFailed?: boolean;
  /** Last checkpoint ID that delivered work and PROCEEDed. */
  lastGoodCheckpointId?: string;
}

export type HealRollbackDecision =
  | { action: "keep"; checkpointId?: undefined }
  | { action: "rollback"; checkpointId: string };

/**
 * Pure decision: returns whether to keep current workspace work or restore
 * a named checkpoint upon self-heal.
 */
export function decideHealRollback(input: HealRollbackInput): HealRollbackDecision {
  if (!input.lastGoodCheckpointId) {
    return { action: "keep" };
  }
  const isCondemned = !input.criteriaAllPass || input.destructiveRubricFailed === true;
  if (isCondemned) {
    return { action: "rollback", checkpointId: input.lastGoodCheckpointId };
  }
  return { action: "keep" };
}
