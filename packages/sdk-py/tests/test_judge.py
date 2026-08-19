from __future__ import annotations

import pytest

from chikory.judge import Judge
from chikory.types import (
    AcceptanceCriterion,
    ArtifactRef,
    JudgeEvidence,
    JudgeForm,
    JudgeFormResult,
    JudgeVerdict,
    ModelChoice,
    TokenUsage,
)


class DummyJudge(Judge):
    async def evaluate(self, evidence: JudgeEvidence) -> JudgeVerdict:
        # Simple dummy logic: check if any criteria are met, and return a verdict.
        # Just return a hardcoded/mocked JudgeVerdict
        return JudgeVerdict(
            kind="PROCEED",
            form=JudgeForm(
                criterion_results=[
                    JudgeFormResult(
                        id="criterion-1",
                        **{"pass": True},  # Use dict unpacking because pass is a python keyword
                        justification="Looks perfect",
                    )
                ],
                rubric_results=[],
                concerns=[],
            ),
            rationale="All checks pass.",
            cost_usd=0.05,
            tokens=TokenUsage(input=1000, output=200),
            judge_model=ModelChoice(provider="anthropic", model="claude-3-5-sonnet"),
        )


@pytest.mark.anyio
async def test_judge_base_evaluate_raises_not_implemented_error() -> None:
    judge = Judge()
    evidence = JudgeEvidence(
        diff_refs=[],
        test_results=None,
        criteria=[AcceptanceCriterion(id="criterion-1", description="Description")],
        criteria_history={},
        step_summaries=[],
        artifacts=[],
    )
    with pytest.raises(NotImplementedError):
        await judge.evaluate(evidence)


@pytest.mark.anyio
async def test_dummy_judge_evaluate() -> None:
    judge = DummyJudge()
    evidence = JudgeEvidence(
        diff_refs=[ArtifactRef(id="ref-1", kind="diff", bytes=120, summary="Short diff")],
        test_results=None,
        criteria=[AcceptanceCriterion(id="criterion-1", description="Description")],
        criteria_history={"criterion-1": [True]},
        step_summaries=["Step 1 complete"],
        artifacts=[],
    )
    verdict = await judge.evaluate(evidence)
    assert verdict.kind == "PROCEED"
    assert verdict.rationale == "All checks pass."
    assert verdict.cost_usd == 0.05
    assert verdict.tokens.input == 1000
    assert verdict.tokens.output == 200
    assert verdict.judge_model.provider == "anthropic"
    assert verdict.judge_model.model == "claude-3-5-sonnet"
    assert len(verdict.form.criterion_results) == 1
    assert verdict.form.criterion_results[0].id == "criterion-1"
    assert verdict.form.criterion_results[0].pass_ is True
