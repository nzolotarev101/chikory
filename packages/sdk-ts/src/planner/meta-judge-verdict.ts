import type {
  AcceptanceCriterion,
  Plan,
  PlanVerdict,
  PlanVerdictKind,
} from "../types.js";
import { planCoverageGaps } from "./coverage.js";

/** Schema-valid plan judge reply consumed by WP-219 S2b (ADR-005 D2). */
export interface PlanJudgeReply {
  kind: PlanVerdictKind;
  rationale: string;
}

/**
 * Builds the deterministic WP-219 S2b plan verdict, including the ADR-005 D2
 * coverage safety floor.
 */
export function buildPlanVerdict(
  reply: PlanJudgeReply,
  plan: Plan,
  goalCriteria: AcceptanceCriterion[],
): PlanVerdict {
  const uncoveredCriteria = planCoverageGaps(plan, goalCriteria);
  const coverageOverride = reply.kind === "PROCEED" && uncoveredCriteria.length > 0;

  return {
    kind: coverageOverride ? "REVISE" : reply.kind,
    rationale: coverageOverride
      ? `${reply.rationale} [coverage override: plan leaves goal criteria uncovered: ${uncoveredCriteria.join(", ")} - cannot PROCEED]`
      : reply.rationale,
    uncoveredCriteria,
  };
}
