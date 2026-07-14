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
 * S3 wiring dispatches sequentially and each node runs as a fresh TaskSpec.
 * A `FAILED` node runs through the pure D3 replan decision; zero replan budget
 * preserves the original halt-on-FAILED path. ADR-007 S4 passes every
 * predecessor as an artifact-backed Git bundle plus a bounded structured note.
 * Parallel ready-node fan-out remains deferred.
 */
import { executeChild, proxyActivities, workflowInfo } from "@temporalio/workflow";

import type { ChainRecord, ChainStatus, Plan, RunStatus } from "../types.js";
import { agentLoop } from "../workflow/agent-loop.js";
import type { ChainActivities } from "./activities.js";
import { advanceChain, deriveChainStatus } from "./advance.js";
import { decideChainCompletionReview } from "./completion-review.js";
import { buildStructuredCompactionNote } from "./compaction-note.js";
import { childRunId, planNodeToTaskSpec, type ChainNodeTemplate } from "./node-spec.js";
import { decideReplan } from "./replan.js";
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

// WP-311 chain-completion review runs a real judge LLM call + git over the
// cumulative diff — minutes, not seconds — so it needs its own generous cap
// (the per-node judge activities in `activities` above must stay short). The
// journal write is idempotent (`appendOnce`), so a retry never double-records.
const reviewActivities = proxyActivities<ChainActivities>({
  startToCloseTimeout: "15 minutes",
  retry: {
    initialInterval: "2 seconds",
    backoffCoefficient: 2,
    maximumInterval: "30 seconds",
    maximumAttempts: 3,
  },
});

export interface ChainLoopInput {
  /** The decomposed, plan-meta-judge-PROCEED'd plan to execute. */
  plan: Plan;
  /** Shared per-chain TaskSpec surface every node run inherits. */
  template: ChainNodeTemplate;
  /** D3 guardrail: absent/zero keeps the legacy halt-on-FAILED path. */
  maxReplans?: number;
}

/** workflowId = chain-id (mirrors agentLoop's workflowId = run-id mapping). */
export async function chainLoop(input: ChainLoopInput): Promise<ChainStatus> {
  const { workflowId: chainId, taskQueue } = workflowInfo();
  const { template } = input;
  let plan = input.plan;
  const maxReplans = input.maxReplans ?? 0;

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
    const structuredNotes = predecessors.flatMap((predecessor) => {
      const outcome = record.nodeOutcomes[predecessor.id];
      if (outcome === undefined) return [];
      return [
        buildStructuredCompactionNote({
          node: predecessor,
          outcome,
          handoff: record.nodeHandoffs?.[predecessor.id],
        }),
      ];
    });
    const handoffNote = predecessors.length > 0
      ? [
          "## Already completed by predecessor nodes (do not redo)",
          ...predecessors.map((predecessor) => `- ${predecessor.id}: ${predecessor.goal}`),
          "The code from these nodes is ALREADY PRESENT in your workspace. Build on it.",
          ...(structuredNotes.length > 0
            ? ["", "## Structured predecessor compaction notes", ...structuredNotes]
            : []),
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
      {
        goal: plan.goal,
        outline: plan.nodes.map((planNode) => `${planNode.id}: ${planNode.goal}`),
      },
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
    if (outcome.status === "FAILED") {
      const decision = decideReplan(record, node.id, maxReplans);
      if (decision.action === "REPLAN") {
        const replanned = await activities.replanRemaining({
          chainId,
          plan,
          failedNodeId: node.id,
          remainingNodeIds: decision.remainingNodeIds,
          decision,
        });
        if (replanned.status === "SUCCESS") {
          plan = replanned.plan;
          await activities.recordNodeReplanned({
            chainId,
            failedNodeId: node.id,
            reason: decision.reason,
            revisedPlan: replanned.plan,
          });
          record = {
            ...record,
            planId: replanned.plan.id,
            plan: replanned.plan,
            status: "RUNNING",
          };
        } else {
          reason = replanned.reason;
        }
      } else {
        reason = maxReplans > 0 ? decision.reason : undefined;
      }
    }
    void runStatus; // terminal status is sourced from the journal via readNodeOutcome
  }

  // WP-311 chain-completion aggregate design review: at the SUCCESS seal, ONE
  // judge pass over the whole chain's cumulative cross-node diff + `plan.goal`.
  // Non-destructive — a finished chain is never re-judged/re-parked (F-107); the
  // review only records findings, so the status is unchanged either way.
  if (record.status === "SUCCESS") {
    const succeededCount = Object.values(record.nodeOutcomes).filter(
      (outcome) => outcome.status === "SUCCESS",
    ).length;
    const review = decideChainCompletionReview({
      nodeCount: plan.nodes.length,
      succeededCount,
      alreadyReviewed: false,
    });
    if (review.action === "review") {
      await reviewActivities.reviewChainCompletion({
        chainId,
        plan,
        nodeRuns: record.nodeRuns,
        nodeOutcomes: record.nodeOutcomes,
        repos: template.repos,
        judge: template.judge,
        routing: template.routing,
      });
    }
  }

  if (record.status === "SUCCESS" || record.status === "FAILED") {
    await activities.sealChain({ chainId, status: record.status, reason });
  }
  return record.status;
}
