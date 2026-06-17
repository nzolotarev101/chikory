from __future__ import annotations

from collections.abc import Sequence

from .types import Message

"""Pure compaction digest prompt helpers for WP-203 / WP-201 / ADR-006 / CM-1."""

DIGEST_SYSTEM_PROMPT: str = "\n".join(
    [
        "You compact older execution memory for a durable agent run.",
        "",
        "Fold the provided older step summaries into one faithful prose digest that",
        "preserves the decisions made, important file and symbol names, and open",
        "threads a resumed run must remember.",
        "",
        "Rules:",
        "- Preserve the oldest-to-newest progression when it matters for causality.",
        "- Drop redundancy, transient chatter, and repeated restatements.",
        "- Keep concrete implementation facts over verbatim context.",
        "- Mention unresolved questions, failed attempts, and follow-up work still",
        "  relevant to the run.",
        "- Output prose only. Do not return JSON or wrap the digest in a schema.",
        "",
        "The goal is to rehydrate the gist without carrying rotted verbatim context.",
    ]
)
"""Frozen digest system prompt for WP-203 / WP-201 / ADR-006 / CM-1."""


def build_digest_messages(to_digest: Sequence[str]) -> list[Message]:
    """Build pure digest messages for WP-203 / WP-201 / ADR-006 / CM-1."""
    summaries = "\n".join(f"{index + 1}. {summary}" for index, summary in enumerate(to_digest))
    user = "\n".join(
        [
            "## Older step summaries to fold (oldest to newest)",
            summaries,
        ]
    )

    return [
        Message(role="system", content=DIGEST_SYSTEM_PROMPT),
        Message(role="user", content=user),
    ]
