import type { ChainRecord } from "../types.js";

/** Heal attempts ONE node lineage may consume before the chain gives up on it. */
export const DEFAULT_MAX_REPLANS_PER_NODE = 1;

/**
 * How many heal attempts the chain will grant, and to whom.
 *
 * F-213: before WP-544 there was a single chain-wide counter compared against
 * every FAILED outcome the record had ever held. On dogfood-120 that meant
 * `N-1`'s two failed incarnations kept debiting the budget **after**
 * `N-1-r1-r2` succeeded and replaced them, so `N-2` — the next node to fail, on
 * a six-node plan — was refused with `replan budget exhausted: 3 failed
 * node(s) exceeds max 1` without ever being granted one attempt.
 */
export interface ReplanBounds {
  /** Attempts one lineage (`N-1` → `N-1-r1` → `N-1-r1-r2`) may consume. */
  maxPerNode: number;
  /** Ceiling across the chain — CG-1: bounded, never a loop. */
  maxChain: number;
}

export type ReplanDecision =
  | {
      action: "REPLAN";
      reason: string;
      failedNodeId: string;
      remainingNodeIds: string[];
      replansUsed: number;
      maxReplans: number;
    }
  | {
      action: "HALT";
      reason: string;
      failedNodeId?: string;
      remainingNodeIds: string[];
      replansUsed: number;
      maxReplans: number;
    };

function bounded(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * The original node a retry incarnation descends from: `N-1-r1-r2` → `N-1`.
 * `replanRemaining` mints retries by suffixing `-r<n>`, so the suffix chain is
 * the lineage — the unit a per-node heal budget must be counted over.
 */
export function nodeLineageRoot(nodeId: string): string {
  let root = nodeId;
  for (;;) {
    const stripped = root.replace(/-r\d+$/, "");
    if (stripped === root) return root;
    root = stripped;
  }
}

/**
 * Bounds that grant exactly ONE more attempt regardless of what the run has
 * already spent — the operator-triggered heal `chikory chain resume` delivers
 * (WP-521(c)). Sized to the counts already on the record, so the very next
 * failure re-seals resumable and the operator, not a loop, decides again.
 */
export function resumeGrantBounds(record: ChainRecord, failedNodeId: string): ReplanBounds {
  const planNodeIds = new Set(record.plan.nodes.map((node) => node.id));
  const failedIds = Object.entries(record.nodeOutcomes)
    .filter(([, outcome]) => outcome.status === "FAILED")
    .map(([nodeId]) => nodeId);
  const lineage = nodeLineageRoot(failedNodeId);
  return {
    maxPerNode: failedIds.filter((id) => nodeLineageRoot(id) === lineage).length,
    maxChain: failedIds.filter((id) => planNodeIds.has(id)).length,
  };
}

/**
 * Pure D3 halt-and-replan decision. The just-failed node is already present in
 * `record.nodeOutcomes`, so its own failure is included in both counts below.
 *
 * Two budgets, because they answer different questions. The per-lineage count
 * asks "has THIS node had its chances?" and therefore includes the lineage's
 * spliced-out incarnations. The chain count asks "is the whole chain thrashing?"
 * and therefore counts only nodes the CURRENT plan still contains — a lineage
 * that was replanned and then succeeded is not evidence of thrash, and must not
 * be charged to the nodes that come after it.
 */
export function decideReplan(
  record: ChainRecord,
  failedNodeId: string,
  bounds: ReplanBounds,
): ReplanDecision {
  const maxPerNode = bounded(bounds.maxPerNode);
  const maxChain = bounded(bounds.maxChain);
  const failedOutcome = record.nodeOutcomes[failedNodeId];
  const planNodeIds = new Set(record.plan.nodes.map((node) => node.id));
  const sealedNodeIds = new Set(Object.keys(record.nodeOutcomes));
  const remainingNodeIds = record.plan.nodes
    .map((node) => node.id)
    .filter((nodeId) => !sealedNodeIds.has(nodeId));

  const failedIds = Object.entries(record.nodeOutcomes)
    .filter(([, outcome]) => outcome.status === "FAILED")
    .map(([nodeId]) => nodeId);
  const lineage = nodeLineageRoot(failedNodeId);
  const lineageFailures = failedIds.filter((id) => nodeLineageRoot(id) === lineage).length;
  const liveChainFailures = failedIds.filter((id) => planNodeIds.has(id)).length;

  if (failedOutcome?.status !== "FAILED") {
    return {
      action: "HALT",
      reason: "no failed node outcome is sealed for the requested node",
      remainingNodeIds,
      replansUsed: liveChainFailures,
      maxReplans: maxChain,
    };
  }

  if (lineageFailures > maxPerNode) {
    return {
      action: "HALT",
      reason:
        `replan budget exhausted for node ${lineage}: ` +
        `${lineageFailures} failed attempt(s) exceeds max ${maxPerNode} per node`,
      failedNodeId,
      remainingNodeIds,
      replansUsed: lineageFailures,
      maxReplans: maxPerNode,
    };
  }

  if (liveChainFailures > maxChain) {
    return {
      action: "HALT",
      reason: `replan budget exhausted: ${liveChainFailures} failed node(s) exceeds max ${maxChain}`,
      failedNodeId,
      remainingNodeIds,
      replansUsed: liveChainFailures,
      maxReplans: maxChain,
    };
  }

  return {
    action: "REPLAN",
    reason: `failed node ${failedNodeId} is within replan budget ${lineageFailures}/${maxPerNode}`,
    failedNodeId,
    remainingNodeIds,
    replansUsed: lineageFailures,
    maxReplans: maxPerNode,
  };
}
