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
  maxSteps?: number;
  executor: { adapter: string; family: LLMProvider };
  judge: JudgePolicy;
  routing: RoutingPolicy;
  pacing?: PacingPolicy;              // P2 (WP-207); absent = fixed defaults
  notifications?: NotificationPolicy; // P2 (WP-208)
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
  criterionResults: Array<{ id: string; pass: boolean; justification: string }>;
  rubricResults: Array<{ id: string; pass: boolean; justification: string }>;
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
}

export interface ArtifactStore {
  put(content: Uint8Array | string, meta: { kind: ArtifactKind; summary: string }): Promise<ArtifactRef>;
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
  | "budget_event" | "compaction" | "pacing" | "terminal";

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
  gitCommits: Record<string, string>;  // repo url → commit sha (multi-repo, WP-214)
  contextSnapshotRef: ArtifactRef;     // compacted context (CM-1 co-design)
  budgetSpentUsd: number;
  lastGood: boolean;                   // judge PROCEED marker
}
```

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
