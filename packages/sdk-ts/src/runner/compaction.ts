/**
 * Compaction decision (WP-203, ADR-006). Pure — the deterministic core of
 * context-rot mitigation (CM-1/CM-2): given the recall-tier step summaries and
 * a policy, decide which stay verbatim and which fold into a digest. Runs at
 * the checkpoint boundary (activities.ts `writeCheckpoint`) so a resume never
 * rehydrates rotted context. The LLM digest call and the journal/artifact
 * write are the non-pure wiring layered on this.
 */
import type { CompactionPlan, CompactionPolicy } from "../types.js";

/**
 * Split `summaries` (oldest→newest) into the newest `keepLastN` kept verbatim
 * and the older remainder to fold. No compaction (everything kept, nothing
 * folded) until the recall tier exceeds `triggerAfterSteps` AND there is
 * something older than the keep-window — so short runs never pay a digest.
 */
export function planCompaction(
  summaries: readonly string[],
  policy: CompactionPolicy,
): CompactionPlan {
  const keepLastN = Math.max(0, policy.keepLastN);
  if (summaries.length <= policy.triggerAfterSteps || summaries.length <= keepLastN) {
    return { keepVerbatim: [...summaries], toDigest: [] };
  }
  const splitAt = summaries.length - keepLastN;
  return {
    keepVerbatim: summaries.slice(splitAt),
    toDigest: summaries.slice(0, splitAt),
  };
}
