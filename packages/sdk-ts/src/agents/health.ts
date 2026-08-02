/**
 * Agent member health (WP-572) — classify why a CLI agent failed, and decide
 * whether that warrants rotating to a peer in its class.
 *
 * Scope note on trust: this module only ever sees stderr from a step where the
 * adapter's parser reported `parsed.ok === false` (see `executors/step.ts:202`),
 * i.e. the executor produced NO valid turn. That structural gate is what makes
 * pattern matching safe here — a workspace file or a test fixture containing the
 * word "unauthorized" arrives with `parsed.ok === true` and never reaches this
 * code.
 *
 * Honesty about the patterns: the quota regex in `limit-signal.ts` was widened
 * (F-228) only after a REAL `agy` wall — "Individual quota reached. Please
 * upgrade your subscription to increase your limits. Resets in 4h6m22s." —
 * matched none of the invented alternatives. The auth patterns below have NOT
 * been verified against live logged-out output from all three CLIs, because no
 * such output exists in the journals to harvest. They are therefore deliberately
 * broad, and they are NOT the authoritative auth check: the launcher's preflight
 * probe (which actually spawns each binary) is. A missed auth classification
 * degrades to the crash path, which rotates after two consecutive failures
 * anyway — so the failure mode of a bad pattern here is "rotates one step
 * later", not "strands the chain".
 */
import type { MemberCooldown, RotationTrigger } from "./classes.js";

export type AgentFailureKind = "limit" | "auth" | "crash";

/** Mirrors `limit-signal.ts` CLI_LIMIT_RE so a wall is never misread as an auth failure. */
const LIMIT_RE =
  /\b(rate|usage|session|quota)\s+limit\b|\b(limit|quota)\s+(reached|exceeded|exhausted|hit)\b/i;

/**
 * Logged-out / credential-rejected signatures.
 *
 * Every token here must be QUALIFIED. Bare `unauthorized` and bare `401` were
 * the first draft and both are unsafe: a `tsc` diagnostic like
 * `Property 'unauthorized' does not exist on type 'Session'` would have been
 * classified as an auth failure and rotated the run onto a second subscription
 * to reproduce the same compile error. Auth words appear in ordinary code, so
 * they only count alongside transport/credential context.
 */
const AUTH_RE = new RegExp(
  [
    String.raw`\bnot\s+(?:logged\s*in|authenticated|authorized)\b`,
    String.raw`\bplease\s+(?:run\s+)?\S*\s*(?:login|log\s*in|sign\s*in)\b`,
    String.raw`\brun\s+['"\x60]?\w+\s+login\b`,
    // "401 Unauthorized", "HTTP 401", "status: 401" — never a naked 401.
    String.raw`\b401\s+unauthorized\b`,
    String.raw`\b(?:http|status(?:\s*code)?)\s*[:=]?\s*401\b`,
    // "Unauthorized: invalid key" — clause-leading, not a quoted identifier.
    String.raw`\bunauthorized\s*[:,-]\s*\S`,
    String.raw`\bauthentication\s+(?:failed|error|required|expired)\b`,
    String.raw`\bauth(?:entication)?\s+token\s+(?:expired|invalid|missing)\b`,
    String.raw`\b(?:invalid|missing|expired)\s+(?:api\s*key|credentials?|oauth\s+token)\b`,
    String.raw`\b(?:api\s*key|credentials?)\s+(?:not\s+found|missing|invalid|expired|rejected)\b`,
    String.raw`\bsession\s+(?:has\s+)?expired\b`,
    String.raw`\bre-?authenticate\b`,
  ].join("|"),
  "i",
);

export interface ClassifyAgentFailureInput {
  readonly stderr: string | undefined;
  readonly exitCode?: number | null;
}

/**
 * `limit` wins over `auth` — a quota message that says "upgrade your
 * subscription" must not be read as a credential problem, because the two carry
 * completely different cooldowns (a wall clears itself; a logout does not).
 * Returns undefined when there is nothing to go on at all.
 */
export function classifyAgentFailure(
  input: ClassifyAgentFailureInput,
): AgentFailureKind | undefined {
  const stderr = input.stderr?.trim();
  if (stderr === undefined || stderr.length === 0) return undefined;
  if (LIMIT_RE.test(stderr)) return "limit";
  if (AUTH_RE.test(stderr)) return "auth";
  return "crash";
}

/**
 * Two consecutive failures on one member before rotating. One is noise — a
 * flaky network, a transient provider blip. Rotating on the first would re-spend
 * a whole class on work that would fail everywhere.
 */
export const CRASH_ROTATION_THRESHOLD = 2;

/** A crashing member is benched, not banished — a long chain may need it later. */
export const CRASH_COOLDOWN_MS = 30 * 60_000;

/** A logout does not heal on a timer; the preflight probe clears this early on re-login. */
export const AUTH_COOLDOWN_MS = 60 * 60_000;

/** Used when a wall reports no reset time and none has been learned yet. */
export const UNKNOWN_LIMIT_COOLDOWN_MS = 60 * 60_000;

export interface DecideMemberRotationInput {
  readonly kind: AgentFailureKind;
  readonly memberId: string;
  /** Consecutive non-infra failures on THIS member. Infra kills are excluded upstream. */
  readonly consecutiveFailures: number;
  /** Rotations already spent in this node. */
  readonly rotationsUsed: number;
  /** Members in the class, including the primary. */
  readonly classSize: number;
  readonly nowMs: number;
  /** Learned/reported reset for a limit, when known. */
  readonly limitRetryAtMs?: number;
}

export type MemberRotationDecision =
  | { readonly action: "rotate"; readonly cooldown: MemberCooldown }
  | {
      readonly action: "stay";
      readonly reason:
        | "single-member-class"
        | "rotation-budget-exhausted"
        | "below-crash-threshold";
    };

function cooldownUntil(input: DecideMemberRotationInput): number {
  switch (input.kind) {
    case "limit":
      return input.limitRetryAtMs ?? input.nowMs + UNKNOWN_LIMIT_COOLDOWN_MS;
    case "auth":
      return input.nowMs + AUTH_COOLDOWN_MS;
    case "crash":
      return input.nowMs + CRASH_COOLDOWN_MS;
  }
}

/**
 * Rotation is capped at `classSize - 1` per node so a task that fails everywhere
 * burns the class once and then stops, instead of cycling forever. A rotation
 * deliberately does NOT reset the heal/strike budget — the F-209/F-210 lesson is
 * that a retry which spends no strike becomes an unbounded loop.
 */
export function decideMemberRotation(
  input: DecideMemberRotationInput,
): MemberRotationDecision {
  if (input.classSize <= 1) return { action: "stay", reason: "single-member-class" };
  if (input.rotationsUsed >= input.classSize - 1) {
    return { action: "stay", reason: "rotation-budget-exhausted" };
  }
  if (input.kind === "crash" && input.consecutiveFailures < CRASH_ROTATION_THRESHOLD) {
    return { action: "stay", reason: "below-crash-threshold" };
  }

  const reason: RotationTrigger = input.kind;
  return {
    action: "rotate",
    cooldown: {
      memberId: input.memberId,
      reason,
      observedAtMs: input.nowMs,
      cooldownUntilMs: cooldownUntil(input),
    },
  };
}
