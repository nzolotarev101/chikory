# ADR-005: Goal Decomposition & Run Chaining

**Status**: Accepted (forks resolved 2026-06-13 — see §Decisions resolved)
**Date**: 2026-06-13
**WP**: WP-219 · **Origin**: dogfood-002 F-10a (the objective gap)

## Context

Today a goal larger than 1–3 executor steps is decomposed **by a human** into
hand-written `task.yaml` slices. Every dogfood run to date (dogfood-001…014)
was a human-authored single slice; the engine's share of each was minutes, the
human's share was: slice the goal, write the yaml, launch, supervise, harvest.
dogfood-002 F-10 named this exactly — *"the human is still the planner and the
harvester"* — and split it into two gaps: (a) nothing decomposes a goal across
runs, (b) run→branch/PR ceremony. WP-220 closed (b). **(a) is untouched: there
is no planner anywhere in the system.** P1 deliberately omitted one; WP-207
paces *within* a single run but does not plan *across* runs.

This is the **objective gap**, not a nicety:

- The P2 exit gate is *"a 24h+ multi-session run completes with ≥1
  suspend/resume, compaction events, no context-rot failure."* A 24h run **is a
  chain of judge-gated slices, not one step-loop** — it cannot exist without
  cross-run decomposition.
- The product thesis ("long-running, self-correcting software agents",
  "full-application engine") requires goals far larger than one judgeable step.

Hard constraints this ADR must honor:

- **Not a framework / not planner-magic** (CLAUDE.md). Minimal abstraction,
  maximal observability.
- **NF-1: data layered on the existing runtime, no new execution machinery.**
  Each slice must remain an *ordinary* judge-gated TaskSpec run on the existing
  durable runner + judge + checkpointer.
- **Context across slices must survive context-rot** — carried via WP-203
  compaction + WP-202 Memory-Pointer refs, never a raw transcript replay.

## Decision

**A plan is a tree of ordinary TaskSpec runs, and chaining is an orchestration
layer *above* the run loop — never a change to it.**

1. **Decomposition.** A goal is decomposed into an ordered dependency tree of
   child slices (`Plan` = goal + `PlanNode[]`). Each `PlanNode` is (or
   templates) a normal `TaskSpec`: scope, acceptance criteria, budget, routing.
   No node bypasses the judge; no node uses a new execution path.

2. **A dedicated `planner/` component emits the tree, and the plan is judged
   before execution** (D1, D2). The planner is its own module (mirrors the
   `judge/` shape) that calls the router to decompose goal → tree, then a
   **plan meta-judge of a different family than the planner** gates the
   decomposition as evidence (criteria coverage, scope coherence, no dropped
   goal) → PROCEED / REVISE / ESCALATE. This extends invariant #2
   (judge ≠ executor family) to the plan level: **plan-judge ≠ planner family**
   — Agent-as-a-Judge in the inner loop applies to the plan, not just the code.

3. **The plan is a durable, journaled artifact.** The plan tree is recorded
   (new `plan` JIF kind + a **chain-level record**, D4) so a chain is itself
   resumable and traceable: `chikory trace` renders the tree + per-node
   verdicts, not just one run. Chain linkage: a child run carries `planId` +
   `nodeId` + `parentRunId`.

4. **Sequencing reuses verdict semantics.** Nodes execute in dependency order;
   a node's SUCCESS (judge PROCEED ∧ all criteria) gates its dependents. A node
   FAILED/HALT/ESCALATE halts the chain *at that node*, resumable — identical to
   how a single run already seals. **No new gating logic.**

5. **Context carry between nodes.** A node starts from its predecessor's landed
   checkpoint (git state) + a **structured handoff note** (WP-203 compaction
   output) + WP-202 refs to prior large outputs. The handoff note — "what the
   next slice must know" — is compaction, not transcript replay; this is the
   context-rot defense.

6. **Static plan, halt-and-replan on failure** (D3). The tree is decomposed
   once up front; nodes run in order; a node failure halts the chain and
   re-invokes the planner from that node (with the failure as evidence) rather
   than blindly replanning every step. Predictable cost, resumable, deterministic.

7. **Pacing composes, it doesn't compete.** WP-207 right-sizes a node
   (window-fit + token budget) at decomposition/boundary time. **WP-219 plans
   *across* runs; WP-207 sizes *within/at* a run.** Planner proposes nodes;
   pacing sets their boundaries.

8. **Human gates are chain-level (WP-206).** Between nodes (and optionally on
   planner output) the chain can suspend for approval via a Temporal signal —
   sleep hours/days at zero compute, resume on event. That *is* the exit gate's
   "≥1 suspend/resume." Any node's ESCALATE parks the whole chain.

## Rationale

- **Reuses the entire P1 machine.** A node is a TaskSpec run — durable journal,
  judge gate, checkpoint-per-step, family diversity, budget cap, forensics — all
  already built and proven over 14 dogfoods. The chain adds *ordering +
  context-carry + a plan artifact*, nothing in the hot path. Honors NF-1.
- **Keeps the judge in the inner loop at every level.** Each slice is gated as
  before, and the *plan itself* is judged (D2) — a decomposition that drops a
  criterion is a catchable defect. No "planner magic" that escapes the gate.
- **It is the smallest thing that turns the 14-dogfood loop autonomous.** The
  human stops hand-slicing; they state a goal and approve a plan. Everything
  downstream is the existing loop.
- **Unblocks the parked contract backlog.** §Contract surface rides the same
  architect-reviewed PR that `claimsComplete` (WP-221) and `budget_tokens`
  (WP-218 s2) have been waiting on — one PR clears all three.

## Decisions resolved (2026-06-13)

| # | Fork | Decision |
|---|---|---|
| D1 | Planner home: reuse `plan` routing stage vs dedicated component. | **Dedicated `planner/` component.** Its own module (mirrors `judge/`); calls the router for the decomposition LLM call but owns the logic, isolation, and tests. |
| D2 | Is the plan judged in v1? | **Yes — a plan meta-judge gates the decomposition** (plan-as-evidence, a *different family than the planner*). Agent-as-a-Judge applies to the plan, not just the code. Verdicts: PROCEED / REVISE / ESCALATE. |
| D3 | Static vs adaptive plan. | **Static decomposition + halt-and-replan on node failure.** Decompose once; on failure re-plan from the failed node with the failure as evidence. |
| D4 | Plan storage. | **Chain-level record** referencing child run-ids (mirrors the per-run SQLite journal pattern). A chain spans runs, so plan state lives above any one run's journal. |

## S3 transition rules (D3/D4 reducer)

D3 ("static + halt-and-replan") and D4 ("chain-level record") fix *what* the
chain remembers and *how* it reacts to a node failure, but the per-node state
machine they imply has to be spelled out before the chain executor can be built.
This section is that enumeration — the analog of the judge's
`CONTRACTS.md §4` verdict rules that `computeVerdict` implements. The whole
state machine is a **pure reducer** over the frozen `ChainRecord`; the LLM/
Temporal/git side effects are the S3-wiring layer above it, never inside it.

To make the reducer pure over `ChainRecord`, each sealed node's terminal
outcome is recorded on the chain (the `contracts:` PR adds `NodeOutcome`
`{ status, verdict }` + `ChainRecord.nodeOutcomes: Record<nodeId, NodeOutcome>`;
the child run id stays in `nodeRuns`). Two pure functions consume it:

- **`advanceChain(record, nodeId, outcome): ChainRecord`** — folds one sealed
  node into the chain. Returns a *new* record with
  `nodeOutcomes[nodeId] = outcome` and `status` recomputed via
  `deriveChainStatus`; it does not mutate its input, read the clock, or perform
  I/O (the `buildPlan` / `buildPlanVerdict` discipline). The verdict is supplied
  by the sealed child run; the reducer never re-judges.

- **`deriveChainStatus(record): ChainStatus`** — computes the chain status from
  `record.plan.nodes` and `record.nodeOutcomes`, in this precedence (first match
  wins, mirroring the §4 rule-ordering style):

  1. **any node `verdict === "ESCALATE"` → `AWAITING_PLAN_APPROVAL`.** A node's
     ESCALATE parks the *whole* chain for the human gate (§8). Highest
     precedence: a human question outranks a mechanical failure.
  2. **else any node `status === "FAILED"` → `FAILED`.** The chain halts at the
     failed node, resumable — identical to how a single run seals (§4). The
     planner re-invoke ("halt-and-replan", D3) is the **non-pure S3-wiring**
     follow-up that reads this `FAILED` seal and the failed node's evidence; the
     reducer only seals the halt, it does not replan.
  3. **else every `plan.nodes` id present in `nodeOutcomes` with
     `status === "SUCCESS"` → `SUCCESS`.** All slices delivered and gated.
  4. **else → `RUNNING`.** Work remains and nothing has failed/escalated;
     `readyNodes(plan, completed)` (already landed) drives what dispatches next.

The reducer's output domain is exactly those four `ChainStatus` values. The
remaining three — `PLANNING`, `SUSPENDED`, `CANCELLED` (and the *entry* into
`AWAITING_PLAN_APPROVAL` from a plan-meta-judge ESCALATE before any node runs) —
are set by the orchestrator for non-node transitions (decomposition, WP-206
between-node suspend, cancel), **never by this reducer**. Keeping that boundary
crisp is what makes the reducer a pure, fully unit-testable slice.

## Contract surface (the PR that falls out — WP-219 slice 1, hand-done)

Architect-reviewed contracts change (TASK-PROTOCOL §4), `types.ts` + zod +
fixtures, the same PR the parked items ride:

- `Plan` / `PlanNode` types (goal; ordered nodes; per-node TaskSpec-or-template
  + `dependsOn` + acceptance) + schemas + valid/invalid fixtures.
- `PlanVerdict` (PROCEED / REVISE / ESCALATE) + a `planner` routing stage and a
  plan-judge family-diversity check (**plan-judge ≠ planner family**, the D2
  extension of invariant #2 — enforced in `parseTaskSpec`/`enforceFamilyDiversity`).
- `plan` + `plan_verdict` JIF kinds (plan emitted; plan judged; node
  started/sealed) + chain linkage (`planId`/`nodeId`/`parentRunId` on the run
  record) + the chain-level record (D4).
- **Ride-alongs (independent, already queued for this PR):**
  `StepRecord.claimsComplete` (WP-221 — OR'd into the WP-217 trigger, kills the
  F-11 probe tax) and `budget_tokens` on TaskSpec (WP-218 slice 2).

## Consequences / implementation slices

Slices fall out of the accepted ADR (S1 hand-done; later S's become dogfood
runs again, now against a real chaining substrate):

- **S1** — contracts above (hand-done PR). *Unblocks WP-221 + WP-218 s2.*
- **S2 contract landed (hand-done, 2026-06-14)** — the planner *function*
  surface is frozen (`PlanInput`, `GoalPlanner.decompose(input): Promise<Plan>`
  in `types.ts`; CONTRACTS.md §7a) plus the pure, unit-tested precondition
  `planCoverageGaps(plan, goalCriteria)` (`src/planner/coverage.ts`) that feeds
  `PlanVerdict.uncoveredCriteria`. **Unblocks the S2/S2b dogfoods.**
- **S2** — `planner/` component: implement `GoalPlanner` — goal → plan tree
  (one router decomposition call through the `plan` stage), journaled;
  `chikory plan <goal>` dry-run renders the tree. *(now dogfoodable)*
- **S2b** — plan meta-judge: gates the decomposition (different family than the
  planner) → PROCEED/REVISE/ESCALATE before any node executes; consumes
  `planCoverageGaps` for the coverage half of its verdict. *(now dogfoodable)*
- **S3-pure** — the chain-state reducer: `advanceChain` + `deriveChainStatus`
  (§S3 transition rules), pure over the frozen `ChainRecord` + `NodeOutcome`,
  the `computeVerdict` analog. **Dogfoodable 🟢** (the `NodeOutcome` contract
  landed by hand first — `contracts:` PR — so the slice itself adds no contract
  change). Sibling of the landed pure `readyNodes` / `hasDependencyCycle`.
- **S3-wiring** — chain executor (hand-design, TASK-PROTOCOL §4): the Temporal
  workflow that loops `readyNodes` over the gated `Plan`, spawns one child run
  per node from the predecessor checkpoint, folds each sealed node through
  `advanceChain`, halts-and-replans on a `FAILED` seal (D3), and journals
  `node_started` / `node_sealed`.
- **S4** — context handoff: **partially landed via WP-237** — a local
  dependent node clones `dependsOn[0]`'s sealed git tree and receives a static
  predecessor id+goal note. WP-203 compacted notes, WP-202 refs, deterministic
  fan-in merge, and artifact-backed distributed handoff remain WP-239 work.
- **S5** — WP-206 suspend/resume between nodes (Temporal signal).
- **S6** — `chikory trace` renders the chain (plan tree + per-node verdicts) —
  pure-renderer, **dogfoodable 🟢**.

Risks: planner cost/latency (mitigate — one decomposition call, plan-judged,
cached); a bad decomposition compounding (mitigate — the plan meta-judge +
per-node judge gates + halt-and-replan, D2/D3); chain-level state is new surface
(mitigate — mirror the proven per-run journal pattern, D4).

Phase-2 exit is reached when S1–S5 land and a 24h+ multi-session **chain**
completes with ≥1 suspend/resume (S5) and compaction events (S4) in trace.

## Appendix — proposed type additions (draft for the S1 contracts PR)

Concrete surface for review. The real PR lands these in `types.ts` **and**
`docs/spec/CONTRACTS.md` **and** zod schemas **and** `fixtures/contracts/`
**and** Python parity (`sdk-py`) in one `contracts:` PR (TASK-PROTOCOL §4 — the
frozen-contracts rule; do not split). Routing: the `planner/` component routes
its decomposition call through the existing `plan` stage; the plan meta-judge
routes through `judge` (add a `plan_judge` Stage only if independent routing is
wanted — omitted here to honor NF-1).

```ts
// ─── §X Plans & chains (WP-219, ADR-005) ────────────────────────────────────

/** A decomposed goal: an ordered dependency tree of judge-gated slices. */
export interface Plan {
  id: string;
  /** The original user goal this plan decomposes. */
  goal: string;
  nodes: PlanNode[];
  /** ISO-8601 UTC. */
  createdAt: string;
}

/** One slice of a Plan — runs as an ordinary TaskSpec, gated like any other. */
export interface PlanNode {
  /** Stable, referenced by chain linkage + verdicts ("N-1"). */
  id: string;
  /** Self-contained 1–3-step brief; becomes the child run's goal. */
  goal: string;
  acceptanceCriteria: AcceptanceCriterion[];
  /** Node ids that must reach SUCCESS before this node starts. */
  dependsOn: string[];
  /** Per-node cap; chain budget = Σ nodes. */
  budgetUsd: number;
}

/** Plan meta-judge verdict (D2). REVISE → re-plan; ESCALATE → human. */
export type PlanVerdictKind = "PROCEED" | "REVISE" | "ESCALATE";

export interface PlanVerdict {
  kind: PlanVerdictKind;
  rationale: string;
  /** Goal criteria the plan fails to cover (empty on PROCEED). */
  uncoveredCriteria: string[];
}

/** Chain-level state — spans runs, lives above any one run's journal (D4). */
export interface ChainRecord {
  planId: string;
  plan: Plan;
  /** Latest meta-judge verdict on the plan. */
  planVerdict?: PlanVerdict;
  /** node id → child run id (the reverse of TaskSpec.chainLink). */
  nodeRuns: Record<string, string>;
  status: ChainStatus;
}

export type ChainStatus =
  | "PLANNING"
  | "AWAITING_PLAN_APPROVAL"  // plan meta-judge ESCALATE / human gate (WP-206)
  | "RUNNING"
  | "SUSPENDED"               // between-node suspend (WP-206)
  | "SUCCESS"
  | "FAILED"
  | "CANCELLED";

/** Run → chain back-reference; persisted with the run (the `runs` row). */
export interface ChainLink {
  planId: string;
  nodeId: string;
  /** The run whose checkpoint this node started from (predecessor). */
  parentRunId?: string;
}
```

Additions to existing types:

```ts
// TaskSpec — chain back-reference + the WP-218 s2 ride-along
export interface TaskSpec {
  // …existing fields…
  /** Present when this run is a node in a chain (WP-219). */
  chainLink?: ChainLink;
  /** Token-denominated cap, complements budgetUsd (WP-218 slice 2, CG-2). */
  budgetTokens?: number;
}

// StepRecord — the WP-221 ride-along that kills the F-11 probe tax
export interface StepRecord {
  // …existing fields…
  /**
   * Executor's explicit "task done" signal from its final summary. OR'd into
   * the WP-217 empty-diff trigger so the *productive* step is judged directly,
   * removing the dedicated probe step (F-11). Absent = inference as today.
   */
  claimsComplete?: boolean;
}

// JIF kinds — shared by the per-run journal AND the chain journal (D4 mirrors
// the per-run pattern). Chain-scope entries live in the chain store.
export type JournalEntryKind =
  | "step" | "judge" | "checkpoint" | "verdict" | "injection"
  | "budget_event" | "compaction" | "pacing" | "terminal"
  | "plan"          // planner emitted a Plan
  | "plan_verdict"  // meta-judge ruled on the Plan
  | "node_started"  // chain dispatched a PlanNode → child run
  | "node_sealed";  // child run reached a terminal state
```
