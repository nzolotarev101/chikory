import { assessSpecStaleness } from "./spec-staleness.js";

export interface SpecStalenessPrecheckResult {
  targetWpId: string | null;
  warning: string | null;
}

const WP_ID_RE = /\bWP-\d+\b/;

/**
 * Extracts the first explicit work-package id from a raw task spec.
 */
export function extractTargetWpId(specText: string): string | null {
  return WP_ID_RE.exec(specText)?.[0] ?? null;
}

/**
 * Pure launch precheck: warns only when the target WP is already complete.
 */
export function evaluateSpecStalenessPrecheck(
  specText: string,
  planText: string,
): SpecStalenessPrecheckResult {
  const targetWpId = extractTargetWpId(specText);
  if (targetWpId === null) {
    return { targetWpId: null, warning: null };
  }

  const report = assessSpecStaleness({ targetWpId, planText });
  return {
    targetWpId,
    warning: report.stale ? `[chikory] WARNING: stale spec: ${report.reason}` : null,
  };
}
