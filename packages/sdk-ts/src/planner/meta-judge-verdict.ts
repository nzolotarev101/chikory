import type {
  AcceptanceCriterion,
  Plan,
  PlanVerdict,
  PlanVerdictKind,
} from "../types.js";
import { planCoverageGaps } from "./coverage.js";
import { planLiteralGaps } from "./literal-preservation.js";

/** Schema-valid plan judge reply consumed by WP-219 S2b (ADR-005 D2). */
export interface PlanJudgeReply {
  kind: PlanVerdictKind;
  rationale: string;
}

/**
 * Builds the deterministic WP-219 S2b plan verdict, including the ADR-005 D2
 * coverage safety floor and the WP-257 §4 literal-preservation floor: a
 * paraphrasing planner that silently drops mandated backtick literals from the
 * goal (F-64) is caught here and downgraded PROCEED→REVISE at plan time.
 */
export function buildPlanVerdict(
  reply: PlanJudgeReply,
  plan: Plan,
  goalCriteria: AcceptanceCriterion[],
): PlanVerdict {
  const uncoveredCriteria = planCoverageGaps(plan, goalCriteria);
  const coverageOverride = reply.kind === "PROCEED" && uncoveredCriteria.length > 0;

  const literalGaps = planLiteralGaps(plan);
  const literalOverride = reply.kind === "PROCEED" && literalGaps.length > 0;

  const overrideSuffix = `${
    coverageOverride
      ? ` [coverage override: plan leaves goal criteria uncovered: ${uncoveredCriteria.join(", ")} - cannot PROCEED]`
      : ""
  }${
    literalOverride
      ? ` [literal override: plan drops mandated goal literals: ${literalGaps.join(", ")} - cannot PROCEED]`
      : ""
  }`;

  return {
    kind: coverageOverride || literalOverride ? "REVISE" : reply.kind,
    rationale: `${reply.rationale}${overrideSuffix}`,
    uncoveredCriteria,
  };
}
