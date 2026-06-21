/**
 * The chain executor (WP-219 S3-wiring, ADR-005 §S3) — a Temporal workflow
 * that orchestrates an already-gated `Plan` as a tree of ordinary judge-gated
 * runs. It is *above* the run loop, never inside it (the ADR's core decision,
 * NF-1): it loops `readyNodes` over the plan, spawns one child `agentLoop` run
 * per ready node, folds each sealed node's `NodeOutcome` through the pure
 * `advanceChain` reducer, and journals `node_started` / `node_sealed`.
 *
 * Determinism (same contract as `agentLoop`): the workflow body is pure —
 * `readyNodes` + `advanceChain` + `deriveChainStatus` are pure, every durable
 * write/read is a proxied chain activity, and child runs go through
 * `executeChild`. A crashed worker replays deterministically from history.
 *
 * S3 wiring dispatches sequentially,
 * each node runs as a fresh TaskSpec, and a `FAILED` node halts the chain
 * (`deriveChainStatus` → FAILED). ADR-007 S4 passes every predecessor as an
 * artifact-backed Git bundle plus a static note. D3 halt-and-replan,
 * structured compaction notes, and parallel ready-node fan-out remain deferred.
 */
import { executeChild, proxyActivities, workflowInfo } from "@temporalio/workflow";

import type { ChainRecord, ChainStatus, Plan, RunStatus } from "../types.js";
import { agentLoop } from "../workflow/agent-loop.js";
import type { ChainActivities } from "./activities.js";
import { advanceChain, deriveChainStatus } from "./advance.js";
import { childRunId, planNodeToTaskSpec, type ChainNodeTemplate } from "./node-spec.js";
import { readyNodes } from "./sequencing.js";

const activities = proxyActivities<ChainActivities>({
  startToCloseTimeout: "1 minute",
  heartbeatTimeout: "15 seconds",
  retry: {
    initialInterval: "1 second",
    backoffCoefficient: 2,
    maximumInterval: "30 seconds",
  },
});

export interface ChainLoopInput {
  /** The decomposed, plan-meta-judge-PROCEED'd plan to execute. */
  plan: Plan;
  /** Shared per-chain TaskSpec surface every node run inherits. */
  template: ChainNodeTemplate;
}

/** workflowId = chain-id (mirrors agentLoop's workflowId = run-id mapping). */
export async function chainLoop(input: ChainLoopInput): Promise<ChainStatus> {
  const { workflowId: chainId, taskQueue } = workflowInfo();
  const { plan, template } = input;

  await activities.initChain({ chainId, plan });

  let record: ChainRecord = {
    planId: plan.id,
    plan,
    nodeRuns: {},
    nodeOutcomes: {},
    nodeHandoffs: {},
    status: "RUNNING",
  };
  // An empty (or already-complete) plan resolves immediately.
  record = { ...record, status: deriveChainStatus(record) };

  let reason: string | undefined;

  while (record.status === "RUNNING") {
    const succeeded = Object.entries(record.nodeOutcomes)
      .filter(([, outcome]) => outcome.status === "SUCCESS")
      .map(([id]) => id);
    const sealed = new Set(Object.keys(record.nodeOutcomes));
    const ready = readyNodes(plan, succeeded).filter((node) => !sealed.has(node.id));

    if (ready.length === 0) {
      // A valid acyclic plan in RUNNING always has a ready node; none means a
      // dependency can never be satisfied (a sealed-but-not-SUCCESS node starves
      // its dependents — already covered by deriveChainStatus's FAILED rule, so
      // this is a defensive guard for a malformed plan).
      record = { ...record, status: "FAILED" };
      reason = "chain stuck: no runnable node (unsatisfiable dependency)";
      break;
    }

    // Sequential dispatch (v1): run the first ready node, fold, re-derive.
    const node = ready[0]!;
    // 0-based dispatch order (sequential → deterministic): every already-sealed
    // node has been dispatched, so the count is this node's index (WP-243).
    const dispatchIndex = Object.keys(record.nodeOutcomes).length;
    const runId = childRunId(chainId, node.id);
    await activities.recordNodeStarted({ chainId, nodeId: node.id, childRunId: runId });

    const predecessorId = node.dependsOn[0];
    const parentRunId =
      predecessorId !== undefined ? record.nodeRuns[predecessorId] : undefined;
    const parentHandoffs = node.dependsOn.flatMap((id) => {
      const handoff = record.nodeHandoffs?.[id];
      return handoff === undefined ? [] : [handoff];
    });
    const predecessors = node.dependsOn.flatMap((id) => {
      const predecessor = plan.nodes.find((candidate) => candidate.id === id);
      return predecessor === undefined ? [] : [predecessor];
    });
    const handoffNote = predecessors.length > 0
      ? [
          "## Already completed by predecessor nodes (do not redo)",
          ...predecessors.map((predecessor) => `- ${predecessor.id}: ${predecessor.goal}`),
          "The code from these nodes is ALREADY PRESENT in your workspace. Build on it.",
        ].join("\n")
      : undefined;
    const childSpec = planNodeToTaskSpec(
      node,
      template,
      plan.id,
      parentRunId,
      handoffNote,
      chainId,
      parentHandoffs,
      dispatchIndex,
    );
    const runStatus: RunStatus = await executeChild(agentLoop, {
      workflowId: runId,
      args: [childSpec],
      taskQueue,
    });

    const result = await activities.readNodeResult({ childRunId: runId });
    const { outcome } = result;
    await activities.recordNodeSealed({
      chainId,
      nodeId: node.id,
      outcome,
      ...(result.handoff !== undefined ? { handoff: result.handoff } : {}),
    });

    // Fold: record the node→run linkage and the sealed outcome, recompute status.
    record = advanceChain(
      {
        ...record,
        nodeRuns: { ...record.nodeRuns, [node.id]: runId },
        nodeHandoffs:
          result.handoff === undefined
            ? record.nodeHandoffs
            : { ...record.nodeHandoffs, [node.id]: result.handoff },
      },
      node.id,
      outcome,
    );
    void runStatus; // terminal status is sourced from the journal via readNodeOutcome
  }

  if (record.status === "SUCCESS" || record.status === "FAILED") {
    await activities.sealChain({ chainId, status: record.status, reason });
  }
  return record.status;
}
