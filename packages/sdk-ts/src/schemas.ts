/**
 * Runtime validators for the serializable contracts in `types.ts` (WP-002).
 *
 * One zod schema per data interface, all `.strict()` — unknown keys are
 * contract violations. These back the cross-language conformance fixtures in
 * `fixtures/contracts/` (CONTRACTS.md §10) and the TaskSpec parser (WP-005).
 * Interfaces with methods (Router, ExecutorAdapter, ArtifactStore, RunHandle,
 * DurableRunner) have no serialized form and therefore no schema.
 */
import { z } from "zod";

import type {
  AcceptanceCriterion,
  ArtifactRef,
  ChainLink,
  ChainRecord,
  Checkpoint,
  CompletionRequest,
  ContextBundle,
  JournalEntry,
  JudgeEvidence,
  JudgeForm,
  JudgePolicy,
  JudgeVerdict,
  LLMCallResult,
  Message,
  ModelChoice,
  NotificationPolicy,
  PacingPolicy,
  Plan,
  PlanNode,
  PlanVerdict,
  RepoSpec,
  RouterError,
  RoutingPolicy,
  RunStatusReport,
  StepInput,
  StepLimits,
  StepRecord,
  TaskSpec,
  TestResultArtifact,
  TokenUsage,
} from "./types.js";

// ─── §1 Providers & routing ─────────────────────────────────────────────────

export const LLMProviderSchema = z.enum(["anthropic", "openai", "gemini", "openai-compat"]);

export const StageSchema = z.enum(["plan", "code", "review", "judge"]);

export const ModelChoiceSchema = z
  .object({
    provider: LLMProviderSchema,
    model: z.string().min(1),
  })
  .strict();

export const RoutingPolicySchema = z
  .object({
    stages: z
      .object({
        plan: ModelChoiceSchema,
        code: ModelChoiceSchema,
        review: ModelChoiceSchema,
        judge: ModelChoiceSchema,
      })
      .strict(),
    failover: z
      .object({
        plan: z.array(ModelChoiceSchema).optional(),
        code: z.array(ModelChoiceSchema).optional(),
        review: z.array(ModelChoiceSchema).optional(),
        judge: z.array(ModelChoiceSchema).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const MessageSchema = z
  .object({
    role: z.enum(["user", "assistant", "system"]),
    content: z.string(),
  })
  .strict();

export const CompletionRequestSchema = z
  .object({
    stage: StageSchema,
    messages: z.array(MessageSchema).min(1),
    maxTokens: z.number().int().positive().optional(),
    temperature: z.number().min(0).optional(),
    responseSchema: z
      .custom<object>((v) => typeof v === "object" && v !== null && !Array.isArray(v))
      .optional(),
  })
  .strict();

export const TokenUsageSchema = z
  .object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
  })
  .strict();

export const LLMCallResultSchema = z
  .object({
    status: z.literal("SUCCESS"),
    content: z.string(),
    provider: LLMProviderSchema,
    model: z.string().min(1),
    tokens: TokenUsageSchema,
    costUsd: z.number().nonnegative(),
  })
  .strict();

export const RouterErrorSchema = z
  .object({
    status: z.literal("FAILED"),
    reason: z.string().min(1),
    retriable: z.boolean(),
    attempts: z.number().int().nonnegative(),
    provider: LLMProviderSchema.optional(),
  })
  .strict();

// ─── §2 Task specification ──────────────────────────────────────────────────

export const RepoSpecSchema = z
  .object({
    url: z.string().min(1),
    ref: z.string().min(1).optional(),
    writable: z.boolean(),
  })
  .strict();

export const AcceptanceCriterionSchema = z
  .object({
    id: z.string().min(1),
    description: z.string().min(1),
    check: z.string().min(1).optional(),
  })
  .strict();

export const JudgePolicySchema = z
  .object({
    family: LLMProviderSchema,
    model: z.string().min(1).optional(),
    cadence: z.number().int().min(1),
    allowSameFamily: z.boolean().optional(),
    scoringMethod: z.enum(["pointwise", "pairwise"]).optional(),
    maxCostShare: z.number().gt(0).lte(1).optional(),
    rubricPacks: z.array(z.string()).optional(),
  })
  .strict();

export const PacingPolicySchema = z
  .object({
    mode: z.enum(["auto", "fixed"]),
  })
  .strict();

export const NotificationPolicySchema = z
  .object({
    on: z.array(z.enum(["escalate", "milestone", "terminal"])),
    slackWebhookEnv: z.string().min(1).optional(),
  })
  .strict();

/** WP-219 (ADR-005) — run → chain back-reference; defined here for TaskSpec. */
export const ChainLinkSchema = z
  .object({
    planId: z.string().min(1),
    nodeId: z.string().min(1),
    parentRunId: z.string().min(1).optional(),
  })
  .strict();

export const TaskSpecSchema = z
  .object({
    name: z.string().min(1),
    goal: z.string().min(1),
    repos: z.array(RepoSpecSchema).min(1),
    acceptanceCriteria: z.array(AcceptanceCriterionSchema).min(1),
    budgetUsd: z.number().gt(0),
    budgetTokens: z.number().int().positive().optional(),
    maxSteps: z.number().int().positive().optional(),
    executor: z
      .object({
        adapter: z.string().min(1),
        family: LLMProviderSchema,
      })
      .strict(),
    judge: JudgePolicySchema,
    routing: RoutingPolicySchema,
    pacing: PacingPolicySchema.optional(),
    notifications: NotificationPolicySchema.optional(),
    chainLink: ChainLinkSchema.optional(),
  })
  .strict();

// ─── §3 Steps & executors ───────────────────────────────────────────────────

export const TerminalStatusSchema = z.enum(["SUCCESS", "FAILED"]);

export const StepLimitsSchema = z
  .object({
    maxSeconds: z.number().positive(),
    maxTurns: z.number().int().positive().optional(),
    maxCostUsd: z.number().positive().optional(),
  })
  .strict();

// ─── §5 Artifacts (before §3/§4 record schemas that embed refs) ─────────────

export const ArtifactKindSchema = z.enum([
  "repo_snapshot",
  "diff",
  "test_results",
  "task_tree",
  "browser_state",
  "transcript",
  "tool_output",
  "context_snapshot",
]);

export const ArtifactRefSchema = z
  .object({
    id: z.string().min(1),
    kind: ArtifactKindSchema,
    bytes: z.number().int().nonnegative(),
    summary: z.string().max(200),
  })
  .strict();

export const TestResultArtifactSchema = z
  .object({
    ref: ArtifactRefSchema,
    command: z.string().min(1),
    exitCode: z.number().int(),
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    durationMs: z.number().nonnegative(),
  })
  .strict();

export const ContextBundleSchema = z
  .object({
    goal: z.string().min(1),
    acceptanceCriteria: z.array(AcceptanceCriterionSchema),
    planItem: z.string(),
    notes: z.record(z.string(), z.string()),
    recentSteps: z.array(z.string()),
    judgeFeedback: z.string().optional(),
    injections: z.array(z.string()),
    memoryRefs: z.array(ArtifactRefSchema),
  })
  .strict();

export const StepInputSchema = z
  .object({
    workspaceDir: z.string().min(1),
    instruction: z.string().min(1),
    context: ContextBundleSchema,
    limits: StepLimitsSchema,
  })
  .strict();

export const StepRecordSchema = z
  .object({
    status: TerminalStatusSchema,
    diffRef: ArtifactRefSchema,
    summary: z.string(),
    toolCalls: z.number().int().nonnegative(),
    tokens: TokenUsageSchema,
    costUsd: z.number().nonnegative(),
    costEstimated: z.boolean(),
    durationMs: z.number().nonnegative(),
    transcriptRef: ArtifactRefSchema,
    failure: z
      .object({
        reason: z.string().min(1),
        retriable: z.boolean(),
      })
      .strict()
      .optional(),
    claimsComplete: z.boolean().optional(),
  })
  .strict();

// ─── §4 Judge ───────────────────────────────────────────────────────────────

export const VerdictKindSchema = z.enum(["PROCEED", "ROLLBACK", "HALT", "ESCALATE", "BRANCH"]);

export const JudgeEvidenceSchema = z
  .object({
    diffRefs: z.array(ArtifactRefSchema),
    testResults: TestResultArtifactSchema.optional(),
    criteria: z.array(AcceptanceCriterionSchema),
    criteriaHistory: z.record(z.string(), z.array(z.boolean())),
    stepSummaries: z.array(z.string()),
    artifacts: z.array(ArtifactRefSchema),
  })
  .strict();

const JudgeFormItemSchema = z
  .object({
    id: z.string().min(1),
    pass: z.boolean(),
    justification: z.string(),
  })
  .strict();

export const JudgeFormSchema = z
  .object({
    criterionResults: z.array(JudgeFormItemSchema),
    rubricResults: z.array(JudgeFormItemSchema),
    concerns: z.array(z.string()),
  })
  .strict();

export const JudgeVerdictSchema = z
  .object({
    kind: VerdictKindSchema,
    form: JudgeFormSchema,
    rationale: z.string().min(1),
    rollbackTo: z.string().min(1).optional(),
    escalateReason: z.string().min(1).optional(),
    costUsd: z.number().nonnegative(),
    tokens: TokenUsageSchema,
    judgeModel: ModelChoiceSchema,
  })
  .strict()
  .refine((v) => v.kind !== "ROLLBACK" || v.rollbackTo !== undefined, {
    message: "rollbackTo is required when kind=ROLLBACK",
  })
  .refine((v) => v.kind !== "ESCALATE" || v.escalateReason !== undefined, {
    message: "escalateReason is required when kind=ESCALATE",
  });

// ─── §6 Journal & checkpoints ───────────────────────────────────────────────

export const JournalEntryKindSchema = z.enum([
  "step",
  "judge",
  "checkpoint",
  "verdict",
  "injection",
  "budget_event",
  "compaction",
  "pacing",
  "terminal",
  "plan",
  "plan_verdict",
  "node_started",
  "node_sealed",
]);

export const JournalEntrySchema = z
  .object({
    idx: z.number().int().nonnegative(),
    ts: z.string().datetime(),
    kind: JournalEntryKindSchema,
    payload: z.unknown(),
    costDeltaUsd: z.number(),
    tokens: TokenUsageSchema.optional(),
    artifactRefs: z.array(ArtifactRefSchema),
  })
  .strict();

export const CheckpointSchema = z
  .object({
    id: z.string().min(1),
    journalIdx: z.number().int().nonnegative(),
    gitCommits: z.record(z.string(), z.string()),
    contextSnapshotRef: ArtifactRefSchema,
    budgetSpentUsd: z.number().nonnegative(),
    lastGood: z.boolean(),
  })
  .strict();

// ─── §7 Durable runner ──────────────────────────────────────────────────────

export const RunStatusSchema = z.enum([
  "RUNNING",
  "AWAITING_APPROVAL",
  "SUSPENDED",
  "SUCCESS",
  "FAILED",
  "CANCELLED",
]);

export const RunStatusReportSchema = z
  .object({
    status: RunStatusSchema,
    currentStep: z.number().int().nonnegative(),
    spentUsd: z.number().nonnegative(),
    budgetUsd: z.number().gt(0),
    lastVerdict: z
      .object({
        kind: VerdictKindSchema,
        atStep: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    checkpoints: z.array(CheckpointSchema),
    failure: z
      .object({
        reason: z.string().min(1),
        lastCheckpoint: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict();

// ─── §7a Plans & chains (WP-219, ADR-005) ───────────────────────────────────

export const PlanNodeSchema = z
  .object({
    id: z.string().min(1),
    goal: z.string().min(1),
    acceptanceCriteria: z.array(AcceptanceCriterionSchema).min(1),
    dependsOn: z.array(z.string().min(1)),
    budgetUsd: z.number().gt(0),
  })
  .strict();

export const PlanSchema = z
  .object({
    id: z.string().min(1),
    goal: z.string().min(1),
    nodes: z.array(PlanNodeSchema).min(1),
    createdAt: z.string().datetime(),
  })
  .strict();

export const PlanVerdictKindSchema = z.enum(["PROCEED", "REVISE", "ESCALATE"]);

export const PlanVerdictSchema = z
  .object({
    kind: PlanVerdictKindSchema,
    rationale: z.string().min(1),
    uncoveredCriteria: z.array(z.string().min(1)),
  })
  .strict();

export const ChainStatusSchema = z.enum([
  "PLANNING",
  "AWAITING_PLAN_APPROVAL",
  "RUNNING",
  "SUSPENDED",
  "SUCCESS",
  "FAILED",
  "CANCELLED",
]);

export const ChainRecordSchema = z
  .object({
    planId: z.string().min(1),
    plan: PlanSchema,
    planVerdict: PlanVerdictSchema.optional(),
    nodeRuns: z.record(z.string(), z.string()),
    status: ChainStatusSchema,
  })
  .strict();

// ─── Type-parity assertions ─────────────────────────────────────────────────
// Compile-time check: every valid value of a contract interface is accepted
// by its schema's inferred type. (The runtime direction is covered by the
// fixture round-trip tests.)

type AssertAccepts<_Iface extends Inferred, Inferred> = true;

export type ContractTypeChecks = [
  AssertAccepts<ModelChoice, z.infer<typeof ModelChoiceSchema>>,
  AssertAccepts<RoutingPolicy, z.infer<typeof RoutingPolicySchema>>,
  AssertAccepts<Message, z.infer<typeof MessageSchema>>,
  AssertAccepts<CompletionRequest, z.infer<typeof CompletionRequestSchema>>,
  AssertAccepts<LLMCallResult, z.infer<typeof LLMCallResultSchema>>,
  AssertAccepts<RouterError, z.infer<typeof RouterErrorSchema>>,
  AssertAccepts<TaskSpec, z.infer<typeof TaskSpecSchema>>,
  AssertAccepts<RepoSpec, z.infer<typeof RepoSpecSchema>>,
  AssertAccepts<AcceptanceCriterion, z.infer<typeof AcceptanceCriterionSchema>>,
  AssertAccepts<JudgePolicy, z.infer<typeof JudgePolicySchema>>,
  AssertAccepts<PacingPolicy, z.infer<typeof PacingPolicySchema>>,
  AssertAccepts<NotificationPolicy, z.infer<typeof NotificationPolicySchema>>,
  AssertAccepts<StepInput, z.infer<typeof StepInputSchema>>,
  AssertAccepts<StepLimits, z.infer<typeof StepLimitsSchema>>,
  AssertAccepts<StepRecord, z.infer<typeof StepRecordSchema>>,
  AssertAccepts<TokenUsage, z.infer<typeof TokenUsageSchema>>,
  AssertAccepts<ContextBundle, z.infer<typeof ContextBundleSchema>>,
  AssertAccepts<JudgeEvidence, z.infer<typeof JudgeEvidenceSchema>>,
  AssertAccepts<JudgeForm, z.infer<typeof JudgeFormSchema>>,
  AssertAccepts<JudgeVerdict, z.infer<typeof JudgeVerdictSchema>>,
  AssertAccepts<ArtifactRef, z.infer<typeof ArtifactRefSchema>>,
  AssertAccepts<TestResultArtifact, z.infer<typeof TestResultArtifactSchema>>,
  AssertAccepts<JournalEntry, z.infer<typeof JournalEntrySchema>>,
  AssertAccepts<Checkpoint, z.infer<typeof CheckpointSchema>>,
  AssertAccepts<RunStatusReport, z.infer<typeof RunStatusReportSchema>>,
  AssertAccepts<PlanNode, z.infer<typeof PlanNodeSchema>>,
  AssertAccepts<Plan, z.infer<typeof PlanSchema>>,
  AssertAccepts<PlanVerdict, z.infer<typeof PlanVerdictSchema>>,
  AssertAccepts<ChainLink, z.infer<typeof ChainLinkSchema>>,
  AssertAccepts<ChainRecord, z.infer<typeof ChainRecordSchema>>,
];

/** Schema lookup by interface name — used by the fixture conformance tests. */
export const contractSchemas = {
  ModelChoice: ModelChoiceSchema,
  RoutingPolicy: RoutingPolicySchema,
  Message: MessageSchema,
  CompletionRequest: CompletionRequestSchema,
  LLMCallResult: LLMCallResultSchema,
  RouterError: RouterErrorSchema,
  TaskSpec: TaskSpecSchema,
  RepoSpec: RepoSpecSchema,
  AcceptanceCriterion: AcceptanceCriterionSchema,
  JudgePolicy: JudgePolicySchema,
  PacingPolicy: PacingPolicySchema,
  NotificationPolicy: NotificationPolicySchema,
  StepInput: StepInputSchema,
  StepLimits: StepLimitsSchema,
  StepRecord: StepRecordSchema,
  TokenUsage: TokenUsageSchema,
  ContextBundle: ContextBundleSchema,
  JudgeEvidence: JudgeEvidenceSchema,
  JudgeForm: JudgeFormSchema,
  JudgeVerdict: JudgeVerdictSchema,
  ArtifactRef: ArtifactRefSchema,
  TestResultArtifact: TestResultArtifactSchema,
  JournalEntry: JournalEntrySchema,
  Checkpoint: CheckpointSchema,
  RunStatusReport: RunStatusReportSchema,
  PlanNode: PlanNodeSchema,
  Plan: PlanSchema,
  PlanVerdict: PlanVerdictSchema,
  ChainLink: ChainLinkSchema,
  ChainRecord: ChainRecordSchema,
} as const;

export type ContractName = keyof typeof contractSchemas;
