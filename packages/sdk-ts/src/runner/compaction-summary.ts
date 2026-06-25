import type { JournalEntry } from "../types.js";

export interface CompactionSummary {
  folds: number;
  pacingFolds: number;
}

/**
 * WP-203 / WP-207 / FA-3 / SE-2 pure reducer for surfacing actionable
 * compaction trigger counts in trace output.
 */
export function summarizeCompaction(entries: readonly JournalEntry[]): CompactionSummary {
  let folds = 0;
  let pacingFolds = 0;

  for (const entry of entries) {
    if (entry.kind !== "compaction") continue;
    const payload = entry.payload as { digestRef?: unknown; trigger?: string };
    if (payload.digestRef === undefined) continue;
    folds += 1;
    if (payload.trigger === "pacing") pacingFolds += 1;
  }

  return { folds, pacingFolds };
}
