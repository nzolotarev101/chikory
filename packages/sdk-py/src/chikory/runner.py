from __future__ import annotations

from .types import RunStatusReport, TaskSpec


class AgentRunner:
    async def start(self, spec: TaskSpec) -> RunStatusReport:
        raise NotImplementedError
