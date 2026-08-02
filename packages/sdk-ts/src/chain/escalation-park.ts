/**
 * F-208 — resolving an **answered** escalation park (ADR-009 D1, tier 2/3).
 *
 * `deriveChainStatus` parks the whole chain in `AWAITING_PLAN_APPROVAL` when
 * any node outcome carries `verdict === "ESCALATE"` (ADR-005 §S3 rule 1: "a
 * human question outranks a mechanical failure"). That rule reads a *sealed*
 * outcome — and a sealed escalation has already been answered: the child run
 * blocks inside `executeChild` while it is `AWAITING_APPROVAL` and only seals
 * once a human approves/rejects (or an unattended policy seals it). So the park
 * the reducer derives has nobody left to unpark it.
 *
 * The consequence was a dead end: `chainLoop` exited its loop in a status that
 * is neither RUNNING nor SUCCESS/FAILED, so it wrote **no terminal entry**;
 * `chikory chain approve` then found no in-flight node to signal, and
 * `chikory chain resume` found no sealed state to re-enter. The launch was
 * un-actionable with the plan, the node evidence, and the replan trail all
 * intact on disk (dogfood-120, `chain-0723ac0b-…`).
 *
 * ADR-005 §S3 is explicit that non-node transitions are the ORCHESTRATOR's, not
 * the reducer's — so the resolution lives here (pure, workflow-safe, type-only
 * imports) and the four-rule reducer stays byte-unchanged, as does its Python
 * parity port (`chikory/chain_advance.py`).
 *
 * Two observers need it:
 *   - `chainLoop`, which converts the park into the resumable FAILED seal the
 *     WP-521(c) resume path already understands, before it returns;
 *   - `chikory chain resume`, which repairs a chain ALREADY orphaned by the
 *     pre-fix workflow (its execution is gone, its journal never sealed).
 */
import type { ChainStatus } from "../types.js";

/** Seal reason for a chain halted on an escalation a human already answered. */
export const ANSWERED_ESCALATION_REASON = "chain halted on an answered node escalation";

/** Seal reason for a chain whose workflow vanished without a terminal entry. */
export const ORPHANED_CHAIN_REASON = "chain workflow exited without sealing";

/**
 * Seal reason for a chain whose workflow AND whose dispatched node both vanished
 * (F-240). Distinct from `ORPHANED_CHAIN_REASON` because the node run left
 * evidence on disk that a resume can heal from, while a plain orphan did not.
 */
export const ABANDONED_NODE_REASON =
  "chain workflow exited mid-node; the node's own workflow is gone too";

export interface AnsweredEscalationPark {
  /** Status the reducer derived from the sealed node outcomes. */
  status: ChainStatus;
  /** Ids of ACTIVE plan nodes whose sealed outcome is FAILED. */
  failedNodeIds: string[];
}

export type ParkResolution =
  | { action: "seal"; status: "FAILED"; resumable: boolean; reason: string }
  | { action: "none"; reason: string };

function sealFor(failedNodeIds: string[], prefix: string): ParkResolution {
  return {
    action: "seal",
    status: "FAILED",
    // A resumable seal grants the failed node one fresh heal attempt
    // (WP-521(c)); with no failed node there is nothing for a resume to heal.
    resumable: failedNodeIds.length > 0,
    reason:
      failedNodeIds.length > 0 ? `${prefix}: ${failedNodeIds.join(", ")}` : prefix,
  };
}

/**
 * Workflow-side: convert an answered escalation park into a terminal seal so
 * every `chainLoop` incarnation ends in SUCCESS or FAILED — never in a park
 * with no signal that can clear it.
 */
export function resolveAnsweredEscalationPark(park: AnsweredEscalationPark): ParkResolution {
  if (park.status !== "AWAITING_PLAN_APPROVAL") {
    return { action: "none", reason: `chain is ${park.status}` };
  }
  return sealFor(park.failedNodeIds, ANSWERED_ESCALATION_REASON);
}

/** What the CLI could learn about the chain's Temporal execution. */
export type ChainWorkflowLiveness = "live" | "gone" | "unknown";

export interface ChainOrphanState {
  /** Persisted chain status (`chains.status`), not a re-derived one. */
  status: ChainStatus;
  /** Whether a dispatched node has no sealed outcome (a signal target exists). */
  hasInflightNode: boolean;
  /**
   * F-240: whether that node's OWN Temporal execution is still running. A
   * dispatched node with no sealed outcome only means "a signal target exists"
   * while its workflow can receive one; once the host process dies mid-node the
   * node is abandoned, not in flight, and `hasInflightNode` alone would decline
   * the repair forever. Omit when there is no in-flight node; `undefined` with
   * one present is read as `"unknown"` and declines, fail-closed.
   */
  inflightNodeWorkflow?: ChainWorkflowLiveness;
  /** Whether the chain's Temporal execution is still running. */
  workflow: ChainWorkflowLiveness;
  /** Ids of ACTIVE plan nodes whose sealed outcome is FAILED. */
  failedNodeIds: string[];
}

/**
 * CLI-side: decide whether an un-sealed chain is orphaned and may be repaired
 * into a resumable FAILED seal. Every guard is fail-closed — a live workflow, a
 * signalable in-flight node, or an unreachable server all mean "do not write".
 */
export function decideChainOrphanRepair(state: ChainOrphanState): ParkResolution {
  if (state.status === "SUCCESS" || state.status === "FAILED") {
    return { action: "none", reason: `chain already sealed ${state.status}` };
  }
  // F-240: an un-sealed dispatched node blocks the repair only while its own
  // execution can still be signalled. When the host process dies mid-node both
  // workflows go with it, and declining here left the chain RUNNING with no
  // command that could ever seal it (chain-ebecd792, dogfood-122).
  const nodeAbandoned = state.hasInflightNode && state.inflightNodeWorkflow === "gone";
  if (state.hasInflightNode && !nodeAbandoned) {
    return {
      action: "none",
      reason:
        state.inflightNodeWorkflow === "live"
          ? "a node is still in flight — deliver its decision with chikory chain approve"
          : "cannot reach Temporal to confirm the in-flight node's workflow has exited",
    };
  }
  if (state.workflow === "live") {
    return { action: "none", reason: "the chain workflow is still running" };
  }
  if (state.workflow === "unknown") {
    return {
      action: "none",
      reason: "cannot reach Temporal to confirm the chain workflow has exited",
    };
  }
  return sealFor(
    state.failedNodeIds,
    nodeAbandoned ? ABANDONED_NODE_REASON : ORPHANED_CHAIN_REASON,
  );
}

/**
 * Ids of nodes IN THE ACTIVE PLAN whose sealed outcome is FAILED. Mirrors
 * `deriveChainStatus`'s active-node filter: a node spliced out by a replan
 * (`N-1` → `N-1-r1`) keeps its outcome in the journal but no longer counts.
 */
export function failedActiveNodeIds(input: {
  nodeIds: string[];
  outcomeStatusById: Record<string, string | undefined>;
}): string[] {
  return input.nodeIds.filter((nodeId) => input.outcomeStatusById[nodeId] === "FAILED");
}
