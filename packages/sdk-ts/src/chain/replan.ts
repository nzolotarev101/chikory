import type { ChainRecord } from "../types.js";

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

function boundedBudget(maxReplans: number): number {
  return Number.isFinite(maxReplans) && maxReplans > 0 ? Math.floor(maxReplans) : 0;
}

/**
 * Pure D3 halt-and-replan decision. The just-failed node is already present in
 * `record.nodeOutcomes`, so the count of FAILED outcomes is the number of
 * replans that would have been consumed after approving this decision.
 */
export function decideReplan(
  record: ChainRecord,
  failedNodeId: string,
  maxReplans: number,
): ReplanDecision {
  const budget = boundedBudget(maxReplans);
  const failedOutcome = record.nodeOutcomes[failedNodeId];
  const sealedNodeIds = new Set(Object.keys(record.nodeOutcomes));
  const remainingNodeIds = record.plan.nodes
    .map((node) => node.id)
    .filter((nodeId) => !sealedNodeIds.has(nodeId));
  const failedCount = Object.values(record.nodeOutcomes).filter(
    (outcome) => outcome.status === "FAILED",
  ).length;

  if (failedOutcome?.status !== "FAILED") {
    return {
      action: "HALT",
      reason: "no failed node outcome is sealed for the requested node",
      remainingNodeIds,
      replansUsed: failedCount,
      maxReplans: budget,
    };
  }

  if (failedCount > budget) {
    return {
      action: "HALT",
      reason: `replan budget exhausted: ${failedCount} failed node(s) exceeds max ${budget}`,
      failedNodeId,
      remainingNodeIds,
      replansUsed: failedCount,
      maxReplans: budget,
    };
  }

  return {
    action: "REPLAN",
    reason: `failed node ${failedNodeId} is within replan budget ${failedCount}/${budget}`,
    failedNodeId,
    remainingNodeIds,
    replansUsed: failedCount,
    maxReplans: budget,
  };
}
