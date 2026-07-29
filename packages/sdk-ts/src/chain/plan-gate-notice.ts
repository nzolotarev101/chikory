import type { PlanGateFailureClass } from "./plan-gate-failure.js";

/**
 * WP-233(b): render the F-33 operator-facing plan-gate failure notice so an
 * unreachable meta-judge infrastructure fault is not conflated with a genuine
 * plan rejection. Consumes the WP-233(a) `classifyPlanGateFailure` result as
 * authoritative and only branches on its class.
 *
 * WP-542/F-207: a `revisable` REVISE reaching this renderer means the automated
 * repair loop already ran and did not converge, so the notice names the exhausted
 * budget rather than implying the operator must hand-edit the goal spec.
 */
export function renderPlanGateFailureNotice(
  cls: PlanGateFailureClass,
  repairAttempts = 0,
): string {
  if (cls.kind === "infra") {
    return `plan gate could not reach the meta-judge — INFRA fault, SAFE to re-run: ${cls.reason}`;
  }

  if (cls.kind === "revisable") {
    const spent =
      repairAttempts > 0
        ? `${repairAttempts} automated repair attempt(s) did not converge`
        : "automated repair is disabled";
    return `plan gate asked for a REVISION and ${spent} — safe to re-run: ${cls.reason}`;
  }

  return `plan gate REJECTED the plan — NOT safe to re-run as-is: ${cls.reason}`;
}
