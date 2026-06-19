from __future__ import annotations

import pytest

from chikory import BranchTarget, branch_name_for_target, parse_branch_target


def test_parse_numeric_branch_target() -> None:
    target = parse_branch_target("run-205@7")

    assert isinstance(target, BranchTarget)
    assert target.run_id == "run-205"
    assert target.step == 7
    assert target.checkpoint_id == "run-205@7"


def test_parse_base_branch_target() -> None:
    target = parse_branch_target("run-205@base")

    assert target.run_id == "run-205"
    assert target.step == "base"
    assert target.checkpoint_id == "run-205@base"


def test_parse_canonicalizes_numeric_step() -> None:
    target = parse_branch_target("run-205@007")

    assert target.step == 7
    assert target.checkpoint_id == "run-205@7"


@pytest.mark.parametrize(
    "value",
    [
        "run-205",
        "run-205@7@extra",
        "@7",
        "run-205@",
        "run-205@0",
        "run-205@-1",
        "run-205@1.5",
        "run-205@next",
    ],
)
def test_parse_rejects_invalid_branch_targets(value: str) -> None:
    with pytest.raises(ValueError, match="<run-id>@<step\\|base>"):
        parse_branch_target(value)


def test_branch_name_for_numeric_target() -> None:
    assert branch_name_for_target(parse_branch_target("run-205@7")) == "branch-run-205-step-7"


def test_branch_name_for_base_target() -> None:
    assert branch_name_for_target(parse_branch_target("run-205@base")) == "branch-run-205-base"


def test_branch_name_for_canonicalized_numeric_step() -> None:
    assert branch_name_for_target(parse_branch_target("run-205@007")) == "branch-run-205-step-7"


def test_branch_name_sanitizes_run_id() -> None:
    assert (
        branch_name_for_target(parse_branch_target("team/run 205!*@3"))
        == "branch-team-run-205-step-3"
    )


def test_branch_name_rejects_empty_sanitized_run_id() -> None:
    with pytest.raises(ValueError, match="run id must contain branch-safe characters"):
        branch_name_for_target(parse_branch_target("!/@1"))
