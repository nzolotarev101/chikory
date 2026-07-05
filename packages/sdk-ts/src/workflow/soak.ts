/**
 * Pure soak-delay decision. Kept outside the Temporal workflow body so
 * long unattended wall-clock re-entry is opt-in, deterministic, and
 * unit-testable before durable timer wiring.
 */
import type { SoakPolicy } from "../types.js";

export type { SoakPolicy };

export interface SoakState {
  /** Number of soak sleeps already completed by this run. */
  completedReentries: number;
  /** Total milliseconds already slept under the soak policy. */
  totalSleptMs: number;
}

export interface SoakDelayDecision {
  sleepMs: number;
}

export function decideSoakDelay(
  state: SoakState,
  policy?: SoakPolicy,
): SoakDelayDecision | null {
  if (policy === undefined) return null;

  if (
    !Number.isFinite(policy.sleepMs) ||
    !Number.isFinite(policy.maxReentries) ||
    !Number.isFinite(state.completedReentries) ||
    !Number.isFinite(state.totalSleptMs) ||
    (policy.maxTotalSleepMs !== undefined && !Number.isFinite(policy.maxTotalSleepMs))
  ) {
    return null;
  }

  if (policy.sleepMs <= 0 || policy.maxReentries <= 0) return null;
  if (state.completedReentries >= policy.maxReentries) return null;
  if (
    policy.maxTotalSleepMs !== undefined &&
    state.totalSleptMs + policy.sleepMs > policy.maxTotalSleepMs
  ) {
    return null;
  }

  return { sleepMs: policy.sleepMs };
}
