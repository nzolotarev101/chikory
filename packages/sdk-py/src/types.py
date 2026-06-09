from __future__ import annotations

from typing import Literal
from pydantic import BaseModel


LLMProvider = Literal["anthropic", "openai", "gemini"]


class ProviderConfig(BaseModel):
    api_key: str
    default_model: str
    base_url: str | None = None


class RouterConfig(BaseModel):
    providers: dict[LLMProvider, ProviderConfig]
    default_provider: LLMProvider
    retries: int = 3


class JudgeConfig(BaseModel):
    provider: LLMProvider
    model: str
    evaluate_every_n_steps: int = 5
    scoring_method: Literal["pointwise", "pairwise"] = "pointwise"


class AgentRunConfig(BaseModel):
    router: RouterConfig
    judge: JudgeConfig
    max_steps: int | None = None
    budget_usd: float | None = None
    checkpoint_dir: str | None = None


class ToolResult(BaseModel):
    tool_name: str
    output: object
    status: Literal["SUCCESS", "FAILED"]
    error_message: str | None = None


class StepTrace(BaseModel):
    step_index: int
    timestamp: str
    type: Literal["llm_call", "tool_call", "judge_eval", "checkpoint"]
    input_tokens: int | None = None
    output_tokens: int | None = None
    cost: float | None = None
    judge_score: float | None = None
    judge_verdict: Literal["continue", "halt", "rollback", "escalate"] | None = None
