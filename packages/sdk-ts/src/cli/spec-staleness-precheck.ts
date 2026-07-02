import { assessSpecStaleness } from "./spec-staleness.js";

export interface SpecStalenessPrecheckResult {
  targetWpId: string | null;
  warning: string | null;
}

const WP_ID_RE = /\bWP-\d+\b/;

/**
 * Extracts the first explicit work-package id from the spec GOAL text.
 *
 * WP-260: callers must pass the parsed `spec.goal`, NOT the raw YAML — a real
 * dogfood spec's comment preamble name-drops many WPs (ladder rungs, prior
 * runs, dependencies), so a first-match over the raw text picks the wrong
 * target. The goal names the actual target first.
 */
export function extractTargetWpId(goalText: string): string | null {
  return WP_ID_RE.exec(goalText)?.[0] ?? null;
}

/**
 * Pure launch precheck: warns only when the target WP is already complete.
 * WP-260: `goalText` is the parsed `spec.goal`, not the raw YAML preamble.
 */
export function evaluateSpecStalenessPrecheck(
  goalText: string,
  planText: string,
): SpecStalenessPrecheckResult {
  const targetWpId = extractTargetWpId(goalText);
  if (targetWpId === null) {
    return { targetWpId: null, warning: null };
  }

  const report = assessSpecStaleness({ targetWpId, planText });
  return {
    targetWpId,
    warning: report.stale ? `[chikory] WARNING: stale spec: ${report.reason}` : null,
  };
}
