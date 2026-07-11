import { assessSpecStaleness } from "./spec-staleness.js";

export interface SpecStalenessPrecheckResult {
  targetWpId: string | null;
  warning: string | null;
}

const WP_ID_RE = /\bWP-\d+\b/g;

/**
 * Extracts the first explicit work-package id from the spec GOAL text.
 *
 * WP-260: callers must pass the parsed `spec.goal`, NOT the raw YAML — a real
 * dogfood spec's comment preamble name-drops many WPs (ladder rungs, prior
 * runs, dependencies), so a first-match over the raw text picks the wrong
 * target. The goal names the actual target first.
 *
 * F-126 (dogfood-094): an `F-100/WP-270`-style pair cites friction lineage,
 * not the spec's target — a WP id riding an `F-n/` prefix is skipped, so a
 * goal whose only WP mention is such a concept ref resolves to no target.
 */
export function extractTargetWpId(goalText: string): string | null {
  for (const match of goalText.matchAll(WP_ID_RE)) {
    if (/\bF-\d+\/$/.test(goalText.slice(0, match.index))) continue;
    return match[0];
  }
  return null;
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
