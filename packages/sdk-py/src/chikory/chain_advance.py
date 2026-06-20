from __future__ import annotations

from .types import ChainRecord, ChainStatus, NodeOutcome


def derive_chain_status(record: ChainRecord) -> ChainStatus:
    """Derive the WP-219 chain status from sealed node outcomes per ADR-005 S3 D3/D4."""

    outcomes = record.node_outcomes.values()

    if any(outcome.verdict == "ESCALATE" for outcome in outcomes):
        return "AWAITING_PLAN_APPROVAL"

    outcomes = record.node_outcomes.values()
    if any(outcome.status == "FAILED" for outcome in outcomes):
        return "FAILED"

    if all(
        (outcome := record.node_outcomes.get(node.id)) is not None and outcome.status == "SUCCESS"
        for node in record.plan.nodes
    ):
        return "SUCCESS"

    return "RUNNING"


def advance_chain(
    record: ChainRecord,
    node_id: str,
    outcome: NodeOutcome,
) -> ChainRecord:
    """Fold one sealed PlanNode outcome into WP-219 chain state per ADR-005 S3 D3/D4."""

    next_record = record.model_copy(
        update={"node_outcomes": {**record.node_outcomes, node_id: outcome}},
    )

    return next_record.model_copy(update={"status": derive_chain_status(next_record)})
