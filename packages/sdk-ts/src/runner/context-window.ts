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
  "gpt-5.6-sol xhigh": 400_000,
  "gpt-5.6-sol": 400_000,
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

/**
 * F-125: the target utilization the FIRST observed step should sit at when the
 * pacing window is auto-calibrated — just UNDER the compact band (default 0.8)
 * so step 1 does not fold prematurely, but a step or two of real resident-context
 * growth crosses it. Clamped into (0, 1).
 */
export const DEFAULT_CALIBRATION_TARGET_UTILIZATION = 0.75;
/** F-125: floor so a tiny first step cannot yield an unusably small window. */
export const DEFAULT_CALIBRATION_MIN_WINDOW = 512;

export interface ContextWindowCalibrationOptions {
  targetUtilization?: number;
  minWindow?: number;
}

/**
 * F-125 pure window auto-calibration. A static `CHIKORY_CONTEXT_WINDOW_TOKENS`
 * guess mis-sized the pacing window four distinct ways (dogfood-053 overshoot →
 * 091 undershoot → 092 too-short → 094 too-big), because the right window is a
 * function of the RUN's actual assembled-context tokens, which differ per
 * workload. Given the first step's observed projected resident tokens, return a
 * window sized so that first step sits at `targetUtilization` (just under the
 * compact band) — so real accumulation crosses the band within a step or two and
 * `planCompaction` folds under genuine pacing pressure, while one step's estimate
 * (≈ one summary) stays well below the window (no premature park). Pure and
 * deterministic: it is a function of a single journaled workflow value, so a
 * Temporal replay recomputes the identical window.
 */
export function calibrateContextWindow(
  observedProjectedTokens: number,
  options: ContextWindowCalibrationOptions = {},
): number {
  const target = Math.min(
    Math.max(options.targetUtilization ?? DEFAULT_CALIBRATION_TARGET_UTILIZATION, 0.01),
    0.99,
  );
  const minWindow = Math.max(1, options.minWindow ?? DEFAULT_CALIBRATION_MIN_WINDOW);
  const projected = Math.max(0, observedProjectedTokens);
  return Math.max(minWindow, Math.ceil(projected / target));
}
