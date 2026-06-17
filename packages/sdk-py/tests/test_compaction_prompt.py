from __future__ import annotations

from collections.abc import Sequence

from chikory import DIGEST_SYSTEM_PROMPT, Message, build_digest_messages


def test_build_digest_messages_shape() -> None:
    messages: list[Message] = build_digest_messages(["a", "b"])

    assert len(messages) == 2
    assert messages[0] == Message(role="system", content=DIGEST_SYSTEM_PROMPT)
    assert messages[1].role == "user"


def test_build_digest_messages_preserves_oldest_to_newest_order() -> None:
    messages: list[Message] = build_digest_messages(["oldest", "newest"])
    user_content = messages[1].content

    assert user_content.index("oldest") < user_content.index("newest")
    assert user_content.index("1.") < user_content.index("2.")


def test_build_digest_messages_accepts_empty_input() -> None:
    messages: list[Message] = build_digest_messages([])

    assert messages == [
        Message(role="system", content=DIGEST_SYSTEM_PROMPT),
        Message(
            role="user",
            content="## Older step summaries to fold (oldest to newest)\n",
        ),
    ]


def test_build_digest_messages_does_not_mutate_input_sequence() -> None:
    to_digest: Sequence[str] = ["first", "second"]
    original_items = list(to_digest)
    original_length = len(to_digest)

    build_digest_messages(to_digest)

    assert len(to_digest) == original_length
    assert list(to_digest) == original_items
