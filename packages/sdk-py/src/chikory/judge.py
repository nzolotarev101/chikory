from __future__ import annotations

from .types import JudgeEvidence, JudgeVerdict


class Judge:
    async def evaluate(self, evidence: JudgeEvidence) -> JudgeVerdict:
        raise NotImplementedError
