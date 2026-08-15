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


def test_build_digest_messages_single_huge_string() -> None:
    # Test with a single extremely large string (e.g. 1MB)
    huge_string = "A" * (1024 * 1024)
    messages = build_digest_messages([huge_string])

    assert len(messages) == 2
    assert messages[0] == Message(role="system", content=DIGEST_SYSTEM_PROMPT)
    assert messages[1].role == "user"
    assert "1. " + huge_string in messages[1].content


def test_build_digest_messages_unicode_characters() -> None:
    # Test with non-ASCII and Unicode characters (emojis, accents, different scripts)
    unicode_inputs = ["🌟 Star", "Café", "日本語", "Pythøn"]
    messages = build_digest_messages(unicode_inputs)

    assert len(messages) == 2
    user_content = messages[1].content
    for index, val in enumerate(unicode_inputs):
        assert f"{index + 1}. {val}" in user_content


def test_build_digest_messages_large_number_of_items() -> None:
    # Test with a high volume of items (e.g. 1000 items)
    many_items = [f"Summary item {i}" for i in range(1000)]
    messages = build_digest_messages(many_items)

    assert len(messages) == 2
    user_content = messages[1].content
    # Confirm order and numbering for a subset of boundaries
    assert "1. Summary item 0" in user_content
    assert "500. Summary item 499" in user_content
    assert "1000. Summary item 999" in user_content


def test_build_digest_messages_empty_and_whitespace_only_strings() -> None:
    # Test handling of empty strings and whitespace-only strings
    inputs = ["", "   ", "\n\t", "actual content"]
    messages = build_digest_messages(inputs)

    assert len(messages) == 2
    user_content = messages[1].content
    # Verify that the indexing and content formatting still work correctly
    assert "1. " in user_content
    assert "2.    " in user_content
    assert "3. \n\t" in user_content
    assert "4. actual content" in user_content


def test_build_digest_messages_single_item() -> None:
    # Test with a sequence containing exactly one item
    messages = build_digest_messages(["Single step summary"])

    assert len(messages) == 2
    assert messages[0] == Message(role="system", content=DIGEST_SYSTEM_PROMPT)
    assert messages[1] == Message(
        role="user",
        content="## Older step summaries to fold (oldest to newest)\n1. Single step summary",
    )


def test_build_digest_messages_non_list_sequence() -> None:
    # Test with non-list Sequence implementations like tuple
    tuple_input: tuple[str, ...] = ("First tuple item", "Second tuple item")
    messages = build_digest_messages(tuple_input)

    assert len(messages) == 2
    assert messages[0] == Message(role="system", content=DIGEST_SYSTEM_PROMPT)
    assert "1. First tuple item" in messages[1].content
    assert "2. Second tuple item" in messages[1].content


def test_build_digest_messages_multiline_summaries() -> None:
    # Test summaries containing embedded newline characters
    multiline_input = ["Line 1\nLine 2", "Another summary\nwith multiple\nlines"]
    messages = build_digest_messages(multiline_input)

    assert len(messages) == 2
    user_content = messages[1].content
    assert "1. Line 1\nLine 2" in user_content
    assert "2. Another summary\nwith multiple\nlines" in user_content


def test_build_digest_messages_system_prompt_content() -> None:
    # Verify that the system prompt contains expected compaction rules
    messages = build_digest_messages(["summary"])
    system_content = messages[0].content

    assert "You compact older execution memory for a durable agent run." in system_content
    assert "Output prose only. Do not return JSON or wrap the digest in a schema." in system_content
    assert "The goal is to rehydrate the gist" in system_content
