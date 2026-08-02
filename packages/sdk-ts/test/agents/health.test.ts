import { describe, expect, it } from "vitest";

import {
  AUTH_COOLDOWN_MS,
  CRASH_COOLDOWN_MS,
  CRASH_ROTATION_THRESHOLD,
  UNKNOWN_LIMIT_COOLDOWN_MS,
  classifyAgentFailure,
  decideMemberRotation,
  type DecideMemberRotationInput,
} from "../../src/agents/health.js";
import { classifyLimitSignal } from "../../src/limit-signal.js";
import { describeEndpointCapability } from "../../src/endpoint-capability.js";
import {
  AGY_QUOTA_WALL,
  ALL_FIXTURES,
  AUTH_FIXTURES,
  LIMIT_FIXTURES,
  ORDINARY_BUILD_FAILURE,
} from "./fixtures/cli-failures.js";

const NOW_MS = Date.parse("2026-08-02T12:00:00.000Z");

describe("classifyAgentFailure", () => {
  it.each(LIMIT_FIXTURES.map((f) => [f.name, f] as const))(
    "reads %s as a limit",
    (_name, fixture) => {
      expect(classifyAgentFailure({ stderr: fixture.stderr, exitCode: fixture.exitCode })).toBe(
        "limit",
      );
    },
  );

  it.each(AUTH_FIXTURES.map((f) => [f.name, f] as const))(
    "reads %s as an auth failure",
    (_name, fixture) => {
      expect(classifyAgentFailure({ stderr: fixture.stderr, exitCode: fixture.exitCode })).toBe(
        "auth",
      );
    },
  );

  it("does NOT read an ordinary build failure as auth or limit", () => {
    // This fixture literally contains the word `unauthorized` (in a TS2551
    // diagnostic) and the path `src/auth/session.ts`. Rotating on it would
    // spend a second subscription reproducing the same compile error.
    expect(
      classifyAgentFailure({
        stderr: ORDINARY_BUILD_FAILURE.stderr,
        exitCode: ORDINARY_BUILD_FAILURE.exitCode,
      }),
    ).toBe("crash");
  });

  it("returns undefined when there is no stderr to go on", () => {
    expect(classifyAgentFailure({ stderr: undefined })).toBeUndefined();
    expect(classifyAgentFailure({ stderr: "   \n " })).toBeUndefined();
  });

  it("agrees with classifyLimitSignal on the one REAL wall in the journals", () => {
    // Provenance guard: this exact string was harvested from a run journal.
    // The two classifiers must not disagree about it — health.ts deferring to
    // "limit" is what keeps a wall off the auth cooldown path.
    expect(AGY_QUOTA_WALL.provenance).toBe("harvested");
    expect(classifyAgentFailure({ stderr: AGY_QUOTA_WALL.stderr })).toBe("limit");

    const classified = classifyLimitSignal({
      capability: describeEndpointCapability("gemini-cli"),
      nowMs: NOW_MS,
      signal: { kind: "cli-stderr", stderr: AGY_QUOTA_WALL.stderr, exitCode: 1 },
    });
    expect(classified?.kind).toBe("limit");
    // 4h6m22s — the compact-duration parse F-234 fixed.
    expect(classified?.retryAfterMs).toBe(((4 * 60 + 6) * 60 + 22) * 1000);
  });

  it("classifies every fixture as exactly one kind", () => {
    for (const fixture of ALL_FIXTURES) {
      const kind = classifyAgentFailure({ stderr: fixture.stderr, exitCode: fixture.exitCode });
      expect(kind, fixture.name).toBeDefined();
    }
  });
});

describe("decideMemberRotation", () => {
  const base: DecideMemberRotationInput = {
    kind: "limit",
    memberId: "gemini-3-6-flash",
    consecutiveFailures: 1,
    rotationsUsed: 0,
    classSize: 3,
    nowMs: NOW_MS,
  };

  it("rotates immediately on a limit, cooling until the reported reset", () => {
    const decision = decideMemberRotation({ ...base, limitRetryAtMs: NOW_MS + 4 * 3_600_000 });
    expect(decision.action).toBe("rotate");
    if (decision.action !== "rotate") return;
    expect(decision.cooldown.reason).toBe("limit");
    expect(decision.cooldown.cooldownUntilMs).toBe(NOW_MS + 4 * 3_600_000);
  });

  it("falls back to a conservative cooldown when the wall names no reset", () => {
    const decision = decideMemberRotation(base);
    expect(decision.action).toBe("rotate");
    if (decision.action !== "rotate") return;
    expect(decision.cooldown.cooldownUntilMs).toBe(NOW_MS + UNKNOWN_LIMIT_COOLDOWN_MS);
  });

  it("rotates immediately on auth — a logout does not clear on retry", () => {
    const decision = decideMemberRotation({ ...base, kind: "auth" });
    expect(decision.action).toBe("rotate");
    if (decision.action !== "rotate") return;
    expect(decision.cooldown.reason).toBe("auth");
    expect(decision.cooldown.cooldownUntilMs).toBe(NOW_MS + AUTH_COOLDOWN_MS);
  });

  it("holds on the FIRST crash and rotates on the second", () => {
    expect(
      decideMemberRotation({ ...base, kind: "crash", consecutiveFailures: 1 }),
    ).toEqual({ action: "stay", reason: "below-crash-threshold" });

    const decision = decideMemberRotation({
      ...base,
      kind: "crash",
      consecutiveFailures: CRASH_ROTATION_THRESHOLD,
    });
    expect(decision.action).toBe("rotate");
    if (decision.action !== "rotate") return;
    expect(decision.cooldown.reason).toBe("crash");
    expect(decision.cooldown.cooldownUntilMs).toBe(NOW_MS + CRASH_COOLDOWN_MS);
  });

  it("never rotates a class of one", () => {
    expect(decideMemberRotation({ ...base, classSize: 1 })).toEqual({
      action: "stay",
      reason: "single-member-class",
    });
  });

  it("caps rotations at classSize - 1 so a doomed task cannot cycle the class forever", () => {
    expect(decideMemberRotation({ ...base, classSize: 3, rotationsUsed: 1 }).action).toBe("rotate");
    expect(decideMemberRotation({ ...base, classSize: 3, rotationsUsed: 2 })).toEqual({
      action: "stay",
      reason: "rotation-budget-exhausted",
    });
  });

  it("checks the budget before the crash threshold", () => {
    // An exhausted budget is the stronger stop: report it, don't mask it as
    // "below threshold" and imply another failure would rotate.
    expect(
      decideMemberRotation({
        ...base,
        kind: "crash",
        consecutiveFailures: 1,
        rotationsUsed: 2,
      }),
    ).toEqual({ action: "stay", reason: "rotation-budget-exhausted" });
  });
});
