/**
 * Core contracts v1 (WP-002) — frozen transcription of `docs/spec/CONTRACTS.md`.
 *
 * This file and CONTRACTS.md must never diverge; change both in a single
 * `contracts:` PR per TASK-PROTOCOL.md §4. Python parity (WP-201) mirrors
 * these 1:1; cross-language conformance is verified against the shared JSON
 * fixtures in `fixtures/contracts/` (CONTRACTS.md §10).
 */

// ─── §1 Providers & routing ─────────────────────────────────────────────────

export type LLMProvider = "anthropic" | "openai" | "gemini" | "openai-compat";

export type Stage = "plan" | "code" | "review" | "judge";

export interface ModelChoice {
  provider: LLMProvider;
  model: string;
}

/** RT-4/5/6 — swapping vendors is a config diff, never a code change. */
export interface RoutingPolicy {
  stages: Record<Stage, ModelChoice>;
  /** Ordered fallback list per stage. */
  failover?: Partial<Record<Stage, ModelChoice[]>>;
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
  /** JSON Schema; judge form-filling requires it. */
  responseSchema?: object;
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

// ─── §2 Task specification ──────────────────────────────────────────────────

/**
 * Canonical user input; YAML form documented in `docs/spec/task-spec.md`,
 * parse-time validation rules in CONTRACTS.md §9 (WP-005).
 */
export interface TaskSpec {
  name: string;
  /** OB-3: success criteria upfront. */
  goal: string;
  /** 1 repo in P1; N in P2 (WP-214). */
  repos: RepoSpec[];
  acceptanceCriteria: AcceptanceCriterion[];
  /** CG-2 hard cap. */
  budgetUsd: number;
  /** P2 (WP-218 slice 2) — token-denominated cap, complements budgetUsd (CG-2). */
  budgetTokens?: number;
  maxSteps?: number;
  /**
   * WP-509/F-88 — chain-only decomposition floor. When set, `chikory chain`
   * rejects a plan with fewer nodes (the planner collapsed a decomposable goal
   * too coarsely). Absent = no floor. Ignored by single `chikory run`.
   */
  minNodes?: number;
  executor: { adapter: string; family: LLMProvider };
  judge: JudgePolicy;
  routing: RoutingPolicy;
  /** P2 (WP-207); absent = fixed defaults. */
  pacing?: PacingPolicy;
  /** P2 (WP-208). */
  notifications?: NotificationPolicy;
  /** P2 (WP-219, ADR-005) — present when this run is a node in a chain. */
  chainLink?: ChainLink;
  /**
   * WP-243 dogfood/test-only: force a deterministic SUSPEND park before the
   * given step index, so WP-241's chain surfacing + `chikory chain resume` are
   * provable without a non-deterministic budget/ESCALATE trigger (F-44). Off
   * the happy path; armed host-side from `CHIKORY_PARK_*` env, never read in
   * the workflow (replay-safe — it rides the frozen workflow input).
   */
  debug?: {
    parkBeforeStep?: number;
    /**
     * WP-244 dogfood/test-only: right after the executor's step `atStep`
     * runs, overwrite `path` (workspace-relative) with `content`,
     * deterministically introducing a regression the real-time judge must
     * catch on the very next pass via its acceptance `check` (JD-3). Proves
     * the Agent-as-a-Judge true-positive catch on demand, independent of
     * executor skill — the judge-catch analog of `parkBeforeStep` (dogfood-045
     * F-46: a "hope the executor fails" trap is non-deterministic; a strong
     * executor one-shots it). Off the happy path; armed host-side from
     * `CHIKORY_SEED_BAD_DIFF_*` env, never read in the workflow (replay-safe —
     * rides the frozen workflow input); the seeding activity is idempotent
     * (same path+content), so it fires exactly once.
     */
    seedBadDiff?: { atStep: number; path: string; content: string };
    /**
     * WP-207 dogfood/test-only: override the context-window token budget the
     * pacing decision (`decideContextWindowPacing`) reasons against, so a short
     * run deterministically crosses the `compact`/`park` pressure threshold and
     * the pressure-driven compaction cadence (WP-203 S2) is provable without a
     * non-deterministic 200k-token accumulation (the `parkBeforeStep`/
     * `seedBadDiff` analog). Off the happy path; armed host-side from
     * `CHIKORY_CONTEXT_WINDOW_TOKENS` env, never read from env in the workflow
     * (replay-safe — rides the frozen workflow input).
     */
    contextWindowTokens?: number;
  };
}

export interface RepoSpec {
  /** Local path or git URL. */
  url: string;
  /** Branch/commit; default = default branch. */
  ref?: string;
  /** Read-only mounts allowed (context repos). */
  writable: boolean;
}

export interface AcceptanceCriterion {
  /** Stable, referenced by verdicts ("AC-1"). */
  id: string;
  description: string;
  /** Shell command run by the JUDGE in sandbox; exit 0 = pass (JD-4). */
  check?: string;
}

export interface JudgePolicy {
  /** Must differ from `executor.family` (invariant #2). */
  family: LLMProvider;
  /** Default from `routing.stages.judge`. */
  model?: string;
  /** Judge every N steps (JD-2), default 3. */
  cadence: number;
  /** Explicit opt-in, loud warning (WP-133). */
  allowSameFamily?: boolean;
  /** Default pointwise (ADR-002). */
  scoringMethod?: "pointwise" | "pairwise";
  /** Warn when judge spend > this fraction of run cost (JD-7). */
  maxCostShare?: number;
  /** P2 (WP-215): "security", "architecture". */
  rubricPacks?: string[];
}

/** P2 (WP-207) — reserved; shape finalized after dogfood-001 data. */
export interface PacingPolicy {
  mode: "auto" | "fixed";
}

/** P2 (WP-208) — reserved. */
export interface NotificationPolicy {
  on: Array<"escalate" | "milestone" | "terminal">;
  slackWebhookEnv?: string;
}

// ─── §3 Steps & executors ───────────────────────────────────────────────────

export type TerminalStatus = "SUCCESS" | "FAILED";

export interface ExecutorAdapter {
  /** "claude-code" | "codex" | "native" | ... */
  readonly name: string;
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
  /** Invariant #4. */
  status: TerminalStatus;
  diffRef: ArtifactRef;
  summary: string;
  toolCalls: number;
  tokens: TokenUsage;
  costUsd: number;
  /** CLI adapters may estimate (cost-governance.md). */
  costEstimated: boolean;
  durationMs: number;
  transcriptRef: ArtifactRef;
  failure?: { reason: string; retriable: boolean };
  /**
   * P2 (WP-221) — executor's explicit "task done" signal from its final
   * summary. OR'd into the WP-217 empty-diff trigger so the *productive* step
   * is judged directly, removing the dedicated probe step (F-11). Absent =
   * inference as today.
   */
  claimsComplete?: boolean;
}

export interface TokenUsage {
  input: number;
  output: number;
}

/** What the runner assembles for each step — the context-tier projection (CM-4). */
export interface ContextBundle {
  goal: string;
  acceptanceCriteria: AcceptanceCriterion[];
  /** Current task-tree item. */
  planItem: string;
  /** Structured notes, survive compaction verbatim (CM-2). */
  notes: Record<string, string>;
  /** Recall tier: compacted summaries. */
  recentSteps: string[];
  /** Last non-PROCEED rationale. */
  judgeFeedback?: string;
  /** WP-212, drained in order. */
  injections: string[];
  /** Archival pointers (CM-3). */
  memoryRefs: ArtifactRef[];
}

// ─── §4 Judge ───────────────────────────────────────────────────────────────

/** BRANCH active P2+ (WP-205). */
export type VerdictKind = "PROCEED" | "ROLLBACK" | "HALT" | "ESCALATE" | "BRANCH";

export interface JudgeEvidence {
  /** Per repo, since last verdict. */
  diffRefs: ArtifactRef[];
  /** Judge-executed, never executor-claimed (JD-4). */
  testResults?: TestResultArtifact;
  criteria: AcceptanceCriterion[];
  /** Flip-flop/drift detection (JD-7). */
  criteriaHistory: Record<string, boolean[]>;
  stepSummaries: string[];
  /** Screenshots, scans (P2). */
  artifacts: ArtifactRef[];
}

/**
 * The LLM fills this form; CODE computes the verdict from it
 * (reward-hacking guard — see judge.md and the deterministic verdict rules
 * in CONTRACTS.md §4, implemented in `judge/verdict.ts` in P1).
 */
export interface JudgeForm {
  criterionResults: Array<{ id: string; pass: boolean; justification: string }>;
  rubricResults: Array<{ id: string; pass: boolean; justification: string }>;
  concerns: string[];
}

export interface JudgeVerdict {
  kind: VerdictKind;
  form: JudgeForm;
  rationale: string;
  /** Required when kind=ROLLBACK. */
  rollbackTo?: CheckpointId;
  /** Required when kind=ESCALATE. */
  escalateReason?: string;
  costUsd: number;
  tokens: TokenUsage;
  judgeModel: ModelChoice;
}

// ─── §5 Artifacts ───────────────────────────────────────────────────────────

export type ArtifactKind =
  | "repo_snapshot"
  | "diff"
  | "test_results"
  | "task_tree"
  | "browser_state"
  | "transcript"
  | "tool_output"
  | "context_snapshot";

/** Memory Pointer Pattern (CM-3): big payloads live outside the context. */
export interface ArtifactRef {
  /** Content hash (sha256) — stable across resume/branch. */
  id: string;
  kind: ArtifactKind;
  bytes: number;
  /** ≤200 chars; the only part that enters context by default (CM-3). */
  summary: string;
}

export interface ArtifactStore {
  put(
    content: Uint8Array | string,
    meta: { kind: ArtifactKind; summary: string },
  ): Promise<ArtifactRef>;
  get(ref: ArtifactRef): Promise<Uint8Array>;
  excerpt(ref: ArtifactRef, sel: { range?: [number, number]; query?: string }): Promise<string>;
}

export interface TestResultArtifact {
  /** Raw output. */
  ref: ArtifactRef;
  command: string;
  exitCode: number;
  passed: number;
  failed: number;
  durationMs: number;
}

// ─── §6 Journal & checkpoints ───────────────────────────────────────────────

/** `${runId}@${journalIdx}`. */
export type CheckpointId = string;

export type JournalEntryKind =
  | "step"
  | "judge"
  | "checkpoint"
  | "verdict"
  | "injection"
  | "control_event"
  | "budget_event"
  | "compaction"
  | "pacing"
  | "terminal"
  | "seam"
  // P2 (WP-219, ADR-005) — chain-scope kinds (shared JIF; emitted to the
  // chain store, not a per-run journal).
  | "plan"
  | "plan_verdict"
  | "node_started"
  | "node_sealed";

/** Persisted form specified in `docs/spec/journal-format.md` (JIF). */
export interface JournalEntry {
  /** Monotonic per run. */
  idx: number;
  /** ISO-8601 UTC. */
  ts: string;
  kind: JournalEntryKind;
  /** Kind-discriminated; see journal-format.md. */
  payload: unknown;
  costDeltaUsd: number;
  tokens?: TokenUsage;
  artifactRefs: ArtifactRef[];
}

export interface Checkpoint {
  id: CheckpointId;
  journalIdx: number;
  /** Repo url → commit sha (multi-repo, WP-214). */
  gitCommits: Record<string, string>;
  /** Compacted context (CM-1 co-design). */
  contextSnapshotRef: ArtifactRef;
  budgetSpentUsd: number;
  /** Judge PROCEED marker. */
  lastGood: boolean;
}

// ─── §6a Compaction (WP-203, ADR-006) ───────────────────────────────────────
// Context-rot mitigation (CM-1/CM-2). Compaction runs AT the checkpoint
// boundary (activities.ts writeCheckpoint, the CM-1 co-design point) so a
// resume never rehydrates rotted context. The decision of WHAT to fold is a
// pure function (`planCompaction`); the LLM digest call + the journal/artifact
// write are the non-pure wiring on top.

/** Knobs for the pure compaction decision (ADR-006). */
export interface CompactionPolicy {
  /** Only eligible once the recall tier exceeds this many step summaries. */
  triggerAfterSteps: number;
  /** Newest N step summaries kept verbatim — never folded (CM-2). */
  keepLastN: number;
}

/** Pure output of `planCompaction`: which recall-tier summaries fold vs stay. */
export interface CompactionPlan {
  /** Newest summaries kept verbatim in the recall tier (order preserved). */
  keepVerbatim: string[];
  /** Older summaries to fold into one digest (empty ⇒ no compaction this turn). */
  toDigest: string[];
}

/** Journaled outcome of a compaction (the `compaction` JIF kind). */
export interface CompactionResult {
  tokensBefore: number;
  tokensAfter: number;
  /** Memory Pointer (WP-202) to the folded digest; absent if nothing folded. */
  digestRef?: ArtifactRef;
}

// ─── §7 Durable runner (the substrate seam — ADR-001) ───────────────────────

export type RunStatus =
  | "RUNNING"
  | "AWAITING_APPROVAL"
  | "SUSPENDED"
  | "SUCCESS"
  | "FAILED"
  | "CANCELLED";

export interface RunHandle {
  runId: string;
  status(): Promise<RunStatusReport>;
  /** ESCALATE answer. */
  approve(decision: { approved: boolean; reason?: string }): Promise<void>;
  /** WP-212. */
  inject(guidance: string): Promise<void>;
  /** Operator HITL pause; parks at the next durable step boundary. */
  suspend(): Promise<void>;
  /** Graceful, checkpointed. */
  cancel(): Promise<void>;
}

export interface RunStatusReport {
  status: RunStatus;
  currentStep: number;
  spentUsd: number;
  budgetUsd: number;
  lastVerdict?: { kind: VerdictKind; atStep: number };
  checkpoints: Checkpoint[];
  /** Explicit terminal (CG-1). */
  failure?: { reason: string; lastCheckpoint: CheckpointId };
}

/**
 * Implementations: `TemporalRunner` (P1, the only one). The interface exists
 * because ADR-001 names a possible second substrate (revisit trigger); do
 * NOT add abstraction beyond it (NF-1).
 */
export interface DurableRunner {
  start(spec: TaskSpec): Promise<RunHandle>;
  resume(runId: string, opts?: { addBudgetUsd?: number }): Promise<RunHandle>;
  /** P2 (WP-205). */
  branch(from: CheckpointId): Promise<RunHandle>;
  get(runId: string): Promise<RunHandle>;
  list(): Promise<RunStatusReport[]>;
}

// ─── §7a Plans & chains (WP-219, ADR-005) ───────────────────────────────────
// A plan is a tree of ordinary judge-gated TaskSpec runs; chaining is an
// orchestration layer ABOVE the run loop (NF-1). See ADR-005.

/** One slice of a Plan — runs as an ordinary TaskSpec, gated like any other. */
export interface PlanNode {
  /** Stable, referenced by chain linkage + verdicts ("N-1"). */
  id: string;
  /** Self-contained 1–3-step brief; becomes the child run's goal. */
  goal: string;
  acceptanceCriteria: AcceptanceCriterion[];
  /** Node ids that must reach SUCCESS before this node starts. */
  dependsOn: string[];
  /** Exact repo-relative paths this node may create, modify, rename, or delete. */
  writeSet?: string[];
  /** Per-node cap; chain budget = Σ nodes. */
  budgetUsd: number;
}

/** A decomposed goal: an ordered dependency tree of judge-gated slices. */
export interface Plan {
  id: string;
  /** The original user goal this plan decomposes. */
  goal: string;
  nodes: PlanNode[];
  /** ISO-8601 UTC. */
  createdAt: string;
}

/**
 * Planner input (WP-219 S2, ADR-005 D1). What the dedicated `planner/`
 * component decomposes — the user goal plus the goal-level acceptance criteria
 * the plan must cover and the chain's total budget. The planner routes its one
 * decomposition LLM call through the `plan` routing stage (NF-1); `family` is
 * the planner's own model family, frozen here so the D2 plan meta-judge can
 * enforce **plan-judge ≠ planner family** (invariant #2, extended to plans).
 */
export interface PlanInput {
  goal: string;
  acceptanceCriteria: AcceptanceCriterion[];
  /** Chain budget = Σ node budgets; the planner sizes nodes within this. */
  budgetUsd: number;
  /** Planner model family — the plan meta-judge must differ from it (D2). */
  family: LLMProvider;
  /** WP-509/F-88 — decomposition floor surfaced to the planner; absent = none. */
  minNodes?: number;
}

/**
 * The goal decomposer (WP-219 S2, ADR-005 D1). A dedicated component (mirrors
 * `judge/`): owns the decomposition logic, isolation, and tests; calls the
 * router for the single `plan`-stage LLM call. Output is an ordinary `Plan`
 * (an ordered dependency tree of judge-gated `PlanNode`s) that the S2b plan
 * meta-judge gates before any node executes (D2). Static decomposition;
 * halt-and-replan on node failure is the chain executor's job (D3).
 */
export interface GoalPlanner {
  decompose(input: PlanInput): Promise<Plan>;
}

/** Plan meta-judge verdict (ADR-005 D2). REVISE → re-plan; ESCALATE → human. */
export type PlanVerdictKind = "PROCEED" | "REVISE" | "ESCALATE";

export interface PlanVerdict {
  kind: PlanVerdictKind;
  rationale: string;
  /** Goal criteria the plan fails to cover (empty on PROCEED). */
  uncoveredCriteria: string[];
}

/** Run → chain back-reference; persisted with the run. */
export interface ChainLink {
  planId: string;
  nodeId: string;
  /** Owning chain; locates the shared handoff artifact namespace. */
  chainId?: string;
  /** Planner-declared boundary enforced before publishing this node. */
  writeSet?: string[];
  /** The run whose checkpoint this node started from (predecessor). */
  parentRunId?: string;
  /** Ordered exactly like the node's dependsOn list. */
  parentHandoffs?: ChainNodeHandoff[];
}

/** One repository snapshot published by a sealed chain node. */
export interface RepoHandoff {
  repoUrl: string;
  sourceCommit: string;
  baseCommit: string;
  headCommit: string;
  changedPaths: string[];
  bundleRef: ArtifactRef;
}

/** Artifact-backed output of one sealed chain node. */
export interface ChainNodeHandoff {
  nodeId: string;
  runId: string;
  repos: RepoHandoff[];
}

export type ChainStatus =
  | "PLANNING"
  | "AWAITING_PLAN_APPROVAL"
  | "RUNNING"
  | "SUSPENDED"
  | "SUCCESS"
  | "FAILED"
  | "CANCELLED";

/**
 * A sealed PlanNode's terminal outcome — the chain-state reducer's per-node
 * input (ADR-005 D3/D4). `status` is the child run's terminal seal; `verdict`
 * is its final judge ruling (the reducer reads `verdict` to separate an
 * ESCALATE park from a FAILED halt). The child run id stays in
 * `ChainRecord.nodeRuns`.
 */
export interface NodeOutcome {
  status: TerminalStatus;
  verdict: VerdictKind;
}

/** Chain-level state — spans runs, lives above any one run's journal (D4). */
export interface ChainRecord {
  planId: string;
  plan: Plan;
  /** Latest meta-judge verdict on the plan. */
  planVerdict?: PlanVerdict;
  /** node id → child run id (the reverse of TaskSpec.chainLink). */
  nodeRuns: Record<string, string>;
  /** node id → terminal outcome of its sealed child run (empty until a node seals). */
  nodeOutcomes: Record<string, NodeOutcome>;
  /** node id → sealed, artifact-backed repository snapshots. */
  nodeHandoffs?: Record<string, ChainNodeHandoff>;
  status: ChainStatus;
}

// ─── §8 Telemetry ───────────────────────────────────────────────────────────
// No new interfaces — OTel API types are used directly (observability.md
// defines span names/attributes). Contract-level rule: every implementation
// of Router.complete, ExecutorAdapter.runStep, judge pass, and checkpoint
// write MUST emit its span; conformance suites assert span presence via an
// in-memory exporter.
