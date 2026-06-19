from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

EXPECTED_BRANCH_TARGET = "<run-id>@<step|base>"
MAX_SAFE_INTEGER = 9_007_199_254_740_991


@dataclass(frozen=True)
class BranchTarget:
    """WP-205 / WP-201 pure branch target parsed from a run checkpoint selector."""

    run_id: str
    step: int | Literal["base"]
    checkpoint_id: str


def _branch_target_error(value: str, detail: str) -> ValueError:
    return ValueError(
        f"Invalid branch target '{value}': {detail}. Expected {EXPECTED_BRANCH_TARGET}."
    )


def parse_branch_target(value: str) -> BranchTarget:
    """Parse a WP-205 / WP-201 ``<run-id>@<step|base>`` branch target."""

    parts = value.split("@")
    if len(parts) != 2:
        raise _branch_target_error(value, "use exactly one @ separator")

    run_id, raw_step = parts
    if run_id == "":
        raise _branch_target_error(value, "run id must not be empty")

    if raw_step == "":
        raise _branch_target_error(value, "step must not be empty")

    if raw_step == "base":
        return BranchTarget(run_id=run_id, step="base", checkpoint_id=f"{run_id}@base")

    if not re.fullmatch(r"[0-9]+", raw_step):
        raise _branch_target_error(value, "step must be a positive integer or base")

    step = int(raw_step)
    if step <= 0 or step > MAX_SAFE_INTEGER:
        raise _branch_target_error(value, "step must be a positive integer or base")

    return BranchTarget(run_id=run_id, step=step, checkpoint_id=f"{run_id}@{step}")


def branch_name_for_target(target: BranchTarget) -> str:
    """Build the WP-205 / WP-201 default git branch name for a branch target."""

    sanitized_run_id = re.sub(r"[^A-Za-z0-9._-]+", "-", target.run_id).strip("-")
    if sanitized_run_id == "":
        raise _branch_target_error(
            target.checkpoint_id,
            "run id must contain branch-safe characters",
        )

    step_segment = "base" if target.step == "base" else f"step-{target.step}"
    return f"branch-{sanitized_run_id}-{step_segment}"
