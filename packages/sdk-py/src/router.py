from __future__ import annotations

import httpx
from .types import LLMProvider, RouterConfig, ToolResult


class LLMCallResult:
    def __init__(
        self,
        content: str,
        provider: LLMProvider,
        model: str,
        input_tokens: int,
        output_tokens: int,
        cost: float | None = None,
    ) -> None:
        self.content = content
        self.provider = provider
        self.model = model
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens
        self.cost = cost


class Router:
    def __init__(self, config: RouterConfig) -> None:
        self._config = config

    async def call(
        self,
        messages: list[dict[str, str]],
        provider: LLMProvider | None = None,
        model: str | None = None,
    ) -> LLMCallResult:
        target = provider or self._config.default_provider
        provider_config = self._config.providers.get(target)
        if provider_config is None:
            raise ValueError(f"Provider '{target}' not configured")

        effective_model = model or provider_config.default_model

        match target:
            case "anthropic":
                return await self._call_anthropic(messages, effective_model, provider_config.api_key)
            case "openai":
                return await self._call_openai(messages, effective_model, provider_config.api_key)
            case "gemini":
                return await self._call_gemini(messages, effective_model, provider_config.api_key)
            case _:
                raise ValueError(f"Unknown provider: {target}")

    async def _call_anthropic(self, messages: list[dict[str, str]], model: str, api_key: str) -> LLMCallResult:
        # TODO: implement Anthropic provider
        raise NotImplementedError("Anthropic provider not yet implemented")

    async def _call_openai(self, messages: list[dict[str, str]], model: str, api_key: str) -> LLMCallResult:
        # TODO: implement OpenAI provider
        raise NotImplementedError("OpenAI provider not yet implemented")

    async def _call_gemini(self, messages: list[dict[str, str]], model: str, api_key: str) -> LLMCallResult:
        # TODO: implement Gemini provider
        raise NotImplementedError("Gemini provider not yet implemented")
