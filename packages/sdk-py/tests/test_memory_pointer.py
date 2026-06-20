from chikory import (
    ArtifactRef,
    MemoryPointerPolicy,
    format_pointer_reference,
    should_pointerize,
)


def test_should_pointerize_above_threshold() -> None:
    policy = MemoryPointerPolicy(max_inline_bytes=1024)

    assert should_pointerize(1025, policy) is True
    assert should_pointerize(2048, policy) is True


def test_should_pointerize_inlines_at_or_below_threshold() -> None:
    policy = MemoryPointerPolicy(max_inline_bytes=1024)

    assert should_pointerize(1024, policy) is False
    assert should_pointerize(0, policy) is False


def test_format_pointer_reference_truncates_id() -> None:
    ref = ArtifactRef(
        id="abcdef0123456789",
        kind="tool_output",
        bytes=2048,
        summary="grep output",
    )

    assert format_pointer_reference(ref) == "[memory tool_output abcdef012345] 2048B — grep output"


def test_format_pointer_reference_keeps_short_id() -> None:
    ref = ArtifactRef(
        id="abc123",
        kind="tool_output",
        bytes=512,
        summary="short output",
    )

    assert format_pointer_reference(ref) == "[memory tool_output abc123] 512B — short output"


def test_format_pointer_reference_interpolates_kind_verbatim() -> None:
    ref = ArtifactRef(
        id="diffabcdef012345",
        kind="diff",
        bytes=99,
        summary="patch",
    )

    assert format_pointer_reference(ref) == "[memory diff diffabcdef01] 99B — patch"
