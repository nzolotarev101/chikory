import type { LimitResponseDecision } from "../limit-response.js";

export interface LimitParkDelayDecision {
  readonly sleepMs: number;
}

export interface LimitParkDelayState {
  readonly nowMs: number;
}

export function decideLimitParkDelay(
  state: LimitParkDelayState,
  response: LimitResponseDecision,
): LimitParkDelayDecision | null {
  if (response.action !== "park-until-reset") return null;

  if (response.retryAfterMs !== undefined) {
    return response.retryAfterMs > 0 ? { sleepMs: response.retryAfterMs } : null;
  }

  if (response.retryAtMs !== undefined) {
    const sleepMs = response.retryAtMs - state.nowMs;
    return sleepMs > 0 ? { sleepMs } : null;
  }

  return null;
}
