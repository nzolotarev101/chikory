from __future__ import annotations

import json
from pathlib import Path

import pytest

from chikory import AgentRunner, RunStatusReport, TaskSpec

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURE_DIR = REPO_ROOT / "fixtures" / "contracts"

with (FIXTURE_DIR / "TaskSpec.valid.json").open(encoding="utf-8") as f:
    TASK_SPEC_DATA = json.load(f)

with (FIXTURE_DIR / "RunStatusReport.valid.json").open(encoding="utf-8") as f:
    STATUS_REPORT_DATA = json.load(f)


class MockAgentRunner(AgentRunner):
    async def start(self, spec: TaskSpec) -> RunStatusReport:
        if not isinstance(spec, TaskSpec):
            raise TypeError("Expected TaskSpec")
        return RunStatusReport.model_validate(STATUS_REPORT_DATA)


@pytest.mark.asyncio
async def test_base_agent_runner_raises_not_implemented() -> None:
    runner = AgentRunner()
    spec = TaskSpec.model_validate(TASK_SPEC_DATA)
    with pytest.raises(NotImplementedError):
        await runner.start(spec)


@pytest.mark.asyncio
async def test_mock_agent_runner_success() -> None:
    runner = MockAgentRunner()
    spec = TaskSpec.model_validate(TASK_SPEC_DATA)
    report = await runner.start(spec)
    assert isinstance(report, RunStatusReport)
    assert report.status == "RUNNING"
    assert report.current_step == 5
    assert report.spent_usd == 1.65
