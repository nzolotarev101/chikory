from __future__ import annotations

import json
from pathlib import Path
from typing import TypeAlias

import pytest
from pydantic import BaseModel, ValidationError

from chikory.types import (
    AcceptanceCriterion,
    ArtifactRef,
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
    RepoSpec,
    RouterError,
    RoutingPolicy,
    RunStatusReport,
    StepInput,
    StepLimits,
    StepRecord,
    TaskSpec,
    TokenUsage,
)
from chikory.types import (
    TestResultArtifact as ContractTestResultArtifact,
)

ModelType: TypeAlias = type[BaseModel]
REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURE_DIR = REPO_ROOT / "fixtures" / "contracts"
MODELS: dict[str, ModelType] = {
    model.__name__: model
    for model in (
        AcceptanceCriterion,
        ArtifactRef,
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
        RepoSpec,
        RouterError,
        RoutingPolicy,
        RunStatusReport,
        StepInput,
        StepLimits,
        StepRecord,
        TaskSpec,
        ContractTestResultArtifact,
        TokenUsage,
    )
}
VALID_FIXTURES = sorted(FIXTURE_DIR.glob("*.valid.json"))
INVALID_FIXTURES = sorted(FIXTURE_DIR.glob("*.invalid-*.json"))


def _model_for(path: Path) -> ModelType:
    return MODELS[path.name.split(".", maxsplit=1)[0]]


def _load(path: Path) -> object:
    with path.open(encoding="utf-8") as fixture:
        return json.load(fixture)


@pytest.mark.parametrize("path", VALID_FIXTURES, ids=lambda path: path.name)
def test_valid_contract_fixture_round_trip(path: Path) -> None:
    payload = _load(path)
    model = _model_for(path).model_validate(payload)

    assert model.model_dump(mode="json", by_alias=True, exclude_none=True) == payload


@pytest.mark.parametrize("path", INVALID_FIXTURES, ids=lambda path: path.name)
def test_invalid_contract_fixture_rejected(path: Path) -> None:
    with pytest.raises(ValidationError):
        _model_for(path).model_validate(_load(path))
