from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Protocol
from .types import AgentRunConfig, StepTrace, ToolResult
from .router import Router
from .judge import Judge


class AgentStep(Protocol):
    async def execute(self) -> list[ToolResult]: ...


RunStatus = Literal["SUCCESS", "FAILED", "HALTED_BY_JUDGE", "BUDGET_EXCEEDED"]


class RunResult:
    def __init__(
        self,
        status: RunStatus,
        step_traces: list[StepTrace],
        total_cost_usd: float,
        checkpoint_path: str | None = None,
    ) -> None:
        self.status = status
        self.step_traces = step_traces
        self.total_cost_usd = total_cost_usd
        self.checkpoint_path = checkpoint_path


class AgentRunner:
    def __init__(self, config: AgentRunConfig) -> None:
        self._config = config
        self._router = Router(config.router)
        self._judge = Judge(config.judge, config.router)
        self._step_traces: list[StepTrace] = []
        self._total_cost_usd = 0.0

    async def run(self, steps: list[AgentStep]) -> RunResult:
        judge_interval = self._config.judge.evaluate_every_n_steps

        for i, step in enumerate(steps):
            if self._config.budget_usd is not None and self._total_cost_usd >= self._config.budget_usd:
                return self._build_result("BUDGET_EXCEEDED")

            tool_results = await step.execute()
            self._record_step(i, tool_results)

            # Terminal FAILED state breaks infinite retry loops
            if any(r.status == "FAILED" for r in tool_results):
                return self._build_result("FAILED")

            if (i + 1) % judge_interval == 0:
                eval_result = await self._judge.evaluate(
                    executor_provider=self._config.router.default_provider,
                    step_traces=self._step_traces,
                )
                if eval_result.verdict in ("halt", "rollback"):
                    return self._build_result("HALTED_BY_JUDGE")

        return self._build_result("SUCCESS")

    def _record_step(self, index: int, tool_results: list[ToolResult]) -> None:
        self._step_traces.append(
            StepTrace(
                step_index=index,
                timestamp=datetime.now(timezone.utc).isoformat(),
                type="tool_call",
            )
        )

    def _build_result(self, status: RunStatus) -> RunResult:
        return RunResult(
            status=status,
            step_traces=self._step_traces,
            total_cost_usd=self._total_cost_usd,
        )
