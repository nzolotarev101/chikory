from __future__ import annotations

from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

LLMProvider = Literal["anthropic", "openai", "gemini", "openai-compat"]
Stage = Literal["plan", "code", "review", "judge"]
TerminalStatus = Literal["SUCCESS", "FAILED"]
VerdictKind = Literal["PROCEED", "ROLLBACK", "HALT", "ESCALATE", "BRANCH"]
ArtifactKind = Literal[
    "repo_snapshot",
    "diff",
    "test_results",
    "task_tree",
    "browser_state",
    "transcript",
    "tool_output",
    "context_snapshot",
]
JournalEntryKind = Literal[
    "step",
    "judge",
    "checkpoint",
    "verdict",
    "injection",
    "control_event",
    "budget_event",
    "compaction",
    "pacing",
    "limit_pace",
    "capability",
    "limit_signal",
    "terminal",
    "seam",
    "remediation",
    "plan",
    "plan_verdict",
    "node_started",
    "node_replanned",
    "node_sealed",
]
PlanVerdictKind = Literal["PROCEED", "REVISE", "ESCALATE"]
ChainStatus = Literal[
    "PLANNING",
    "AWAITING_PLAN_APPROVAL",
    "RUNNING",
    "SUSPENDED",
    "SUCCESS",
    "FAILED",
    "CANCELLED",
]
CheckpointId = str
RunStatus = Literal[
    "RUNNING",
    "AWAITING_APPROVAL",
    "SUSPENDED",
    "SUCCESS",
    "FAILED",
    "CANCELLED",
]


def _to_camel(name: str) -> str:
    first, *rest = name.split("_")
    return first + "".join(part.capitalize() for part in rest)


class ContractModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=_to_camel,
        extra="forbid",
        populate_by_name=True,
    )


class ModelChoice(ContractModel):
    provider: LLMProvider
    model: str


class RoutingPolicy(ContractModel):
    stages: dict[Stage, ModelChoice]
    failover: dict[Stage, list[ModelChoice]] | None = None

    @model_validator(mode="after")
    def require_all_stages(self) -> Self:
        required_stages = {"plan", "code", "review", "judge"}
        if set(self.stages) != required_stages:
            raise ValueError("stages must define plan, code, review, and judge")
        return self


class Message(ContractModel):
    role: Literal["user", "assistant", "system"]
    content: str


class CompletionRequest(ContractModel):
    stage: Stage
    messages: list[Message]
    max_tokens: int | None = None
    temperature: float | None = None
    response_schema: dict[str, object] | None = None


class TokenUsage(ContractModel):
    input: int
    output: int


class LLMCallResult(ContractModel):
    status: Literal["SUCCESS"]
    content: str
    provider: LLMProvider
    model: str
    tokens: TokenUsage
    cost_usd: float


class RouterError(ContractModel):
    status: Literal["FAILED"]
    reason: str
    retriable: bool
    attempts: int
    provider: LLMProvider | None = None


class RepoSpec(ContractModel):
    url: str
    ref: str | None = None
    writable: bool


class AcceptanceCriterion(ContractModel):
    id: str
    description: str
    check: str | None = None


class JudgePolicy(ContractModel):
    family: LLMProvider
    model: str | None = None
    cadence: int = Field(ge=1)
    allow_same_family: bool | None = None
    scoring_method: Literal["pointwise", "pairwise"] | None = None
    max_cost_share: float | None = None
    rubric_packs: list[str] | None = None


class PacingPolicy(ContractModel):
    mode: Literal["auto", "fixed"]
    # F-125: opt-in — derive the pacing context window from the run's own
    # first-step assembled-context tokens instead of a static guess.
    auto_calibrate: bool | None = None


class UnattendedPolicy(ContractModel):
    escalation: Literal["await_approval", "seal_resumable_failed"]


class SoakPolicy(ContractModel):
    sleep_ms: int = Field(gt=0)
    max_reentries: int = Field(gt=0)
    max_total_sleep_ms: int | None = Field(default=None, gt=0)


class NotificationPolicy(ContractModel):
    on: list[Literal["escalate", "milestone", "terminal"]]
    slack_webhook_env: str | None = None


class ExecutorConfig(ContractModel):
    adapter: str
    family: LLMProvider


class RepoHandoff(ContractModel):
    repo_url: str
    source_commit: str
    base_commit: str
    head_commit: str
    changed_paths: list[str]
    bundle_ref: ArtifactRef


class ChainNodeHandoff(ContractModel):
    node_id: str
    run_id: str
    repos: list[RepoHandoff] = Field(min_length=1)


class ChainLink(ContractModel):
    plan_id: str
    node_id: str
    chain_id: str | None = None
    write_set: list[str] | None = None
    parent_run_id: str | None = None
    parent_handoffs: list[ChainNodeHandoff] | None = None
    plan_goal: str | None = None
    plan_outline: list[str] | None = None


class TaskSpec(ContractModel):
    name: str
    goal: str
    repos: list[RepoSpec] = Field(min_length=1)
    acceptance_criteria: list[AcceptanceCriterion] = Field(min_length=1)
    budget_usd: float = Field(gt=0)
    budget_tokens: int | None = Field(default=None, gt=0)
    max_steps: int | None = None
    min_nodes: int | None = Field(default=None, gt=0)
    executor: ExecutorConfig
    judge: JudgePolicy
    routing: RoutingPolicy
    pacing: PacingPolicy | None = None
    unattended: UnattendedPolicy | None = None
    soak: SoakPolicy | None = None
    notifications: NotificationPolicy | None = None
    chain_link: ChainLink | None = None

    @model_validator(mode="after")
    def validate_task(self) -> Self:
        if not any(repo.writable for repo in self.repos):
            raise ValueError("at least one repository must be writable")
        criterion_ids = [criterion.id for criterion in self.acceptance_criteria]
        if len(criterion_ids) != len(set(criterion_ids)):
            raise ValueError("acceptance criterion ids must be unique")
        if self.judge.family == self.executor.family and not self.judge.allow_same_family:
            raise ValueError("judge family must differ from executor family")
        return self


class StepLimits(ContractModel):
    max_seconds: int
    max_turns: int | None = None
    max_cost_usd: float | None = None


class ArtifactRef(ContractModel):
    id: str
    kind: ArtifactKind
    bytes: int
    summary: str = Field(max_length=200)
    # Additive (F-131): resolved workspace repo for multi-repo diff refs (WP-214).
    repo: str | None = None


class ContextBundle(ContractModel):
    goal: str
    acceptance_criteria: list[AcceptanceCriterion]
    plan_item: str
    notes: dict[str, str]
    recent_steps: list[str]
    judge_feedback: str | None = None
    injections: list[str]
    memory_refs: list[ArtifactRef]


class StepInput(ContractModel):
    workspace_dir: str
    instruction: str
    context: ContextBundle
    limits: StepLimits


class StepFailure(ContractModel):
    reason: str
    retriable: bool


class StepRecord(ContractModel):
    status: TerminalStatus
    diff_ref: ArtifactRef
    summary: str
    tool_calls: int
    tokens: TokenUsage
    cost_usd: float
    cost_estimated: bool
    duration_ms: int
    transcript_ref: ArtifactRef
    failure: StepFailure | None = None
    claims_complete: bool | None = None


class TestResultArtifact(ContractModel):
    ref: ArtifactRef
    command: str
    exit_code: int
    passed: int
    failed: int
    duration_ms: int


class JudgeEvidence(ContractModel):
    diff_refs: list[ArtifactRef]
    test_results: TestResultArtifact | None = None
    criteria: list[AcceptanceCriterion]
    criteria_history: dict[str, list[bool]]
    step_summaries: list[str]
    artifacts: list[ArtifactRef]


class JudgeFormResult(ContractModel):
    id: str
    pass_: bool = Field(alias="pass")
    justification: str
    # WP-263(b): the judge-executed check did not complete (infra, not code red).
    infra_failed: bool | None = None


class JudgeForm(ContractModel):
    criterion_results: list[JudgeFormResult]
    rubric_results: list[JudgeFormResult]
    concerns: list[str]


class JudgeVerdict(ContractModel):
    kind: VerdictKind
    form: JudgeForm
    rationale: str
    rollback_to: CheckpointId | None = None
    escalate_reason: str | None = None
    cost_usd: float
    tokens: TokenUsage
    judge_model: ModelChoice

    @model_validator(mode="after")
    def require_conditional_fields(self) -> Self:
        if self.kind == "ROLLBACK" and self.rollback_to is None:
            raise ValueError("rollbackTo is required for ROLLBACK verdicts")
        if self.kind == "ESCALATE" and self.escalate_reason is None:
            raise ValueError("escalateReason is required for ESCALATE verdicts")
        return self


class JournalEntry(ContractModel):
    idx: int
    ts: str
    kind: JournalEntryKind
    payload: object
    cost_delta_usd: float
    tokens: TokenUsage | None = None
    artifact_refs: list[ArtifactRef]


class Checkpoint(ContractModel):
    id: CheckpointId
    journal_idx: int
    git_commits: dict[str, str]
    context_snapshot_ref: ArtifactRef
    budget_spent_usd: float
    last_good: bool


class LastVerdict(ContractModel):
    kind: VerdictKind
    at_step: int


class RunFailure(ContractModel):
    reason: str
    last_checkpoint: CheckpointId


class RunStatusReport(ContractModel):
    status: RunStatus
    current_step: int
    spent_usd: float
    budget_usd: float
    last_verdict: LastVerdict | None = None
    checkpoints: list[Checkpoint]
    failure: RunFailure | None = None


# ── Plans & chains (WP-219, ADR-005) ──────────────────────────────────────────


class PlanNode(ContractModel):
    id: str
    goal: str
    acceptance_criteria: list[AcceptanceCriterion] = Field(min_length=1)
    depends_on: list[str]
    write_set: list[str] | None = None
    budget_usd: float = Field(gt=0)


class Plan(ContractModel):
    id: str
    goal: str
    nodes: list[PlanNode] = Field(min_length=1)
    created_at: str


class PlanVerdict(ContractModel):
    kind: PlanVerdictKind
    rationale: str
    uncovered_criteria: list[str]


class NodeOutcome(ContractModel):
    status: TerminalStatus
    verdict: VerdictKind


class ChainRecord(ContractModel):
    plan_id: str
    plan: Plan
    plan_verdict: PlanVerdict | None = None
    node_runs: dict[str, str]
    node_outcomes: dict[str, NodeOutcome]
    node_handoffs: dict[str, ChainNodeHandoff] | None = None
    status: ChainStatus
