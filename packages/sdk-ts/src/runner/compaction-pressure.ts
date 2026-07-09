import type { JournalEntry } from "../types.js";

export interface CompactionPressureDescription {
  pressureSteps: number;
  pacingFolds: number;
  unfoldedPressureSteps: number;
  firstPacingFoldStep: number | null;
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
  let firstPacingFoldStep: number | null = null;
  let latestPressureStep: number | null = null;

  for (const entry of entries) {
    if (entry.kind === "pacing") {
      const payload = entry.payload as { action?: string; atStep?: unknown };
      if (payload.action === "compact" || payload.action === "park") {
        pressureSteps += 1;
        if (typeof payload.atStep === "number") latestPressureStep = payload.atStep;
      }
    }

    if (entry.kind === "compaction") {
      const payload = entry.payload as { stepIndex?: unknown; trigger?: string };
      if (payload.trigger === "pacing") {
        pacingFolds += 1;
        if (firstPacingFoldStep === null) {
          if (typeof payload.stepIndex === "number") {
            firstPacingFoldStep = payload.stepIndex;
          } else {
            firstPacingFoldStep = latestPressureStep;
          }
        }
      }
    }
  }

  return {
    pressureSteps,
    pacingFolds,
    unfoldedPressureSteps: Math.max(pressureSteps - pacingFolds, 0),
    firstPacingFoldStep,
  };
}

export function pressureFoldGapWarning(
  description: CompactionPressureDescription,
): string | null {
  if (description.pressureSteps > 0 && description.pacingFolds === 0) {
    return `pressure fired for ${description.pressureSteps} step(s), but no pacing folds were recorded`;
  }

  return null;
}
