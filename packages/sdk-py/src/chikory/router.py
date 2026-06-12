from __future__ import annotations

from .types import CompletionRequest, LLMCallResult, RouterError


class Router:
    async def complete(self, request: CompletionRequest) -> LLMCallResult | RouterError:
        raise NotImplementedError
