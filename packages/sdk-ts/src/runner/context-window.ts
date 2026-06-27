import type { TaskSpec } from "../types.js";

/** Context-window tokens. */
export const CONTEXT_WINDOW_TABLE: Record<string, number> = {
  // Anthropic
  "claude-fable-5": 200_000,
  "claude-opus-4-8": 200_000,
  "claude-opus-4-7": 200_000,
  "claude-opus-4-6": 200_000,
  "claude-sonnet-4-6": 200_000,
  "claude-haiku-4-5": 200_000,
  // OpenAI
  "gpt-5.5": 400_000,
  "gpt-5.5-mini": 400_000,
  "gpt-5.2": 400_000,
  "gpt-5.2-mini": 400_000,
  // Gemini
  "gemini-3.1-pro-preview": 1_000_000,
  "gemini-3.1-flash": 1_000_000,
  "gemini-2.5-pro": 1_000_000,
  "gemini-2.5-flash": 1_000_000,
};

/**
 * WP-252 longest-prefix lookup so dated snapshot ids resolve to their family row.
 */
export function lookupContextWindow(model: string, fallback = 200_000): number {
  if (CONTEXT_WINDOW_TABLE[model]) return CONTEXT_WINDOW_TABLE[model];
  let best: { key: string; contextWindow: number } | undefined;
  for (const [key, contextWindow] of Object.entries(CONTEXT_WINDOW_TABLE)) {
    if (model.startsWith(key) && (!best || key.length > best.key.length)) {
      best = { key, contextWindow };
    }
  }
  return best?.contextWindow ?? fallback;
}

export function resolveContextWindowForSpec(spec: TaskSpec, fallback: number): number {
  const model = spec.routing.stages.code?.model;
  if (model === undefined || model.length === 0) return fallback;
  return lookupContextWindow(model, fallback);
}
