import type { LLMProvider, RouterConfig, Message, LLMCallResult } from "./types.js";

export class Router {
  constructor(private readonly config: RouterConfig) {}

  async call(
    messages: Message[],
    provider?: LLMProvider,
    model?: string,
  ): Promise<LLMCallResult> {
    const target = provider ?? this.config.defaultProvider;
    const providerConfig = this.config.providers[target];
    if (!providerConfig) {
      throw new Error(`Provider '${target}' not configured`);
    }

    const effectiveModel = model ?? providerConfig.defaultModel;

    switch (target) {
      case "anthropic":
        return this._callAnthropic(messages, effectiveModel, providerConfig.apiKey);
      case "openai":
        return this._callOpenAI(messages, effectiveModel, providerConfig.apiKey);
      case "gemini":
        return this._callGemini(messages, effectiveModel, providerConfig.apiKey);
      default:
        throw new Error(`Unknown provider: ${target}`);
    }
  }

  private async _callAnthropic(
    messages: Message[],
    model: string,
    apiKey: string,
  ): Promise<LLMCallResult> {
    // TODO: implement Anthropic provider
    throw new Error("Anthropic provider not yet implemented");
  }

  private async _callOpenAI(
    messages: Message[],
    model: string,
    apiKey: string,
  ): Promise<LLMCallResult> {
    // TODO: implement OpenAI provider
    throw new Error("OpenAI provider not yet implemented");
  }

  private async _callGemini(
    messages: Message[],
    model: string,
    apiKey: string,
  ): Promise<LLMCallResult> {
    // TODO: implement Gemini provider
    throw new Error("Gemini provider not yet implemented");
  }
}
