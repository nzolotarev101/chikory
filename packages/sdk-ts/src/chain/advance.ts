import type { ChainRecord, ChainStatus, NodeOutcome } from "../types.js";

/**
 * Derives the WP-219 chain status from sealed node outcomes per ADR-005 D3/D4.
 */
export function deriveChainStatus(record: ChainRecord): ChainStatus {
  const activeNodeIds = new Set(record.plan.nodes.map((node) => node.id));
  const outcomes = Object.entries(record.nodeOutcomes)
    .filter(([nodeId]) => activeNodeIds.has(nodeId))
    .map(([, outcome]) => outcome);

  if (outcomes.some((outcome) => outcome.verdict === "ESCALATE")) {
    return "AWAITING_PLAN_APPROVAL";
  }

  if (outcomes.some((outcome) => outcome.status === "FAILED")) {
    return "FAILED";
  }

  if (
    record.plan.nodes.every(
      (node) => record.nodeOutcomes[node.id]?.status === "SUCCESS",
    )
  ) {
    return "SUCCESS";
  }

  return "RUNNING";
}

/**
 * Folds one sealed PlanNode outcome into the WP-219 chain state per ADR-005 D3/D4.
 */
export function advanceChain(
  record: ChainRecord,
  nodeId: string,
  outcome: NodeOutcome,
): ChainRecord {
  const nextRecord: ChainRecord = {
    ...record,
    nodeOutcomes: {
      ...record.nodeOutcomes,
      [nodeId]: outcome,
    },
  };

  return {
    ...nextRecord,
    status: deriveChainStatus(nextRecord),
  };
}
