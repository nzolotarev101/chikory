/**
 * Static LLM price table (WP-101) — versioned, per router.md.
 *
 * Costs are computed locally from token counts so every `LLMCallResult`
 * carries `costUsd` without a provider round-trip. Open/self-hosted models
 * (openai-compat) default to $0 unless overridden via `RouterOptions.pricing`.
 */
import type { TokenUsage } from "./types.js";

export const PRICING_VERSION = "2026-06-12";

/** USD per 1M tokens. */
export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

/**
 * Keyed by model id. Date-suffixed ids (e.g. `claude-haiku-4-5-20251001`)
 * fall back to their longest matching prefix entry.
 */
export const PRICE_TABLE: Record<string, ModelPricing> = {
  // Anthropic
  "claude-fable-5": { inputPerMTok: 10, outputPerMTok: 50 },
  "claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-7": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-6": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
  // OpenAI
  "gpt-5.5": { inputPerMTok: 1.25, outputPerMTok: 10 },
  "gpt-5.5-mini": { inputPerMTok: 0.25, outputPerMTok: 2 },
  "gpt-5.2": { inputPerMTok: 1.25, outputPerMTok: 10 },
  "gpt-5.2-mini": { inputPerMTok: 0.25, outputPerMTok: 2 },
  // Gemini
  "gemini-3.1-pro-preview": { inputPerMTok: 1.25, outputPerMTok: 10 },
  "gemini-3.1-flash": { inputPerMTok: 0.3, outputPerMTok: 2.5 },
  "gemini-2.5-pro": { inputPerMTok: 1.25, outputPerMTok: 10 },
  "gemini-2.5-flash": { inputPerMTok: 0.3, outputPerMTok: 2.5 },
};

/** Longest-prefix lookup so dated snapshot ids resolve to their family row. */
export function lookupPricing(
  model: string,
  overrides?: Record<string, ModelPricing>,
): ModelPricing | undefined {
  const table = { ...PRICE_TABLE, ...overrides };
  if (table[model]) return table[model];
  let best: { key: string; pricing: ModelPricing } | undefined;
  for (const [key, pricing] of Object.entries(table)) {
    if (model.startsWith(key) && (!best || key.length > best.key.length)) {
      best = { key, pricing };
    }
  }
  return best?.pricing;
}

/** Unknown models cost $0 (open models — override via RouterOptions.pricing). */
export function computeCostUsd(
  model: string,
  tokens: TokenUsage,
  overrides?: Record<string, ModelPricing>,
): number {
  const pricing = lookupPricing(model, overrides);
  if (!pricing) return 0;
  return (tokens.input * pricing.inputPerMTok + tokens.output * pricing.outputPerMTok) / 1_000_000;
}
