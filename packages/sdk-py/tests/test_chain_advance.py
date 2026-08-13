from __future__ import annotations

import pytest
from pydantic import ValidationError

from chikory import advance_chain, derive_chain_status
from chikory.types import (
    AcceptanceCriterion,
    ChainRecord,
    ChainStatus,
    NodeOutcome,
    Plan,
    PlanNode,
    PlanVerdict,
)

SUCCESS_OUTCOME = NodeOutcome(status="SUCCESS", verdict="PROCEED")


def _node(
    node_id: str,
    goal: str,
    acceptance_criterion_id: str,
    acceptance_criterion_description: str,
    depends_on: list[str],
) -> PlanNode:
    return PlanNode(
        id=node_id,
        goal=goal,
        acceptance_criteria=[
            AcceptanceCriterion(
                id=acceptance_criterion_id,
                description=acceptance_criterion_description,
            ),
        ],
        depends_on=depends_on,
        budget_usd=1,
    )


def _chain_record(
    node_outcomes: dict[str, NodeOutcome],
    status: ChainStatus = "RUNNING",
) -> ChainRecord:
    return ChainRecord(
        plan_id="plan-219",
        plan=Plan(
            id="plan-219",
            goal="Ship a chained task",
            created_at="2026-06-19T00:00:00.000Z",
            nodes=[
                _node(
                    "N-1",
                    "Complete the first slice",
                    "AC-1",
                    "First slice complete",
                    [],
                ),
                _node(
                    "N-2",
                    "Complete the second slice",
                    "AC-2",
                    "Second slice complete",
                    ["N-1"],
                ),
                _node(
                    "N-3",
                    "Complete the third slice",
                    "AC-3",
                    "Third slice complete",
                    ["N-2"],
                ),
            ],
        ),
        plan_verdict=PlanVerdict(
            kind="PROCEED",
            rationale="The plan is sound.",
            uncovered_criteria=[],
        ),
        node_runs={},
        node_outcomes=node_outcomes,
        status=status,
    )


def test_derive_chain_status_running_when_no_outcomes() -> None:
    assert derive_chain_status(_chain_record({})) == "RUNNING"


def test_derive_chain_status_success_when_every_node_succeeds() -> None:
    record = _chain_record(
        {
            "N-1": SUCCESS_OUTCOME,
            "N-2": SUCCESS_OUTCOME,
            "N-3": SUCCESS_OUTCOME,
        },
    )

    assert derive_chain_status(record) == "SUCCESS"


def test_derive_chain_status_running_when_some_nodes_are_missing() -> None:
    record = _chain_record({"N-1": SUCCESS_OUTCOME})

    assert derive_chain_status(record) == "RUNNING"


def test_derive_chain_status_failed_when_any_node_fails() -> None:
    record = _chain_record(
        {
            "N-1": SUCCESS_OUTCOME,
            "N-2": NodeOutcome(status="FAILED", verdict="HALT"),
            "N-3": SUCCESS_OUTCOME,
        },
    )

    assert derive_chain_status(record) == "FAILED"


def test_derive_chain_status_escalate_outranks_failed() -> None:
    record = _chain_record(
        {
            "N-1": NodeOutcome(status="FAILED", verdict="HALT"),
            "N-2": NodeOutcome(status="FAILED", verdict="ESCALATE"),
        },
    )

    assert derive_chain_status(record) == "AWAITING_PLAN_APPROVAL"


def test_advance_chain_folds_outcome_recomputes_status_and_preserves_input() -> None:
    record = _chain_record({}, "RUNNING")

    advanced = advance_chain(record, "N-1", SUCCESS_OUTCOME)

    assert advanced is not record
    assert advanced.node_outcomes["N-1"] == SUCCESS_OUTCOME
    assert advanced.status == derive_chain_status(advanced)
    assert "N-1" not in record.node_outcomes
    assert record.status == "RUNNING"


def test_derive_chain_status_with_different_verdicts_but_success() -> None:
    # Non-ESCALATE verdicts with SUCCESS status should result in SUCCESS if all nodes are complete.
    record = _chain_record(
        {
            "N-1": NodeOutcome(status="SUCCESS", verdict="PROCEED"),
            "N-2": NodeOutcome(status="SUCCESS", verdict="ROLLBACK"),
            "N-3": NodeOutcome(status="SUCCESS", verdict="BRANCH"),
        },
    )
    assert derive_chain_status(record) == "SUCCESS"


def test_derive_chain_status_with_different_verdicts_but_failed() -> None:
    # Non-ESCALATE verdicts with FAILED status should result in FAILED status.
    for verdict in ["PROCEED", "ROLLBACK", "HALT", "BRANCH"]:
        record = _chain_record(
            {
                "N-1": SUCCESS_OUTCOME,
                "N-2": NodeOutcome(status="FAILED", verdict=verdict),  # type: ignore
                "N-3": SUCCESS_OUTCOME,
            },
        )
        assert derive_chain_status(record) == "FAILED"


def test_derive_chain_status_with_extra_outcomes_not_in_plan() -> None:
    # Extra outcomes in node_outcomes that are not in the plan nodes list.
    # We should ignore extra outcomes for success determination.
    record = _chain_record(
        {
            "N-1": SUCCESS_OUTCOME,
            "N-2": SUCCESS_OUTCOME,
            "N-3": SUCCESS_OUTCOME,
            "N-EXTRA": SUCCESS_OUTCOME,
        }
    )
    assert derive_chain_status(record) == "SUCCESS"

    # If an extra outcome is FAILED, it should still trigger FAILED status.
    record_failed_extra = _chain_record(
        {
            "N-1": SUCCESS_OUTCOME,
            "N-2": SUCCESS_OUTCOME,
            "N-3": SUCCESS_OUTCOME,
            "N-EXTRA": NodeOutcome(status="FAILED", verdict="HALT"),
        }
    )
    assert derive_chain_status(record_failed_extra) == "FAILED"

    # If an extra outcome is ESCALATE, it should still trigger AWAITING_PLAN_APPROVAL.
    record_escalate_extra = _chain_record(
        {
            "N-1": SUCCESS_OUTCOME,
            "N-2": SUCCESS_OUTCOME,
            "N-3": SUCCESS_OUTCOME,
            "N-EXTRA": NodeOutcome(status="SUCCESS", verdict="ESCALATE"),
        }
    )
    assert derive_chain_status(record_escalate_extra) == "AWAITING_PLAN_APPROVAL"


def test_plan_requires_at_least_one_node() -> None:
    # A plan cannot be constructed with empty nodes due to Pydantic min_length=1 validation.
    with pytest.raises(ValidationError):
        Plan(
            id="plan-empty",
            goal="Empty task",
            created_at="2026-06-19T00:00:00.000Z",
            nodes=[],
        )
