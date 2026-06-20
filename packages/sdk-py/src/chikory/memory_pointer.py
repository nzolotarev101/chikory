"""Pure WP-202 / CM-3 memory pointer helpers for Python parity in WP-201."""

from __future__ import annotations

from dataclasses import dataclass

from .types import ArtifactRef


@dataclass(frozen=True)
class MemoryPointerPolicy:
    """WP-202 / CM-3 / WP-201 policy for inline memory pointer thresholds."""

    max_inline_bytes: int


def should_pointerize(num_bytes: int, policy: MemoryPointerPolicy) -> bool:
    """WP-202 / CM-3 / WP-201 pure predicate for external memory pointer storage."""

    return num_bytes > policy.max_inline_bytes


def format_pointer_reference(ref: ArtifactRef) -> str:
    """WP-202 / CM-3 / WP-201 pure renderer for context-facing pointer references."""

    return f"[memory {ref.kind} {ref.id[:12]}] {ref.bytes}B — {ref.summary}"
