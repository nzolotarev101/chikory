import type { PlanGateFailureClass } from "./plan-gate-failure.js";

/**
 * WP-233(b): render the F-33 operator-facing plan-gate failure notice so an
 * unreachable meta-judge infrastructure fault is not conflated with a genuine
 * plan rejection. Consumes the WP-233(a) `classifyPlanGateFailure` result as
 * authoritative and only branches on its class.
 */
export function renderPlanGateFailureNotice(cls: PlanGateFailureClass): string {
  if (cls.kind === "infra") {
    return `plan gate could not reach the meta-judge — INFRA fault, SAFE to re-run: ${cls.reason}`;
  }

  return `plan gate REJECTED the plan — NOT safe to re-run as-is: ${cls.reason}`;
}
