/**
 * WP-228 / dogfood-017 F-25 acceptance check result collected from a clean
 * baseline precheck.
 */
export interface PrecheckCheckResult {
  id: string;
  exitCode: number;
}

/**
 * WP-228 / dogfood-017 F-25 deterministic baseline precheck verdict for launch
 * redundancy decisions.
 */
export interface BaselinePrecheckResult {
  satisfied: boolean;
  passedIds: string[];
  failedIds: string[];
  summary: string;
}

/**
 * Evaluates the pure WP-228 / dogfood-017 F-25 launch baseline precheck
 * decision from already-collected acceptance check exit codes.
 */
export function evaluateBaselinePrecheck(
  results: readonly PrecheckCheckResult[],
): BaselinePrecheckResult {
  const passedIds: string[] = [];
  const failedIds: string[] = [];

  for (const result of results) {
    if (result.exitCode === 0) {
      passedIds.push(result.id);
    } else {
      failedIds.push(result.id);
    }
  }

  const satisfied = results.length > 0 && failedIds.length === 0;
  const summary =
    results.length === 0
      ? "no acceptance checks to precheck"
      : satisfied
        ? `baseline already satisfies all ${results.length} acceptance checks — the goal may already be done`
        : `${passedIds.length}/${results.length} acceptance checks already pass; ${failedIds.length} still failing`;

  return {
    satisfied,
    passedIds,
    failedIds,
    summary,
  };
}
