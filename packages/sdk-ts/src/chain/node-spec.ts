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
  NotificationPolicy,
  PacingPolicy,
  PlanNode,
  RepoSpec,
  RoutingPolicy,
  RunStatus,
  SoakPolicy,
  TaskSpec,
  UnattendedPolicy,
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
  /**
   * The pair the chain was ARMED with. WP-571: when `agentClasses` is set this
   * is only the starting selection — each node re-selects from live cooldowns at
   * dispatch, so a wall one node hits does not strand the next.
   */
  executor: TaskSpec["executor"];
  agentClasses?: TaskSpec["agentClasses"];
  judge: JudgePolicy;
  routing: RoutingPolicy;
  budgetTokens?: number;
  maxSteps?: number;
  /**
   * F-209: the execution-surface policies a chain node needs and, before
   * WP-544, silently never received. dogfood-120 declared
   * `step_limits.max_seconds: 840` and `unattended.escalation:
   * seal_resumable_failed`; the template carried neither, so every node ran the
   * 600s `DEFAULT_STEP_LIMITS` (killing `N-2` step 0 at 602.9s and spending a
   * rule-3 strike on it) and `N-1` parked `AWAITING_APPROVAL` for a human the
   * spec had told it not to wait for. `CHAIN_TEMPLATE_FIELDS` below is the
   * enumerated contract that keeps the next added field from going silent too.
   */
  stepLimits?: TaskSpec["stepLimits"];
  pacing?: PacingPolicy;
  unattended?: UnattendedPolicy;
  soak?: SoakPolicy;
  notifications?: NotificationPolicy;
  horizon?: TaskSpec["horizon"];
  regressionSuite?: string;
  checkTimeoutMs?: number;
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
 * F-209 recurrence guard: every `TaskSpec` field, classified by who owns it on
 * a chain node. A field can only be dropped SILENTLY because nothing enumerates
 * the contract — that is exactly how `stepLimits` / `unattended` / `pacing`
 * were lost between `templateFromSpec` and `planNodeToTaskSpec` for the whole
 * life of WP-219. `test/chain/template-passthrough.test.ts` asserts this union
 * equals `keyof TaskSpec`, so adding a TaskSpec field without deciding what a
 * node should see turns the suite RED instead of quietly ignoring the operator.
 */
export const CHAIN_TEMPLATE_FIELDS = {
  /** Owned by the `PlanNode` / the chain itself — never sourced from the template. */
  nodeOwned: ["name", "goal", "acceptanceCriteria", "budgetUsd", "chainLink"],
  /** The shared execution surface every node inherits from the goal spec. */
  templateForwarded: [
    "repos",
    "executor",
    // WP-566: a node must inherit the class names, not just the armed member —
    // otherwise only the first node can ever rotate off a walled agent.
    "agentClasses",
    "judge",
    "routing",
    "budgetTokens",
    "maxSteps",
    "stepLimits",
    "pacing",
    "unattended",
    "maxRejectStrikes",
    "soak",
    "notifications",
    "horizon",
    "regressionSuite",
    "checkTimeoutMs",
  ],
  /**
   * Deliberately not forwarded, each for a stated reason:
   * - `minNodes` is a plan-shape floor consumed by the plan gate; a node has no plan.
   * - `chain` is the chain's own heal budget, consumed by `decideReplan` in the
   *   orchestrator; a node neither reads nor replans itself.
   * - `boundedWorkUnit` carries `workChunks` authored as ordered directives for ONE
   *   task's work — replaying a chain-wide chunk list against every node's own goal
   *   would hand each node the wrong sub-goals (F-112's chunk scoping assumes the
   *   chunks belong to the run consuming them).
   * - `debug` seams are armed PER NODE from env (`debugPark`, `debugSeedBadDiff`,
   *   `seedFailNodeId`), which is why they have their own template fields.
   * - `wp` (dogfood-125) is the launch-time stale-spec precheck target for the
   *   WHOLE spec, consumed once in `cmdRun` before a chain plan exists. A node
   *   has no WP id of its own to precheck.
   */
  deliberatelyExcluded: ["minNodes", "chain", "boundedWorkUnit", "debug", "wp"],
} as const satisfies Record<string, readonly (keyof TaskSpec)[]>;

type ClassifiedTaskSpecField =
  (typeof CHAIN_TEMPLATE_FIELDS)[keyof typeof CHAIN_TEMPLATE_FIELDS][number];

/** `A ⊆ B`, in the `schemas.ts` `AssertAccepts` house style. */
type AssertCovers<_Subset extends Superset, Superset> = true;

/**
 * The teeth on `CHAIN_TEMPLATE_FIELDS`: both directions, so a new `TaskSpec`
 * field fails `tsc --noEmit` until it is classified, and a classification that
 * names a field `TaskSpec` no longer has fails too.
 */
export type ChainTemplateFieldChecks = [
  AssertCovers<ClassifiedTaskSpecField, keyof TaskSpec>,
  AssertCovers<keyof TaskSpec, ClassifiedTaskSpecField>,
];

/**
 * The execution-surface fields a node inherits that an OPERATOR declares
 * optionally — i.e. `templateForwarded` minus the four every chain always has.
 * These are exactly the fields WP-544 added to `templateFromSpec`, and therefore
 * exactly the fields a template frozen before WP-544 cannot carry.
 */
const OPTIONAL_TEMPLATE_FIELDS = [
  "stepLimits",
  "pacing",
  "unattended",
  "maxRejectStrikes",
  "soak",
  "notifications",
  "horizon",
  "budgetTokens",
  "maxSteps",
  "regressionSuite",
  "checkTimeoutMs",
] as const;

/**
 * F-220: which optional execution-surface fields the PERSISTED template lacks.
 *
 * A chain's template is frozen into its journal at launch and replayed by every
 * later dispatch, including `chikory chain resume`. So a template written by a
 * pre-WP-544 binary keeps its F-209 gaps for the whole life of the chain, and no
 * amount of fixing the code reaches it. dogfood-120 is the proof: WP-544 landed
 * mid-chain, the operator resumed 4 minutes later, and the resumed node still
 * ran with `stepLimits: undefined` / `unattended: undefined` — so a judge
 * ESCALATE over a stray glyph in a doc parked it 3h47m for a human the spec had
 * said not to wait for.
 *
 * This cannot distinguish "the operator declared nothing" from "an old binary
 * dropped it", so it is warning evidence, never a refusal.
 */
export function templateGaps(template: unknown): string[] {
  if (template === null || typeof template !== "object") return [...OPTIONAL_TEMPLATE_FIELDS];
  const present = template as Record<string, unknown>;
  return OPTIONAL_TEMPLATE_FIELDS.filter((field) => present[field] === undefined);
}

/**
 * The operator-facing warning for a resume about to replay a template with gaps.
 * `undefined` when the template carries every optional field — nothing to say.
 */
export function renderStaleTemplateWarning(chainId: string, gaps: string[]): string | undefined {
  if (gaps.length === 0) return undefined;
  return [
    `chikory: chain ${chainId} was frozen with no ${gaps.join(", ")} in its node template.`,
    "  A chain's template is captured at launch and replayed by every dispatch, including this",
    "  resume — if your goal spec declared any of those blocks, this chain never received them",
    "  and this resume will not fix that (F-209/F-220).",
    "  Consequences to expect: the default 600s step cap instead of your `step_limits`, and a",
    "  judge ESCALATE parking the node for a human instead of your `unattended.escalation`.",
    "  To run the remaining work on the declared surface, launch a fresh chain over what is",
    "  left rather than resuming this one.",
  ].join("\n");
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
  if (template.agentClasses !== undefined) spec.agentClasses = template.agentClasses;
  if (template.budgetTokens !== undefined) spec.budgetTokens = template.budgetTokens;
  if (template.maxSteps !== undefined) spec.maxSteps = template.maxSteps;
  // F-209: the rest of the execution surface. Keep this block in step with
  // `CHAIN_TEMPLATE_FIELDS.templateForwarded` — the passthrough test reads both.
  if (template.stepLimits !== undefined) spec.stepLimits = template.stepLimits;
  if (template.pacing !== undefined) spec.pacing = template.pacing;
  if (template.unattended !== undefined) spec.unattended = template.unattended;
  if (template.soak !== undefined) spec.soak = template.soak;
  if (template.notifications !== undefined) spec.notifications = template.notifications;
  if (template.horizon !== undefined) spec.horizon = template.horizon;
  if (template.regressionSuite !== undefined) spec.regressionSuite = template.regressionSuite;
  if (template.checkTimeoutMs !== undefined) spec.checkTimeoutMs = template.checkTimeoutMs;
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
