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
 * S3-wiring v1 (the incremental SUCCESS-path slice): dispatch is sequential,
 * each node runs as a fresh TaskSpec, and a `FAILED` node halts the chain
 * (`deriveChainStatus` → FAILED). The D3 halt-and-replan re-invoke, S4 context
 * handoff (predecessor checkpoint + compaction note), and parallel ready-node
 * fan-out are deferred follow-ups.
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
    const runId = childRunId(chainId, node.id);
    await activities.recordNodeStarted({ chainId, nodeId: node.id, childRunId: runId });

    const childSpec = planNodeToTaskSpec(node, template, plan.id);
    const runStatus: RunStatus = await executeChild(agentLoop, {
      workflowId: runId,
      args: [childSpec],
      taskQueue,
    });

    const outcome = await activities.readNodeOutcome({ childRunId: runId });
    await activities.recordNodeSealed({ chainId, nodeId: node.id, outcome });

    // Fold: record the node→run linkage and the sealed outcome, recompute status.
    record = advanceChain(
      { ...record, nodeRuns: { ...record.nodeRuns, [node.id]: runId } },
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
