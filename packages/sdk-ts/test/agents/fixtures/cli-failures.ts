/**
 * CLI failure fixtures for the agent-health classifier (WP-572).
 *
 * PROVENANCE IS PART OF THE FIXTURE. F-228 exists because an invented set of
 * quota phrasings all missed the wall a real CLI actually emits, so every entry
 * here declares where it came from:
 *
 *   `harvested`  — copied verbatim out of a run journal in `.chikory/runs`.
 *                  Trustworthy: a real binary really printed this.
 *   `pattern`    — a plausible phrasing NOT observed in this repo's journals.
 *                  Useful for pinning regex behaviour, worthless as evidence
 *                  that the classifier handles the real thing.
 *
 * Only ONE real wall exists in the journals today (the `agy` quota message
 * below, captured twice with different reset times). No logged-out output from
 * any CLI has ever been journaled, so every auth case here is `pattern`. The
 * authoritative auth check is the launcher's preflight probe, which spawns the
 * real binary — not these strings.
 */

export type FixtureProvenance = "harvested" | "pattern";

export interface CliFailureFixture {
  readonly name: string;
  readonly cli: "agy" | "codex" | "claude";
  readonly provenance: FixtureProvenance;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Verbatim from a run journal under `.chikory/runs`: `limit_signal.payload.signal.reason`. */
export const AGY_QUOTA_WALL: CliFailureFixture = {
  name: "agy individual quota reached, 4h reset",
  cli: "agy",
  provenance: "harvested",
  stderr:
    "Error: Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 4h6m22s.",
  exitCode: 1,
};

/** The same wall on a second run. Both captures use the compact `4h5m54s` duration form F-234 fixed. */
export const AGY_QUOTA_WALL_SHORT: CliFailureFixture = {
  name: "agy individual quota reached, minutes-only reset",
  cli: "agy",
  provenance: "harvested",
  stderr:
    "Error: Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 4h5m54s.",
  exitCode: 1,
};

export const CODEX_RATE_LIMIT: CliFailureFixture = {
  name: "codex usage limit",
  cli: "codex",
  provenance: "pattern",
  stderr: "stream error: You've hit your usage limit. Try again in 2h30m.",
  exitCode: 1,
};

export const CLAUDE_RATE_LIMIT: CliFailureFixture = {
  name: "claude 5-hour limit",
  cli: "claude",
  provenance: "pattern",
  stderr: "Claude usage limit reached. Your limit will reset in 45m.",
  exitCode: 1,
};

export const CODEX_LOGGED_OUT: CliFailureFixture = {
  name: "codex not logged in",
  cli: "codex",
  provenance: "pattern",
  stderr: "Error: Not logged in. Please run `codex login` to authenticate.",
  exitCode: 1,
};

export const CLAUDE_LOGGED_OUT: CliFailureFixture = {
  name: "claude invalid credentials",
  cli: "claude",
  provenance: "pattern",
  stderr: "Authentication failed: OAuth token expired. Run `claude login`.",
  exitCode: 1,
};

export const AGY_UNAUTHORIZED: CliFailureFixture = {
  name: "agy unauthorized",
  cli: "agy",
  provenance: "pattern",
  stderr: "request failed: HTTP 401 Unauthorized",
  exitCode: 1,
};

/**
 * The negative that matters: an ordinary task failure. The executor's own build
 * broke. Nothing about the AGENT is unhealthy, so rotating to a peer would just
 * spend a second subscription reproducing the same compile error.
 */
export const ORDINARY_BUILD_FAILURE: CliFailureFixture = {
  name: "workspace tsc error (must NOT read as auth or limit)",
  cli: "codex",
  provenance: "pattern",
  stderr:
    "src/auth/session.ts(42,7): error TS2322: Type 'string' is not assignable to type 'number'.\n" +
    "src/auth/session.ts(58,3): error TS2551: Property 'unauthorized' does not exist on type 'Session'.\n",
  exitCode: 2,
};

export const LIMIT_FIXTURES: readonly CliFailureFixture[] = [
  AGY_QUOTA_WALL,
  AGY_QUOTA_WALL_SHORT,
  CODEX_RATE_LIMIT,
  CLAUDE_RATE_LIMIT,
];

export const AUTH_FIXTURES: readonly CliFailureFixture[] = [
  CODEX_LOGGED_OUT,
  CLAUDE_LOGGED_OUT,
  AGY_UNAUTHORIZED,
];

export const ALL_FIXTURES: readonly CliFailureFixture[] = [
  ...LIMIT_FIXTURES,
  ...AUTH_FIXTURES,
  ORDINARY_BUILD_FAILURE,
];
