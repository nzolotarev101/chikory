/**
 * Pure chain-orchestration helpers (WP-219 S3-wiring, ADR-005 §3/§4) — the
 * deterministic glue the `chainLoop` workflow folds over. Kept out of the
 * workflow module so they are plain unit-testable functions: a node becomes an
 * ordinary `TaskSpec` (NF-1 — "a node is a TaskSpec run, no new execution
 * path"), and a sealed child run becomes the `NodeOutcome` the pure reducer
 * (`advanceChain`) consumes. No I/O, no clock, no mutation.
 */
import type {
  ChainNodeHandoff,
  ChainLink,
  JudgePolicy,
  NodeOutcome,
  PlanNode,
  RepoSpec,
  RoutingPolicy,
  RunStatus,
  TaskSpec,
  VerdictKind,
} from "../types.js";

/**
 * The per-chain TaskSpec fields shared by every node — everything a node run
 * needs that the `PlanNode` itself does not carry (the plan owns goal /
 * criteria / budget per node; the template owns repos / executor / judge /
 * routing for the whole chain). This is orchestration input, not a frozen
 * contract, so it lives here rather than in `types.ts`.
 */
export interface ChainNodeTemplate {
  repos: RepoSpec[];
  executor: TaskSpec["executor"];
  judge: JudgePolicy;
  routing: RoutingPolicy;
  budgetTokens?: number;
  maxSteps?: number;
  /**
   * WP-243 dogfood/test-only: force a deterministic SUSPEND park. `nodeIndex`
   * (0-based dispatch order) targets a single node — node A = 0, node B = 1 —
   * so an independent root keeps running while a dependent node parks; absent
   * `nodeIndex` arms every node.
   */
  debugPark?: { beforeStep: number; nodeIndex?: number };
  /**
   * WP-521 dogfood/test-only: force the targeted node to seal FAILED on its
   * FIRST incarnation, so chain heal-by-default replan is exercised
   * deterministically on a real chain. Targeting is planner-agnostic (see
   * `isSeededFailNode`): a numeric value is a 0-based dispatch index, otherwise
   * it matches the node id exactly or its trailing segment. The retry node
   * (`${id}-r${n}`) is never re-targeted. Frozen host-side from
   * `CHIKORY_SEED_CHAIN_FAIL_NODE`.
   */
  seedFailNodeId?: string;
  /**
   * WP-246 dogfood/test-only: arm the judge-catch bad-diff seam on the targeted
   * dispatch node (`nodeIndex`, 0-based) or every node when absent. The chain
   * analog of `debug.seedBadDiff`; armed host-side from `CHIKORY_SEED_BAD_DIFF_*`
   * env, frozen into the workflow input (never read in the workflow body).
   */
  debugSeedBadDiff?: { atStep: number; path: string; content: string; nodeIndex?: number };
}

/**
 * Deterministic child workflow id for a chain node — `chikory trace` and
 * crash-replay both rely on it being a pure function of (chainId, nodeId). The
 * `-node-` separator (not `:`/`::`) keeps the id valid as a git ref: a run's
 * private branch is `chikory/run-<runId>`, and git ref names forbid `:`, so a
 * colon-separated id would fail `checkout -b` and drop the run-private-branch
 * invariant (durable-runner.md §Checkpoints).
 */
export function childRunId(chainId: string, nodeId: string): string {
  return `${chainId}-node-${nodeId}`;
}

/**
 * Whether a node is the WP-521 force-fail target for the given seam value
 * (`CHIKORY_SEED_CHAIN_FAIL_NODE`). The planner mints node ids freely (a real
 * `chikory chain` emitted `N-A/N-B/N-C`, not `A/B/C`), so an exact-id-only
 * match silently no-ops when the operator can't predict the id (F-146 residue:
 * dogfood-105 armed `=B`, planner said `N-B`, seam never fired). Matching is
 * therefore planner-agnostic:
 *   - a NUMERIC seam value is a 0-based DISPATCH INDEX (`1` = the middle of a
 *     3-node chain) — deterministic regardless of the planner's naming;
 *   - otherwise it matches the node id EXACTLY, or the node id's trailing
 *     `-`/`_` segment (so `B` targets a planner-minted `N-B`).
 * The retry incarnation `${id}-r${n}` never re-matches: its trailing segment is
 * `r${n}`, and it dispatches at a strictly higher index than the first failure.
 */
export function isSeededFailNode(
  nodeId: string,
  dispatchIndex: number,
  seedFailNodeId: string | undefined,
): boolean {
  if (seedFailNodeId === undefined || seedFailNodeId.length === 0) return false;
  if (/^\d+$/.test(seedFailNodeId)) return dispatchIndex === Number(seedFailNodeId);
  if (nodeId === seedFailNodeId) return true;
  return nodeId.split(/[-_]/).pop() === seedFailNodeId;
}

/**
 * Project one `PlanNode` onto an ordinary `TaskSpec` (ADR-005 §1: each node
 * "is (or templates) a normal TaskSpec"). The node supplies goal, acceptance
 * criteria, and its per-node budget; the chain template supplies the shared
 * execution surface. `chainLink` back-references the plan so the child run is
 * traceable to its chain (D4 linkage).
 */
export function planNodeToTaskSpec(
  node: PlanNode,
  template: ChainNodeTemplate,
  planId: string,
  parentRunId?: string,
  handoffNote?: string,
  chainId?: string,
  parentHandoffs?: ChainNodeHandoff[],
  dispatchIndex?: number,
  planContext?: { goal: string; outline?: string[] },
): TaskSpec {
  const chainLink: ChainLink = { planId, nodeId: node.id };
  if (chainId !== undefined) chainLink.chainId = chainId;
  if (node.writeSet !== undefined) chainLink.writeSet = node.writeSet;
  if (parentRunId !== undefined) chainLink.parentRunId = parentRunId;
  if (parentHandoffs !== undefined && parentHandoffs.length > 0) {
    chainLink.parentHandoffs = parentHandoffs;
  }
  // Big-picture carrier: the node's judge reads these off the journaled spec
  // to fill the OVERALL GOAL prompt section (design_serves_overall_goal).
  if (planContext !== undefined) {
    chainLink.planGoal = planContext.goal;
    if (planContext.outline !== undefined && planContext.outline.length > 0) {
      chainLink.planOutline = planContext.outline;
    }
  }

  const spec: TaskSpec = {
    name: `${planId}-${node.id}`,
    goal: handoffNote === undefined ? node.goal : `${node.goal}\n\n${handoffNote}`,
    repos: template.repos,
    acceptanceCriteria: node.acceptanceCriteria,
    budgetUsd: node.budgetUsd,
    executor: template.executor,
    judge: template.judge,
    routing: template.routing,
    chainLink,
  };
  if (template.budgetTokens !== undefined) spec.budgetTokens = template.budgetTokens;
  if (template.maxSteps !== undefined) spec.maxSteps = template.maxSteps;
  // WP-243/WP-246: arm the dogfood debug seams on the targeted node (or all
  // nodes when `nodeIndex` is absent). Deterministic — dispatch order is fixed.
  // Both seams can be armed at once, so build `spec.debug` additively.
  const parkArmed =
    template.debugPark !== undefined &&
    (template.debugPark.nodeIndex === undefined ||
      template.debugPark.nodeIndex === dispatchIndex);
  const badDiff = template.debugSeedBadDiff;
  const badDiffArmed =
    badDiff !== undefined &&
    (badDiff.nodeIndex === undefined || badDiff.nodeIndex === dispatchIndex);
  if (parkArmed || badDiffArmed) {
    spec.debug = {
      ...(parkArmed ? { parkBeforeStep: template.debugPark!.beforeStep } : {}),
      ...(badDiffArmed
        ? { seedBadDiff: { atStep: badDiff!.atStep, path: badDiff!.path, content: badDiff!.content } }
        : {}),
    };
  }
  return spec;
}

/**
 * Map a sealed child run to the `NodeOutcome` the reducer folds. `status` is
 * the run's terminal seal narrowed to a `TerminalStatus` (a CANCELLED run is a
 * FAILED node — it did not deliver); `verdict` is the run's final judge ruling,
 * defaulting to PROCEED for SUCCESS and HALT for a failure that carried no
 * verdict (e.g. a maxSteps seal). The chain never re-judges — it records what
 * the child run already sealed (ADR-005 §S3 reducer note).
 */
export function deriveNodeOutcome(
  status: RunStatus,
  verdictKind?: VerdictKind,
): NodeOutcome {
  const terminal = status === "SUCCESS" ? "SUCCESS" : "FAILED";
  return {
    status: terminal,
    verdict: verdictKind ?? (terminal === "SUCCESS" ? "PROCEED" : "HALT"),
  };
}
