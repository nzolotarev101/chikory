# Core Contracts Specification (WP-002)

The frozen interface set for `packages/sdk-ts/src/types.ts`. This document **is** the WP-002 spec: implementing it is transcription plus doc-comments, not design. Python parity (WP-201) mirrors these 1:1 (`snake_case`, `TypedDict`/`Protocol`/dataclasses); cross-language conformance is verified by shared JSON fixtures (see §10).

Change control: post-freeze edits follow [TASK-PROTOCOL.md §4](../TASK-PROTOCOL.md) (separate `contracts:` PR, architect review, requirement-ID mapping).

## 1. Providers & routing (extends existing types.ts)

```ts
export type LLMProvider = "anthropic" | "openai" | "gemini" | "openai-compat";

export type Stage = "plan" | "code" | "review" | "judge";

export interface ModelChoice {
  provider: LLMProvider;
  model: string;
}

/** RT-4/5/6 — swapping vendors is a config diff, never a code change. */
export interface RoutingPolicy {
  stages: Record<Stage, ModelChoice>;
  failover?: Partial<Record<Stage, ModelChoice[]>>; // ordered
}

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface CompletionRequest {
  stage: Stage;
  messages: Message[];
  maxTokens?: number;
  temperature?: number;
  responseSchema?: object; // JSON Schema; judge form-filling requires it
}

/** Successful router result. Invariant #4: status is always explicit. */
export interface LLMCallResult {
  status: "SUCCESS";
  content: string;
  provider: LLMProvider;
  model: string;
  tokens: TokenUsage;
  costUsd: number;
}

export interface Router {
  complete(req: CompletionRequest): Promise<LLMCallResult | RouterError>;
}

/** Invariant #4 — failures are values, never raw exceptions. */
export interface RouterError {
  status: "FAILED";
  reason: string;
  retriable: boolean;
  attempts: number;
  provider?: LLMProvider;
}
```

## 2. Task specification

Canonical user input; YAML form documented in [task-spec.md](task-spec.md).

```ts
export interface TaskSpec {
  name: string;
  goal: string;                       // OB-3: success criteria upfront
  repos: RepoSpec[];                  // 1 in P1; N in P2 (WP-214)
  acceptanceCriteria: AcceptanceCriterion[];
  budgetUsd: number;                  // CG-2 hard cap
  budgetTokens?: number;              // P2 (WP-218 slice 2) — token cap, complements budgetUsd
  maxSteps?: number;
  minNodes?: number;                  // P2 (WP-509) — chain-only decompose floor; reject a plan with fewer nodes
  executor: { adapter: string; family: LLMProvider };
  judge: JudgePolicy;
  routing: RoutingPolicy;
  pacing?: PacingPolicy;              // P2 (WP-207); absent = fixed defaults
  notifications?: NotificationPolicy; // P2 (WP-208)
  chainLink?: ChainLink;              // P2 (WP-219, ADR-005) — set when this run is a chain node
}

export interface RepoSpec {
  url: string;        // local path or git URL
  ref?: string;       // branch/commit; default = default branch
  writable: boolean;  // read-only mounts allowed (context repos)
}

export interface AcceptanceCriterion {
  id: string;          // stable, referenced by verdicts ("AC-1")
  description: string;
  check?: string;      // shell command run by the JUDGE in sandbox; exit 0 = pass (JD-4)
}

export interface JudgePolicy {
  family: LLMProvider;          // must differ from executor.family (invariant #2)
  model?: string;               // default from routing.stages.judge
  cadence: number;              // judge every N steps (JD-2), default 3
  allowSameFamily?: boolean;    // explicit opt-in, loud warning (WP-133)
  scoringMethod?: "pointwise" | "pairwise"; // default pointwise (ADR-002)
  maxCostShare?: number;        // warn when judge spend > this fraction (JD-7)
  rubricPacks?: string[];       // P2 (WP-215): "security", "architecture"
}
```

## 3. Steps & executors

```ts
export type TerminalStatus = "SUCCESS" | "FAILED";

export interface ExecutorAdapter {
  readonly name: string;          // "claude-code" | "codex" | "native" | ...
  readonly modelFamily: LLMProvider;
  runStep(input: StepInput): Promise<StepRecord>;
}

export interface StepInput {
  workspaceDir: string;
  instruction: string;
  context: ContextBundle;
  limits: StepLimits;
}

export interface StepLimits {
  maxSeconds: number;
  maxTurns?: number;
  maxCostUsd?: number;
}

export interface StepRecord {
  status: TerminalStatus;          // invariant #4
  diffRef: ArtifactRef;
  summary: string;
  toolCalls: number;
  tokens: TokenUsage;
  costUsd: number;
  costEstimated: boolean;          // CLI adapters may estimate (cost-governance.md)
  durationMs: number;
  transcriptRef: ArtifactRef;
  failure?: { reason: string; retriable: boolean };
  claimsComplete?: boolean;        // P2 (WP-221) — explicit "task done"; OR'd into the WP-217 trigger (kills F-11 probe)
}

export interface TokenUsage { input: number; output: number; }

/** What the runner assembles for each step — the context-tier projection (CM-4). */
export interface ContextBundle {
  goal: string;
  acceptanceCriteria: AcceptanceCriterion[];
  planItem: string;                 // current task-tree item
  notes: Record<string, string>;    // structured notes, survive compaction verbatim (CM-2)
  recentSteps: string[];            // recall tier: compacted summaries
  judgeFeedback?: string;           // last non-PROCEED rationale
  injections: string[];             // WP-212, drained in order
  memoryRefs: ArtifactRef[];        // archival pointers (CM-3)
}
```

## 4. Judge

```ts
export type VerdictKind = "PROCEED" | "ROLLBACK" | "HALT" | "ESCALATE" | "BRANCH"; // BRANCH active P2+

export interface JudgeEvidence {
  diffRefs: ArtifactRef[];            // per repo, since last verdict
  testResults?: TestResultArtifact;   // judge-executed, never executor-claimed
  criteria: AcceptanceCriterion[];
  criteriaHistory: Record<string, boolean[]>; // flip-flop/drift detection (JD-7)
  stepSummaries: string[];
  artifacts: ArtifactRef[];           // screenshots, scans (P2)
}

/** The LLM fills this form; CODE computes the verdict from it (reward-hacking guard, judge.md). */
export interface JudgeForm {
  // infraFailed (additive, WP-263(b)): the item's judge-executed check DID NOT
  // COMPLETE (per-check cap kill) — infra failure, not a code red; the
  // deterministic verdict's rule-3/5 stuck/flip-flop history skips it.
  criterionResults: Array<{ id: string; pass: boolean; justification: string; infraFailed?: boolean }>;
  rubricResults: Array<{ id: string; pass: boolean; justification: string; infraFailed?: boolean }>;
  concerns: string[];
}

export interface JudgeVerdict {
  kind: VerdictKind;
  form: JudgeForm;
  rationale: string;
  rollbackTo?: CheckpointId;       // required when kind=ROLLBACK
  escalateReason?: string;         // required when kind=ESCALATE
  costUsd: number;
  tokens: TokenUsage;
  judgeModel: ModelChoice;
}
```

Verdict computation rules (deterministic, in code — `judge/verdict.ts`):
1. Any standing-rubric `pass=false` on a destructive item (unrelated deletion, secret introduced, scope breach) → `ROLLBACK`.
2. All criteria `pass=true` and no rubric failures → `PROCEED`; if all TaskSpec criteria pass → run-level SUCCESS.
3. Same criterion failed by ≥3 consecutive verdicts → `HALT` (goal drift / waste guard).
4. `concerns` non-empty + no rubric basis → `ESCALATE` (ambiguity belongs to humans).
5. Criterion flip-flop (pass→fail→pass) twice → `ESCALATE` (judge-drift guard, JD-7).

## 5. Artifacts

```ts
export type ArtifactKind =
  | "repo_snapshot" | "diff" | "test_results" | "task_tree"
  | "browser_state" | "transcript" | "tool_output" | "context_snapshot";

export interface ArtifactRef {
  id: string;        // content hash (sha256) — stable across resume/branch
  kind: ArtifactKind;
  bytes: number;
  summary: string;   // ≤200 chars; the only part that enters context by default (CM-3)
  repo?: string;     // additive (F-131): resolved workspace repo, multi-repo diff refs (WP-214)
}

export interface ArtifactStore {
  put(content: Uint8Array | string, meta: { kind: ArtifactKind; summary: string; repo?: string }): Promise<ArtifactRef>;
  get(ref: ArtifactRef): Promise<Uint8Array>;
  excerpt(ref: ArtifactRef, sel: { range?: [number, number]; query?: string }): Promise<string>;
}

export interface TestResultArtifact {
  ref: ArtifactRef;          // raw output
  command: string;
  exitCode: number;
  passed: number;
  failed: number;
  durationMs: number;
}
```

## 6. Journal & checkpoints

Persisted form specified in [journal-format.md](journal-format.md).

```ts
export type CheckpointId = string; // `${runId}@${journalIdx}`

export type JournalEntryKind =
  | "step" | "judge" | "checkpoint" | "verdict" | "injection"
  | "control_event" | "budget_event" | "compaction" | "pacing" | "terminal"
  | "seam"
  // P3 (WP-307/308/310) — intelligent-scaling kinds: resolved endpoint
  // capabilities, one classified limit signal, one pacing-governor decision
  | "capability" | "limit_observation" | "limit_signal" | "limit_pace"
  // P2 (WP-519, ADR-009 D3) — one journaled heal attempt (rule-3 HALT
  // intercepted: brief + rollback + bounded retry)
  | "remediation"
  // P2 (WP-219, ADR-005) — chain-scope kinds (emitted to the chain store)
  // `chain_completion_review` (WP-311): the aggregate design-judge pass at the SUCCESS seal
  | "plan" | "plan_verdict" | "node_started" | "node_replanned" | "node_sealed"
  | "chain_completion_review";

export interface JournalEntry {
  idx: number;                  // monotonic per run
  ts: string;                   // ISO-8601 UTC
  kind: JournalEntryKind;
  payload: unknown;             // kind-discriminated; see journal-format.md
  costDeltaUsd: number;
  tokens?: TokenUsage;
  artifactRefs: ArtifactRef[];
}

export interface Checkpoint {
  id: CheckpointId;
  journalIdx: number;
  gitCommits: Record<string, string>;  // commit sha per writable checkout: repo url (single-repo) or workspace name (multi-repo, WP-214); sole record — F-129 collapsed the duplicate perRepoCommits
  contextSnapshotRef: ArtifactRef;     // compacted context (CM-1 co-design)
  budgetSpentUsd: number;
  lastGood: boolean;                   // judge PROCEED marker
}
```

## 6a. Compaction (WP-203, ADR-006)

Context-rot mitigation (CM-1/CM-2). Compaction runs **at the checkpoint
boundary** (`writeCheckpoint`, the CM-1 co-design point) so a resume never
rehydrates rotted context. The **decision** of what to fold is a pure function;
the LLM digest call + the journal/artifact write are the non-pure wiring on
top. The `compaction` JIF kind carries the `CompactionResult`.

```ts
export interface CompactionPolicy {
  triggerAfterSteps: number;           // recall tier must exceed this to be eligible
  keepLastN: number;                   // newest N summaries kept verbatim (CM-2)
}

export interface CompactionPlan {      // pure output of planCompaction
  keepVerbatim: string[];              // newest summaries kept (order preserved)
  toDigest: string[];                  // older summaries to fold (empty ⇒ no-op)
}

export interface CompactionResult {    // journaled (compaction kind)
  tokensBefore: number;
  tokensAfter: number;
  digestRef?: ArtifactRef;             // Memory Pointer (WP-202) to the digest
}

// Pure, unit-tested decision core (src/runner/compaction.ts):
export function planCompaction(summaries: readonly string[], policy: CompactionPolicy): CompactionPlan;
```

`CompactionPolicy`/`CompactionPlan`/`planCompaction` are language-local code
contracts (no fixture); `CompactionResult` is the journaled payload shape
(journal-format.md §3, `compaction`).

## 7. Durable runner (the substrate seam — ADR-001)

```ts
export type RunStatus =
  | "RUNNING" | "AWAITING_APPROVAL" | "SUSPENDED"
  | "SUCCESS" | "FAILED" | "CANCELLED";

export interface RunHandle {
  runId: string;
  status(): Promise<RunStatusReport>;
  approve(decision: { approved: boolean; reason?: string }): Promise<void>; // ESCALATE answer
  inject(guidance: string): Promise<void>;       // WP-212
  cancel(): Promise<void>;                       // graceful, checkpointed
}

export interface RunStatusReport {
  status: RunStatus;
  currentStep: number;
  spentUsd: number;
  budgetUsd: number;
  lastVerdict?: { kind: VerdictKind; atStep: number };
  checkpoints: Checkpoint[];
  failure?: { reason: string; lastCheckpoint: CheckpointId };  // explicit terminal (CG-1)
}

export interface DurableRunner {
  start(spec: TaskSpec): Promise<RunHandle>;
  resume(runId: string, opts?: { addBudgetUsd?: number }): Promise<RunHandle>;
  branch(from: CheckpointId): Promise<RunHandle>;              // P2 (WP-205)
  get(runId: string): Promise<RunHandle>;
  list(): Promise<RunStatusReport[]>;
}
```

Implementations: `TemporalRunner` (P1, only one). The interface exists because ADR-001 names a possible second (revisit trigger); do **not** add abstraction beyond it (NF-1).

## 7a. Plans & chains (WP-219, ADR-005)

A plan is a tree of ordinary judge-gated TaskSpec runs; chaining is an orchestration layer **above** the run loop (NF-1). Each `PlanNode` runs as a normal `TaskSpec`. The plan itself is judged by a meta-judge of a **different family than the planner** (ADR-005 D2). Chain state spans runs and lives in a chain-level store, not a per-run journal (D4).

```ts
export interface PlanNode {
  id: string;                          // "N-1"; referenced by chain linkage + verdicts
  goal: string;                        // self-contained 1–3-step brief; the child run's goal
  acceptanceCriteria: AcceptanceCriterion[];
  dependsOn: string[];                 // node ids that must reach SUCCESS first
  writeSet?: string[];                 // exact repo-relative paths; required for newly planned chains
  budgetUsd: number;                   // per-node cap; chain budget = Σ nodes
}

export interface Plan {
  id: string;
  goal: string;                        // the original goal this plan decomposes
  nodes: PlanNode[];
  createdAt: string;                   // ISO-8601 UTC
}

export type PlanVerdictKind = "PROCEED" | "REVISE" | "ESCALATE"; // REVISE → re-plan

export interface PlanVerdict {
  kind: PlanVerdictKind;
  rationale: string;
  uncoveredCriteria: string[];         // goal criteria the plan fails to cover
}

export interface ChainLink {           // run → chain back-reference (on TaskSpec)
  planId: string;
  nodeId: string;
  chainId?: string;                    // shared artifact namespace / owning chain
  writeSet?: string[];                 // node publication boundary
  parentRunId?: string;                // run whose checkpoint this node started from
  parentHandoffs?: ChainNodeHandoff[]; // ordered like dependsOn; new artifact path
}

export interface RepoHandoff {
  repoUrl: string;
  sourceCommit: string;                // original chain baseline
  baseCommit: string;                  // this node's chikory-base
  headCommit: string;                  // sealed node tree
  changedPaths: string[];
  bundleRef: ArtifactRef;              // repo_snapshot in the configured shared store
}

export interface ChainNodeHandoff {
  nodeId: string;
  runId: string;
  repos: RepoHandoff[];
}

export type ChainStatus =
  | "PLANNING" | "AWAITING_PLAN_APPROVAL" | "RUNNING"
  | "SUSPENDED" | "SUCCESS" | "FAILED" | "CANCELLED";

export interface NodeOutcome {          // a sealed PlanNode's terminal outcome (D3/D4)
  status: TerminalStatus;              // the child run's terminal seal
  verdict: VerdictKind;                // final judge ruling — ESCALATE parks, FAILED halts
}

export interface ChainRecord {
  planId: string;
  plan: Plan;
  planVerdict?: PlanVerdict;
  nodeRuns: Record<string, string>;    // node id → child run id
  nodeOutcomes: Record<string, NodeOutcome>;  // node id → terminal outcome (chain reducer input)
  nodeHandoffs?: Record<string, ChainNodeHandoff>; // sealed artifact provenance
  status: ChainStatus;
}
```

**Planner component (WP-219 S2, ADR-005 D1)** — the `planner/` module that
produces a `Plan` from a goal. Frozen so S2 (planner impl) and S2b (plan
meta-judge) are dogfoodable against a stable surface. The planner is the only
producer of `Plan`; the meta-judge is the only gate before nodes execute.

```ts
export interface PlanInput {
  goal: string;
  acceptanceCriteria: AcceptanceCriterion[];
  budgetUsd: number;                   // chain budget; planner sizes nodes within it
  family: LLMProvider;                 // planner model family; meta-judge MUST differ (D2)
}

export interface GoalPlanner {         // dedicated component (mirrors judge/), routes
  decompose(input: PlanInput): Promise<Plan>;  // its one LLM call through the `plan` stage
}

// Pure coverage check feeding PlanVerdict.uncoveredCriteria — the meta-judge's
// safety precondition (a decomposition that drops a goal criterion is unsafe).
export function planCoverageGaps(plan: Plan, goalCriteria: AcceptanceCriterion[]): string[];
```

`PlanInput`/`GoalPlanner`/`planCoverageGaps` are language-local code contracts
(no wire serialization), so they carry no conformance fixture; `Plan`,
`PlanNode`, and `PlanVerdict` remain the serialized, fixtured, cross-language
data contracts.

## 8. Telemetry

No new interfaces — OTel API types used directly (observability.md defines span names/attrs). Contract-level rule: every implementation of `Router.complete`, `ExecutorAdapter.runStep`, judge pass, and checkpoint write MUST emit its span; conformance suites assert span presence via in-memory exporter.

## 9. Validation rules (enforced at `TaskSpec` parse — WP-005)

| Rule | Source |
|---|---|
| `judge.family !== executor.family` unless `allowSameFamily` (then warn to console + journal) | invariant #2 |
| `budgetUsd > 0`; `judge.cadence >= 1`; `repos.length >= 1`; ≥1 writable repo | sanity |
| Every routing stage resolvable to a configured provider (env key present) — fail fast naming the missing var | router.md |
| `acceptanceCriteria` non-empty; ids unique | OB-3 |

## 10. Cross-language conformance (WP-201)

- `fixtures/contracts/*.json`: serialized instances of every interface above (valid + invalid sets).
- TS and Python each ship `parse → validate → re-serialize` round-trip tests against the same fixtures; byte-identical canonical JSON output required.
- Journal/interchange fixtures double as the benchmark format tests (journal-format.md §4).
