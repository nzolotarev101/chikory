import type { LLMProvider } from "../types.js";
import { createAnthropicAdapter } from "./anthropic.js";
import { createGeminiAdapter } from "./gemini.js";
import { createOpenAIAdapter } from "./openai.js";
import type { AdapterOptions, ProviderAdapter } from "./provider.js";

export * from "./provider.js";
export { createAnthropicAdapter } from "./anthropic.js";
export { createOpenAIAdapter } from "./openai.js";
export { createGeminiAdapter } from "./gemini.js";

/** Construction fails fast (clear missing-env message) — never at call time. */
export function createAdapter(provider: LLMProvider, opts: AdapterOptions = {}): ProviderAdapter {
  switch (provider) {
    case "anthropic":
      return createAnthropicAdapter(opts);
    case "openai":
      return createOpenAIAdapter(opts);
    case "gemini":
      return createGeminiAdapter(opts);
    case "openai-compat":
      throw new Error("openai-compat adapter lands in WP-102");
  }
}
