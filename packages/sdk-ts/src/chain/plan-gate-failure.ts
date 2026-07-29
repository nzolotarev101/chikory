import type { PlanVerdict } from "../types.js";

export interface PlanGateFailureClass {
  kind: "infra" | "revisable" | "substantive";
  safeToReRun: boolean;
  reason: string;
}

export const PLAN_GATE_INFRA_REASON_PREFIXES: readonly string[] = [
  "plan meta-judge LLM call failed after ",
  "plan meta-judge reply was not valid JSON: ",
  "plan meta-judge reply failed schema validation: ",
];

/**
 * WP-233(a): classify non-PROCEED plan-gate verdicts so the F-33 conflation of
 * transport/meta-judge infrastructure failure and substantive plan rejection is
 * explicit. This mirrors the pure-first cadence of `assessLaunchModeMismatch`
 * and `planLiteralGaps`.
 *
 * WP-542/F-207 adds the third class the first two conflated. A REVISE verdict is
 * the gate saying the plan has *fixable* gaps (ADR-005 D2: "REVISE → re-plan"),
 * yet it was rendered as "REJECTED — NOT safe to re-run as-is" — precisely
 * backwards, and what taught the operator to hand-edit the goal spec between
 * launches. `revisable` is safe to re-run because re-planning is exactly the
 * fix; only a substantive ESCALATE genuinely needs a human first.
 */
export function classifyPlanGateFailure(verdict: PlanVerdict): PlanGateFailureClass | null {
  if (verdict.kind === "PROCEED") {
    return null;
  }

  const isInfra = PLAN_GATE_INFRA_REASON_PREFIXES.some((prefix) =>
    verdict.rationale.startsWith(prefix),
  );

  if (isInfra) {
    return { kind: "infra", safeToReRun: true, reason: verdict.rationale };
  }

  if (verdict.kind === "REVISE") {
    return { kind: "revisable", safeToReRun: true, reason: verdict.rationale };
  }

  return { kind: "substantive", safeToReRun: false, reason: verdict.rationale };
}
