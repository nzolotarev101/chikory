/**
 * Budget gate math (WP-124, CG-2). Pure — runs inside the deterministic
 * workflow. Pre-step check uses a conservative estimate: rolling mean of the
 * last 5 step costs × 1.5 (durable-runner.md §Budget gate).
 */

export const ESTIMATE_WINDOW = 5;
export const ESTIMATE_SAFETY_FACTOR = 1.5;

export function estimateNextStepCost(stepCosts: readonly number[]): number {
  if (stepCosts.length === 0) return 0;
  const window = stepCosts.slice(-ESTIMATE_WINDOW);
  const mean = window.reduce((a, b) => a + b, 0) / window.length;
  return mean * ESTIMATE_SAFETY_FACTOR;
}

/** Breach → HALT(BUDGET) with a resumable checkpoint. */
export function budgetBreached(spentUsd: number, budgetUsd: number, estimate: number): boolean {
  const remaining = budgetUsd - spentUsd;
  return remaining <= 0 || remaining < estimate;
}
