/**
 * Workflow ↔ client wire names (WP-121). Pure constants — importable from
 * both the deterministic workflow bundle and Node-side client code.
 * durable-runner.md maps each to its Temporal primitive.
 */

export const TASK_QUEUE_DEFAULT = "chikory-runs";

/** ESCALATE answer (DX-8 P1 stopgap). */
export const SIGNAL_APPROVE = "approve";
/** Mid-run correction (WP-212; drained into next step's context). */
export const SIGNAL_INJECT = "inject";
/** `chikory resume --add-budget` (WP-124 / DX-7). */
export const SIGNAL_TOP_UP = "topUp";
/** Graceful, checkpointed cancel. */
export const SIGNAL_CANCEL = "cancel";
/** `chikory status` reads live without disturbing the run. */
export const QUERY_STATUS = "status";

export interface ApproveDecision {
  approved: boolean;
  reason?: string;
}
