/**
 * Plan coverage analysis (WP-219 S2/S2b, ADR-005 D2). Pure — the input to the
 * plan meta-judge's verdict: a decomposition that drops a goal-level
 * acceptance criterion is unsafe, so the meta-judge ESCALATEs/REVISEs on any
 * gap (PlanVerdict.uncoveredCriteria). Separated from the LLM call so the
 * coverage check is deterministic and unit-testable on its own.
 */
import type { AcceptanceCriterion, Plan } from "../types.js";

/**
 * The ids of `goalCriteria` that no node in `plan` covers. A criterion is
 * covered iff some node carries an acceptance criterion with the same id.
 * Order follows `goalCriteria`; empty ⇒ full coverage (the meta-judge's
 * PROCEED precondition).
 */
export function planCoverageGaps(plan: Plan, goalCriteria: AcceptanceCriterion[]): string[] {
  const covered = new Set<string>();
  for (const node of plan.nodes) {
    for (const ac of node.acceptanceCriteria) covered.add(ac.id);
  }
  return goalCriteria.filter((ac) => !covered.has(ac.id)).map((ac) => ac.id);
}
