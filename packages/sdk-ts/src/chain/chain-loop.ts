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

import type {
  ChainRecord,
  ChainStatus,
  NodeOutcome,
  Plan,
  PlanAttemptRecord,
  RunStatus,
} from "../types.js";
import { agentLoop } from "../workflow/agent-loop.js";
import type { ChainActivities } from "./activities.js";
import { advanceChain, deriveChainStatus } from "./advance.js";
import { decideChainCompletionReview } from "./completion-review.js";
import { buildStructuredCompactionNote } from "./compaction-note.js";
import {
  failedActiveNodeIds,
  resolveAnsweredEscalationPark,
} from "./escalation-park.js";
import {
  childRunId,
  isSeededFailNode,
  planNodeToTaskSpec,
  type ChainNodeTemplate,
} from "./node-spec.js";
import { decideNodeHeal, MAX_CHILD_RESUMES_PER_NODE } from "./node-heal.js";
import { decideReplan, resumeGrantBounds, type ReplanBounds } from "./replan.js";
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
  /** D3 guardrail: attempts ONE node lineage may consume. Absent/zero keeps the
   * legacy halt-on-FAILED path. */
  maxReplans?: number;
  /**
   * F-213 chain-wide thrash ceiling, counted over nodes the CURRENT plan still
   * contains. Absent = one heal per node in the plan, which is the bound the
   * per-node budget already implies.
   */
  maxChainReplans?: number;
  /**
   * WP-542/F-207: the host-side plan-phase attempt trail (the plan gate's own
   * repair loop). Frozen into the workflow input like every other host-read —
   * the workflow body only hands it to `initChain` to journal.
   */
  planAttempts?: PlanAttemptRecord[];
}

/**
 * The outcome map without one node's seal — putting that node back in the
 * loop's ready set so its child run is re-executed (F-214). `chainRecordFrom`
 * folds `node_sealed` last-wins, so the re-seal supersedes cleanly.
 */
function withoutNode(
  outcomes: ChainRecord["nodeOutcomes"],
  nodeId: string,
): ChainRecord["nodeOutcomes"] {
  return Object.fromEntries(Object.entries(outcomes).filter(([id]) => id !== nodeId));
}

/** workflowId = chain-id (mirrors agentLoop's workflowId = run-id mapping). */
export async function chainLoop(input: ChainLoopInput): Promise<ChainStatus> {
  const { workflowId: chainId, taskQueue } = workflowInfo();
  const { template } = input;
  let plan = input.plan;
  const maxReplans = input.maxReplans ?? 0;
  const replanBounds: ReplanBounds = {
    maxPerNode: maxReplans,
    maxChain: input.maxChainReplans ?? input.plan.nodes.length,
  };

  await activities.initChain({
    chainId,
    plan,
    template,
    ...(input.planAttempts !== undefined ? { planAttempts: input.planAttempts } : {}),
  });

  // WP-521(c): rebuild state from the journal. A fresh chain restores an empty
  // record; a `chikory chain resume` re-start restores the sealed record and
  // journals the reopen boundary (`control_event source:"chain_failed_seal"`).
  const restored = await activities.restoreChain({ chainId });
  let record: ChainRecord = restored.record ?? {
    planId: plan.id,
    plan,
    nodeRuns: {},
    nodeOutcomes: {},
    nodeHandoffs: {},
    status: "RUNNING",
  };
  plan = record.plan;
  // An empty (or already-complete) plan resolves immediately.
  record = { ...record, status: deriveChainStatus(record) };

  let reason: string | undefined;
  let resumableSeal = false;

  // WP-521(c) operator resume grants ONE fresh heal attempt to the blocking
  // failed node (the operator-triggered analog of heal-by-default), through the
  // same ADR-009 tier order the loop uses: RE-ENTER the child if its run said it
  // could continue (F-214), and only rewrite the node when it could not. If the
  // attempt also fails, the loop's own decisions govern and re-seal a resumable
  // FAILED for another resume.
  if (restored.resumed) {
    const failedNode = plan.nodes.find(
      (node) => record.nodeOutcomes[node.id]?.status === "FAILED",
    );
    if (failedNode !== undefined) {
      const failedRunId = record.nodeRuns[failedNode.id];
      const failedResult =
        failedRunId !== undefined
          ? await activities.readNodeResult({ childRunId: failedRunId })
          : undefined;
      // The operator's resume IS the grant, so this tier starts from zero.
      const heal = decideNodeHeal({
        childStatus: "FAILED",
        childResumable: failedResult?.resumable === true,
        resumesUsed: 0,
      });
      // Fresh grant sized to what is already spent → exactly one REPLAN here.
      const decision = decideReplan(record, failedNode.id, resumeGrantBounds(record, failedNode.id));
      if (heal.action === "resume_child" && failedRunId !== undefined) {
        await activities.recordNodeResumed({
          chainId,
          nodeId: failedNode.id,
          childRunId: failedRunId,
          attempt: heal.attempt,
          reason: failedResult?.reason ?? heal.reason,
        });
        // Dropping the sealed outcome puts the node back in the loop's ready
        // set; the loop re-executes the SAME child workflow id, whose own
        // `restoreWorkflowState` reopens the seal and carries the remediation
        // brief forward. The node's work is never discarded to heal it.
        record = {
          ...record,
          nodeOutcomes: withoutNode(record.nodeOutcomes, failedNode.id),
          status: "RUNNING",
        };
      } else if (decision.action === "REPLAN") {
        const replanned = await activities.replanRemaining({
          chainId,
          plan,
          failedNodeId: failedNode.id,
          remainingNodeIds: decision.remainingNodeIds,
          decision,
          ...(failedResult?.reason !== undefined ? { failureReason: failedResult.reason } : {}),
        });
        if (replanned.status === "SUCCESS") {
          plan = replanned.plan;
          await activities.recordNodeReplanned({
            chainId,
            failedNodeId: failedNode.id,
            reason: decision.reason,
            revisedPlan: replanned.plan,
            ...(replanned.brief !== undefined ? { brief: replanned.brief } : {}),
          });
          record = {
            ...record,
            planId: replanned.plan.id,
            plan: replanned.plan,
            status: "RUNNING",
          };
        }
      }
    }
  }

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
    let runStatus: RunStatus = await executeChild(agentLoop, {
      workflowId: runId,
      args: [childSpec],
      taskQueue,
    });

    let result = await activities.readNodeResult({ childRunId: runId });
    // F-214: before rewriting the node, re-enter it. A child that sealed
    // `resumable: true` kept its checkpoint and its failure evidence, and
    // `restoreWorkflowState` reopens the seal, carries the remediation brief
    // into the next step, and grants a fresh bounded remediation budget
    // (WP-520) — the whole run-level heal tier the chain used to skip past.
    // Bounded per node; a dead FAILED or a spent budget falls through to the
    // replan tier below, unchanged.
    let childResumes = 0;
    for (;;) {
      const heal = decideNodeHeal(
        {
          childStatus: result.outcome.status,
          childResumable: result.resumable === true,
          resumesUsed: childResumes,
        },
        // `maxReplans: 0` is the documented heal-off opt-out (WP-521, and the
        // WP-532 drill's `CHIKORY_CHAIN_MAX_REPLANS=0`). It means "do not heal
        // a failed node", so it governs every tier, not just the replan one.
        maxReplans > 0 ? MAX_CHILD_RESUMES_PER_NODE : 0,
      );
      if (heal.action !== "resume_child") break;
      childResumes = heal.attempt;
      await activities.recordNodeResumed({
        chainId,
        nodeId: node.id,
        childRunId: runId,
        attempt: heal.attempt,
        reason: result.reason ?? heal.reason,
      });
      runStatus = await executeChild(agentLoop, {
        workflowId: runId,
        args: [childSpec],
        taskQueue,
      });
      result = await activities.readNodeResult({ childRunId: runId });
    }
    // WP-521 dogfood/test-only seam: force the targeted node's FIRST incarnation
    // to seal FAILED so heal-by-default replan is exercised deterministically on
    // a real chain. The retry node's id is `${id}-r${n}` (≠ the seeded id), so
    // only the first incarnation fails; frozen into the template host-side, never
    // an env read inside this deterministic workflow body.
    const seeded = isSeededFailNode(node.id, dispatchIndex, template.seedFailNodeId);
    const outcome: NodeOutcome = seeded ? { status: "FAILED", verdict: "HALT" } : result.outcome;
    const failureReason = seeded
      ? "seeded first-incarnation failure (CHIKORY_SEED_CHAIN_FAIL_NODE)"
      : result.reason;
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
      const decision = decideReplan(record, node.id, replanBounds);
      if (decision.action === "REPLAN") {
        const replanned = await activities.replanRemaining({
          chainId,
          plan,
          failedNodeId: node.id,
          remainingNodeIds: decision.remainingNodeIds,
          decision,
          ...(failureReason !== undefined ? { failureReason } : {}),
        });
        if (replanned.status === "SUCCESS") {
          plan = replanned.plan;
          await activities.recordNodeReplanned({
            chainId,
            failedNodeId: node.id,
            reason: decision.reason,
            revisedPlan: replanned.plan,
            ...(replanned.brief !== undefined ? { brief: replanned.brief } : {}),
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
        // A node-failure HALT (replans exhausted, or maxReplans 0) is resumable —
        // `chikory chain resume` grants a fresh heal attempt (WP-521(c)). Only the
        // malformed-plan break above (unsatisfiable dependency) is a dead FAILED.
        resumableSeal = true;
      }
    }
    void runStatus; // terminal status is sourced from the journal via readNodeOutcome
  }

  // F-208: the loop can exit in `AWAITING_PLAN_APPROVAL` — the reducer's rule-1
  // park, raised by a node whose SEALED outcome carries verdict ESCALATE. That
  // escalation was already answered (the child blocks until a human decides, or
  // an unattended policy seals it), so no signal is coming and the seal block
  // below would skip the status entirely: no terminal entry, `chain approve`
  // finds no in-flight node, `chain resume` finds no sealed state, and a
  // `--watch` follow never returns. Resolve it into the resumable FAILED seal
  // WP-521(c) already knows how to re-enter (ADR-009 D1: no dead ends). The pure
  // reducer is untouched — ADR-005 §S3 puts non-node transitions here.
  const park = resolveAnsweredEscalationPark({
    status: record.status,
    failedNodeIds: failedActiveNodeIds({
      nodeIds: plan.nodes.map((node) => node.id),
      outcomeStatusById: Object.fromEntries(
        Object.entries(record.nodeOutcomes).map(([id, outcome]) => [id, outcome.status]),
      ),
    }),
  });
  if (park.action === "seal") {
    record = { ...record, status: park.status };
    reason ??= park.reason;
    resumableSeal ||= park.resumable;
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
        // WP-571: the completion review fires at the end of a chain that may
        // have burned one subscription for hours — exactly when the primary
        // judge is most likely walled. Give it the class so it can fail over.
        ...(template.agentClasses === undefined
          ? {}
          : { agentClasses: template.agentClasses }),
      });
    }
  }

  if (record.status === "SUCCESS" || record.status === "FAILED") {
    await activities.sealChain({
      chainId,
      status: record.status,
      reason,
      ...(record.status === "FAILED" && resumableSeal ? { resumable: true } : {}),
    });
  }
  return record.status;
}
