import type { LimitResponseDecision } from "../limit-response.js";

export type LimitParkDelayDecision =
  | { readonly action: "sleep"; readonly sleepMs: number }
  | { readonly action: "seal_resumable_failed"; readonly reason: string };

export interface LimitParkDelayState {
  readonly nowMs: number;
  /**
   * F-249 (WP-581): the wall-clock instant past which sleeping is pointless
   * because nothing will be awake to resume — `spec.horizon.deadlineMs`.
   * Absent = no deadline, park for as long as the reset says.
   */
  readonly deadlineMs?: number;
}

/**
 * How long to park on a quota wall — or whether to park at all.
 *
 * F-249 (WP-581): a park used to be unbounded. p3-rung-4's `brownfield-005`
 * read a Gemini reset 19h49m out and went to sleep inside a 4h harness cap; it
 * was SIGKILLed 4 hours later having never woken, leaving the workflow Running
 * and its genuinely-passing work unsealed. `brownfield-002` slept 6h36m the
 * same way. A sleep that provably outlives its own run is not durability, it is
 * a hang: seal FAILED-resumable at the last checkpoint instead, which
 * `chikory resume` recovers in seconds once quota returns.
 */
export function decideLimitParkDelay(
  state: LimitParkDelayState,
  response: LimitResponseDecision,
): LimitParkDelayDecision | null {
  if (response.action !== "park-until-reset") return null;

  const sleepMs =
    response.retryAfterMs !== undefined
      ? response.retryAfterMs
      : response.retryAtMs !== undefined
        ? response.retryAtMs - state.nowMs
        : undefined;

  if (sleepMs === undefined || sleepMs <= 0) return null;

  if (state.deadlineMs !== undefined && state.nowMs + sleepMs > state.deadlineMs) {
    const wakeAt = new Date(state.nowMs + sleepMs).toISOString();
    const deadline = new Date(state.deadlineMs).toISOString();
    return {
      action: "seal_resumable_failed",
      reason:
        `quota reset at ${wakeAt} is past this run's deadline (${deadline}) — ` +
        `parking ${Math.round(sleepMs / 60_000)}m would outlive the run. ` +
        "Sealed at the last checkpoint; resume once the quota window rolls over.",
    };
  }

  return { action: "sleep", sleepMs };
}
