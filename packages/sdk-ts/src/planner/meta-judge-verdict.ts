import type {
  AcceptanceCriterion,
  Plan,
  PlanVerdict,
  PlanVerdictKind,
} from "../types.js";
import { planCoverageGaps } from "./coverage.js";
import { planLiteralGaps } from "./literal-preservation.js";
import { planOracleGaps } from "./oracle-floor.js";

/** Schema-valid plan judge reply consumed by WP-219 S2b (ADR-005 D2). */
export interface PlanJudgeReply {
  kind: PlanVerdictKind;
  rationale: string;
}

/**
 * Builds the deterministic WP-219 S2b plan verdict over three safety floors,
 * each of which downgrades a PROCEED to REVISE at plan time:
 *   - ADR-005 D2 COVERAGE — a decomposition that drops a goal criterion;
 *   - WP-257 §4 LITERALS — a paraphrasing planner that silently drops mandated
 *     backtick literals from the goal (F-64);
 *   - F-221 ORACLE — a node with no acceptance criterion a shell can settle,
 *     which the chain will nonetheless kill for failing one (dogfood-120 `N-2`).
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

  const oracleGaps = planOracleGaps(plan);
  const oracleOverride = reply.kind === "PROCEED" && oracleGaps.length > 0;

  const overrideSuffix = `${
    coverageOverride
      ? ` [coverage override: plan leaves goal criteria uncovered: ${uncoveredCriteria.join(", ")} - cannot PROCEED]`
      : ""
  }${
    literalOverride
      ? ` [literal override: plan drops mandated goal literals: ${literalGaps.join(", ")} - cannot PROCEED]`
      : ""
  }${
    oracleOverride
      ? ` [oracle override: nodes with no executable acceptance check: ${oracleGaps.join(", ")} - cannot PROCEED]`
      : ""
  }`;

  return {
    kind: coverageOverride || literalOverride || oracleOverride ? "REVISE" : reply.kind,
    rationale: `${reply.rationale}${overrideSuffix}`,
    uncoveredCriteria,
  };
}
