from __future__ import annotations

import pytest

from chikory import Router
from chikory.types import (
    CompletionRequest,
    LLMCallResult,
    Message,
    RouterError,
    TokenUsage,
)


class DummyRouter(Router):
    async def complete(self, request: CompletionRequest) -> LLMCallResult | RouterError:
        if any(msg.content == "fail" for msg in request.messages):
            return RouterError(
                status="FAILED",
                reason="Simulated router error",
                retriable=True,
                attempts=1,
                provider="anthropic",
            )
        return LLMCallResult(
            status="SUCCESS",
            content="Hello world",
            provider="anthropic",
            model="claude-3-5-sonnet",
            tokens=TokenUsage(input=10, output=15),
            cost_usd=0.0001,
        )


@pytest.mark.anyio
async def test_base_router_raises_not_implemented() -> None:
    router = Router()
    request = CompletionRequest(
        stage="code",
        messages=[Message(role="user", content="hello")],
    )
    with pytest.raises(NotImplementedError):
        await router.complete(request)


@pytest.mark.anyio
async def test_subclass_router_success() -> None:
    router = DummyRouter()
    request = CompletionRequest(
        stage="code",
        messages=[Message(role="user", content="hello")],
    )
    result = await router.complete(request)

    assert isinstance(result, LLMCallResult)
    assert result.status == "SUCCESS"
    assert result.content == "Hello world"
    assert result.provider == "anthropic"
    assert result.model == "claude-3-5-sonnet"
    assert result.tokens.input == 10
    assert result.tokens.output == 15
    assert result.cost_usd == 0.0001


@pytest.mark.anyio
async def test_subclass_router_error() -> None:
    router = DummyRouter()
    request = CompletionRequest(
        stage="code",
        messages=[Message(role="user", content="fail")],
    )
    result = await router.complete(request)

    assert isinstance(result, RouterError)
    assert result.status == "FAILED"
    assert result.reason == "Simulated router error"
    assert result.retriable is True
    assert result.attempts == 1
    assert result.provider == "anthropic"
