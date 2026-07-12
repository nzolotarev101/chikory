/**
 * Limit-pacing governor (WP-310, RT-12). Pure — runs inside the deterministic
 * workflow, the `budget.ts` / `pacing.ts` shape. WP-308 answers "a limit
 * fired — now what?"; this module answers "no limit has fired yet — how fast
 * should we be spending?" against every declared quota window (rolling-5h,
 * weekly) AND the task horizon.
 *
 * Honesty rules: a window with unknown capacity contributes NOTHING (observe,
 * never throttle — the WP-307 do-not-assume-headroom conservatism, inverted:
 * do not assume scarcity either). A deadline is never sacrificed to quota
 * risk silently: `paceConflict` throttles only down to the required pace and
 * is journaled loudly.
 */
import type { DeclaredQuotaWindow } from "../endpoint-capability.js";
import { ESTIMATE_WINDOW } from "./budget.js";

/** Upper bound on one inter-step throttle sleep; a slower crawl than this is
 * worse than handing the step to the WP-308 response path (failover/park). */
export const MAX_THROTTLE_DELAY_MS = 30 * 60 * 1000;

/** Below half the sustainable pace there is headroom to spend aggressively. */
export const PUSH_HEADROOM_FACTOR = 0.5;

const MS_PER_HOUR = 60 * 60 * 1000;

export interface WindowQuotaState {
  readonly window: DeclaredQuotaWindow["window"];
  readonly windowMs: number;
  /** Learned from limit observations (or a debug override); undefined = never hit a limit. */
  readonly capacityTokens?: number;
  /** Ledger consumption inside the current window — ALL runs on this endpoint. */
  readonly consumedTokens: number;
  /** Learned reset (WP-309); absent falls back to `nowMs + windowMs` (worst case). */
  readonly resetAtMs?: number;
}

export interface LimitPacingInput {
  readonly nowMs: number;
  readonly windows: readonly WindowQuotaState[];
  /** Finish-by target from `TaskSpec.horizon`; absent = no deadline pressure. */
  readonly horizonDeadlineMs?: number;
  /** Crude by design: `maxSteps - stepIndex` (smarter estimator is a later knob). */
  readonly estimatedRemainingSteps: number;
  readonly recentStepTokens: readonly number[];
  readonly recentStepDurationsMs: readonly number[];
}

export type LimitPaceAction = "push" | "steady" | "throttle" | "predict-limit";

export interface LimitPacingDecision {
  readonly action: LimitPaceAction;
  /** >0 only for "throttle" — one durable inter-step sleep. */
  readonly interStepDelayMs: number;
  /** The window whose sustainable pace binds (min over known windows). */
  readonly limitingWindow?: DeclaredQuotaWindow["window"];
  /** For "predict-limit": when pace becomes sustainable again (the window reset). */
  readonly predictedResetAtMs?: number;
  readonly observedTokensPerHour: number;
  /** Min sustainable pace over known windows; Infinity when no capacity is known. */
  readonly sustainableTokensPerHour: number;
  /** Pace the horizon demands; 0 without a deadline. */
  readonly requiredTokensPerHour: number;
  /** Deadline demands more than the quota allows — throttle stops at required pace. */
  readonly paceConflict: boolean;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const window = values.slice(-ESTIMATE_WINDOW);
  return window.reduce((a, b) => a + b, 0) / window.length;
}

export function decideLimitPacing(input: LimitPacingInput): LimitPacingDecision {
  const meanStepTokens = mean(input.recentStepTokens);
  const meanStepDurationMs = Math.max(1, mean(input.recentStepDurationsMs));

  const recentTokens = input.recentStepTokens.slice(-ESTIMATE_WINDOW);
  const recentDurations = input.recentStepDurationsMs.slice(-ESTIMATE_WINDOW);
  const totalDurationMs = recentDurations.reduce((a, b) => a + b, 0);
  const observedPerMs =
    totalDurationMs > 0 ? recentTokens.reduce((a, b) => a + b, 0) / totalDurationMs : 0;

  // Sustainable pace = min over windows with KNOWN capacity.
  let sustainablePerMs = Infinity;
  let limitingWindow: DeclaredQuotaWindow["window"] | undefined;
  let limitingResetAtMs: number | undefined;
  let minRemainingTokens = Infinity;
  for (const window of input.windows) {
    if (window.capacityTokens === undefined) continue; // observe, never throttle
    const resetAtMs = window.resetAtMs ?? input.nowMs + window.windowMs;
    const untilResetMs = Math.max(1, resetAtMs - input.nowMs);
    const remainingTokens = Math.max(0, window.capacityTokens - window.consumedTokens);
    const windowPerMs = remainingTokens / untilResetMs;
    if (windowPerMs < sustainablePerMs) {
      sustainablePerMs = windowPerMs;
      limitingWindow = window.window;
      limitingResetAtMs = resetAtMs;
    }
    minRemainingTokens = Math.min(minRemainingTokens, remainingTokens);
  }

  const requiredPerMs =
    input.horizonDeadlineMs !== undefined &&
    input.horizonDeadlineMs > input.nowMs &&
    input.estimatedRemainingSteps > 0
      ? (input.estimatedRemainingSteps * meanStepTokens) / (input.horizonDeadlineMs - input.nowMs)
      : 0;

  const perHour = (perMs: number) => perMs * MS_PER_HOUR;
  const base = {
    observedTokensPerHour: perHour(observedPerMs),
    sustainableTokensPerHour: perHour(sustainablePerMs),
    requiredTokensPerHour: perHour(requiredPerMs),
  };

  // No known constraint, or no burn history yet: spend freely, observe.
  if (limitingWindow === undefined || observedPerMs === 0) {
    return {
      action: "push",
      interStepDelayMs: 0,
      ...(limitingWindow !== undefined ? { limitingWindow } : {}),
      paceConflict: false,
      ...base,
    };
  }

  // The very next step would blow the tightest window: act BEFORE the
  // provider says 429 — hand off to the WP-308 response path.
  if (meanStepTokens > 0 && minRemainingTokens < meanStepTokens) {
    return {
      action: "predict-limit",
      interStepDelayMs: 0,
      limitingWindow,
      predictedResetAtMs: limitingResetAtMs,
      paceConflict: requiredPerMs > sustainablePerMs,
      ...base,
    };
  }

  if (observedPerMs <= sustainablePerMs * PUSH_HEADROOM_FACTOR) {
    return { action: "push", interStepDelayMs: 0, limitingWindow, paceConflict: false, ...base };
  }
  if (observedPerMs <= sustainablePerMs) {
    return { action: "steady", interStepDelayMs: 0, limitingWindow, paceConflict: false, ...base };
  }

  // Over sustainable pace. Throttle toward it — but never below the pace the
  // deadline requires (a silent deadline miss is worse than quota risk).
  const paceConflict = requiredPerMs > sustainablePerMs;
  const targetPerMs = paceConflict ? requiredPerMs : sustainablePerMs;
  const neededDelayMs =
    targetPerMs > 0 ? meanStepTokens / targetPerMs - meanStepDurationMs : Infinity;

  if (neededDelayMs <= 0) {
    // Already at/below the target pace once the deadline floor applies.
    return { action: "steady", interStepDelayMs: 0, limitingWindow, paceConflict, ...base };
  }
  if (neededDelayMs > MAX_THROTTLE_DELAY_MS && !paceConflict) {
    // Even the maximum crawl cannot reach sustainable pace: a park/failover
    // via the WP-308 path beats an endless crawl.
    return {
      action: "predict-limit",
      interStepDelayMs: 0,
      limitingWindow,
      predictedResetAtMs: limitingResetAtMs,
      paceConflict,
      ...base,
    };
  }
  return {
    action: "throttle",
    interStepDelayMs: Math.ceil(Math.min(neededDelayMs, MAX_THROTTLE_DELAY_MS)),
    limitingWindow,
    paceConflict,
    ...base,
  };
}
