export interface LaunchModeMismatch {
  intendedSingleRun: boolean;
  launchedAsChain: boolean;
  warning: string;
}

const SINGLE_RUN_PATTERNS: readonly RegExp[] = [
  /\bnot\s+(?:a\s+)?chain\b/i,
  /\bsingle\s+`?chikory\s+run`?\b/i,
  /\blaunch\s+with\s+`?chikory\s+run`?\b/i,
  /\buse\s+`?chikory\s+run`?\b/i,
];

/**
 * WP-261 launch-mode guard and evaluateSpecStalenessPrecheck analog:
 * detects whether a raw task spec explicitly asks for single-run launch.
 */
export function detectIntendedSingleRun(specText: string): boolean {
  return SINGLE_RUN_PATTERNS.some((pattern) => pattern.test(specText));
}

/**
 * WP-261 launch-mode guard and evaluateSpecStalenessPrecheck analog:
 * reports when a single-run-authored spec was launched as a chain.
 */
export function assessLaunchModeMismatch(input: {
  intendedSingleRun: boolean;
  launchedAsChain: boolean;
}): LaunchModeMismatch | null {
  if (!input.intendedSingleRun || !input.launchedAsChain) {
    return null;
  }

  return {
    intendedSingleRun: input.intendedSingleRun,
    launchedAsChain: input.launchedAsChain,
    warning:
      "[chikory] WARNING: launch mode mismatch: spec asks for single `chikory run`; use `chikory run`, not `chikory chain`",
  };
}
