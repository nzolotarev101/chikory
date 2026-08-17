import { blockingConcerns } from "../judge/verdict.js";
import type { JudgeForm } from "../types.js";

/**
 * Accumulates blocking concerns from a judge form into the standingConcerns list.
 *
 * Implements the severity floor (WP-548 / F-219):
 * - Minor concerns (severity: "minor") are below the floor and NEVER accumulate into standingConcerns.
 * - Blocking concerns (severity: "blocking") and unannotated concerns (fail-safe default)
 *   pass the floor and accumulate into standingConcerns.
 * - Identical concerns are deduplicated.
 *
 * Appends in-place to `standingConcerns` and returns it.
 */
export function accumulateStandingConcerns(
  standingConcerns: string[],
  form: JudgeForm,
): string[] {
  for (const concern of blockingConcerns(form)) {
    if (concern && !standingConcerns.includes(concern)) {
      standingConcerns.push(concern);
    }
  }
  return standingConcerns;
}
