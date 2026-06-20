/**
 * Pure chain-orchestration helpers (WP-219 S3-wiring, ADR-005 §3/§4) — the
 * deterministic glue the `chainLoop` workflow folds over. Kept out of the
 * workflow module so they are plain unit-testable functions: a node becomes an
 * ordinary `TaskSpec` (NF-1 — "a node is a TaskSpec run, no new execution
 * path"), and a sealed child run becomes the `NodeOutcome` the pure reducer
 * (`advanceChain`) consumes. No I/O, no clock, no mutation.
 */
import type {
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
): TaskSpec {
  const chainLink: ChainLink = { planId, nodeId: node.id };
  if (parentRunId !== undefined) chainLink.parentRunId = parentRunId;

  const spec: TaskSpec = {
    name: `${planId}-${node.id}`,
    goal: node.goal,
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
