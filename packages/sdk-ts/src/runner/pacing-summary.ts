import type { JournalEntry } from "../types.js";

export interface PacingSummary {
  peakUtilization: number;
  compactRecommended: number;
  parkRecommended: number;
}

/**
 * WP-207 / FA-3 / SE-2 pure reducer for making journaled pacing entries
 * actionable in trace output.
 */
export function summarizePacing(entries: readonly JournalEntry[]): PacingSummary {
  let peakUtilization = 0;
  let compactRecommended = 0;
  let parkRecommended = 0;

  for (const entry of entries) {
    if (entry.kind !== "pacing") continue;
    const payload = entry.payload as { action: string; utilization: number };
    peakUtilization = Math.max(peakUtilization, payload.utilization);
    if (payload.action === "compact") compactRecommended += 1;
    if (payload.action === "park") parkRecommended += 1;
  }

  return { peakUtilization, compactRecommended, parkRecommended };
}
