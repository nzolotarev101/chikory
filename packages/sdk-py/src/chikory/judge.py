from __future__ import annotations

import warnings
from typing import Literal

from .router import Router
from .types import JudgeConfig, LLMProvider, RouterConfig, StepTrace


class JudgeEvalResult:
    def __init__(
        self,
        verdict: Literal["continue", "halt", "rollback", "escalate"],
        score: float,
        reasoning: str,
        step_index: int,
    ) -> None:
        self.verdict = verdict
        self.score = score
        self.reasoning = reasoning
        self.step_index = step_index


class Judge:
    def __init__(self, config: JudgeConfig, router_config: RouterConfig) -> None:
        if config.provider == router_config.default_provider:
            warnings.warn(
                "[chikory/judge] Judge and executor use the same provider. "
                "Bias mitigation is reduced. Set judge.provider to a different family.",
                stacklevel=2,
            )
        self._config = config
        self._router = Router(router_config)

    async def evaluate(
        self,
        executor_provider: LLMProvider,
        step_traces: list[StepTrace],
        artifacts: dict[str, object] | None = None,
        rubric: str | None = None,
    ) -> JudgeEvalResult:
        # TODO: implement judge evaluation
        # - Build rubric prompt from rubric or default software-native rubric
        # - Call router with judge provider/model (structurally different from executor)
        # - Parse pointwise score (binary/low-precision)
        # - Return verdict
        raise NotImplementedError("Judge evaluation not yet implemented")
