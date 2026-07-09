import type { JournalEntry } from "../types.js";

export interface CompactionPressureDescription {
  pressureSteps: number;
  pacingFolds: number;
  unfoldedPressureSteps: number;
}

/**
 * Pure join of context-window pressure decisions and the compaction folds they
 * drove. Both event streams come from the same replay-safe journal.
 */
export function describeCompactionPressure(
  entries: readonly JournalEntry[],
): CompactionPressureDescription {
  let pressureSteps = 0;
  let pacingFolds = 0;

  for (const entry of entries) {
    if (entry.kind === "pacing") {
      const payload = entry.payload as { action?: string };
      if (payload.action === "compact" || payload.action === "park") {
        pressureSteps += 1;
      }
    }

    if (entry.kind === "compaction") {
      const payload = entry.payload as { trigger?: string };
      if (payload.trigger === "pacing") {
        pacingFolds += 1;
      }
    }
  }

  return {
    pressureSteps,
    pacingFolds,
    unfoldedPressureSteps: Math.max(pressureSteps - pacingFolds, 0),
  };
}
