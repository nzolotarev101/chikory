import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  decideLimitPacing,
  EndpointLedger,
  endpointLedgerPath,
  ROLLING_5H_WINDOW_MS,
  WEEKLY_WINDOW_MS,
} from "../../src/index.js";
import type { DeclaredQuotaWindow, RotationTrigger } from "../../src/index.js";

const WEEKLY: DeclaredQuotaWindow = { window: "weekly", durationMs: WEEKLY_WINDOW_MS };
const ROLLING_5H: DeclaredQuotaWindow = { window: "rolling-5h", durationMs: ROLLING_5H_WINDOW_MS };

const NOW = Date.parse("2026-07-12T00:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function consume(overrides: Partial<Parameters<EndpointLedger["appendConsumption"]>[0]> = {}) {
  return {
    endpointTarget: "codex",
    family: "openai",
    runId: "run-a",
    stepIndex: 0,
    tsMs: NOW - 1000,
    tokensIn: 700,
    tokensOut: 300,
    costUsd: 0,
    ...overrides,
  };
}

describe("EndpointLedger (WP-310)", () => {
  let dir: string;
  let ledger: EndpointLedger;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "chikory-endpoint-ledger-"));
    ledger = new EndpointLedger(endpointLedgerPath(dir));
  });
  afterEach(() => {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("appendConsumption is idempotent per (runId, stepIndex)", () => {
    ledger.appendConsumption(consume());
    ledger.appendConsumption(consume({ tokensIn: 999_999 })); // retried activity, same key
    const state = ledger.windowState("codex", WEEKLY, NOW);
    expect(state.consumedTokens).toBe(1000);
  });

  it("windowState sums across runs on the same endpoint", () => {
    ledger.appendConsumption(consume({ runId: "run-a", stepIndex: 0 }));
    ledger.appendConsumption(consume({ runId: "run-a", stepIndex: 1 }));
    ledger.appendConsumption(consume({ runId: "run-b", stepIndex: 0 }));
    const state = ledger.windowState("codex", WEEKLY, NOW);
    expect(state.consumedTokens).toBe(3000);
  });

  it("windowState excludes consumption outside the trailing window and other endpoints", () => {
    ledger.appendConsumption(consume({ stepIndex: 0, tsMs: NOW - ROLLING_5H_WINDOW_MS - 1 }));
    ledger.appendConsumption(consume({ stepIndex: 1, tsMs: NOW - 1000 }));
    ledger.appendConsumption(consume({ endpointTarget: "claude-code", runId: "run-c", stepIndex: 0 }));
    const state = ledger.windowState("codex", ROLLING_5H, NOW);
    expect(state.consumedTokens).toBe(1000);
    // the older row still counts inside the wider weekly window
    expect(ledger.windowState("codex", WEEKLY, NOW).consumedTokens).toBe(2000);
  });

  it("capacity and reset stay unknown until a limit observation exists", () => {
    ledger.appendConsumption(consume());
    const state = ledger.windowState("codex", WEEKLY, NOW);
    expect(state.capacityTokens).toBeUndefined();
    expect(state.resetAtMs).toBeUndefined();
  });

  it("windowState returns the latest learned capacity and a future reset", () => {
    ledger.appendLimitObservation({
      endpointTarget: "codex",
      windowKind: "weekly",
      observedAtMs: NOW - 5000,
      resetAtMs: NOW + 60_000,
      consumedTokensAtHit: 50_000,
    });
    ledger.appendLimitObservation({
      endpointTarget: "codex",
      windowKind: "weekly",
      observedAtMs: NOW - 1000,
      resetAtMs: NOW + 120_000,
      consumedTokensAtHit: 52_000,
    });
    const state = ledger.windowState("codex", WEEKLY, NOW);
    expect(state.capacityTokens).toBe(52_000);
    expect(state.resetAtMs).toBe(NOW + 120_000);
  });

  it("a stale (past) observation is dropped entirely", () => {
    ledger.appendLimitObservation({
      endpointTarget: "codex",
      windowKind: "rolling-5h",
      observedAtMs: NOW - 10_000,
      resetAtMs: NOW - 1,
      consumedTokensAtHit: 40_000,
    });
    const state = ledger.windowState("codex", ROLLING_5H, NOW);
    expect(state.capacityTokens).toBeUndefined();
    expect(state.resetAtMs).toBeUndefined();
  });

  it("a stale observation with no reset ever learned is dropped once a full window has elapsed", () => {
    // Some raw provider limit signals carry no decodable reset hint at all
    // (resetAtMs omitted). Fallback: a full window.durationMs since the
    // observation is the same "this ceiling can no longer be trusted" signal.
    ledger.appendLimitObservation({
      endpointTarget: "codex",
      windowKind: "rolling-5h",
      observedAtMs: NOW - ROLLING_5H_WINDOW_MS - 1,
      consumedTokensAtHit: 40_000,
    });
    const state = ledger.windowState("codex", ROLLING_5H, NOW);
    expect(state.capacityTokens).toBeUndefined();
    expect(state.resetAtMs).toBeUndefined();
  });

  it("an observation with no reset ever learned still reports capacity before a full window elapses", () => {
    // Regression guard on the fallback boundary — must not fire early.
    ledger.appendLimitObservation({
      endpointTarget: "codex",
      windowKind: "rolling-5h",
      observedAtMs: NOW - ROLLING_5H_WINDOW_MS + 1,
      consumedTokensAtHit: 40_000,
    });
    const state = ledger.windowState("codex", ROLLING_5H, NOW);
    expect(state.capacityTokens).toBe(40_000);
  });

  it("proves the WP-577/F-245 incident property: a passed reset no longer parks future pacing", () => {
    // Real Gemini CLI quota-wall numbers (rolling-5h wall hit, learned
    // capacityTokens:0, reset from the CLI's own "resets in 57m44s" text).
    // Checked 4 minutes AFTER that learned reset had already passed — this
    // is the exact read that self-parked pacing for another full window,
    // twice, for 9.8h, before this fix.
    const HIT_AT = Date.parse("2026-08-02T17:19:00.000Z");
    const LEARNED_RESET_AT = Date.parse("2026-08-02T18:16:00.000Z");
    const CHECKED_AT = Date.parse("2026-08-02T18:20:00.000Z"); // 4 min after reset

    ledger.appendLimitObservation({
      endpointTarget: "gemini-cli",
      windowKind: "rolling-5h",
      observedAtMs: HIT_AT,
      resetAtMs: LEARNED_RESET_AT,
      consumedTokensAtHit: 0,
    });

    const state = ledger.windowState("gemini-cli", ROLLING_5H, CHECKED_AT);
    expect(state.capacityTokens).toBeUndefined();
    expect(state.resetAtMs).toBeUndefined();

    // The property that actually matters: with capacity unknown, pacing
    // must NOT throttle (limit-pacing.ts:89's "observe, never throttle"
    // honesty rule). Before this fix capacityTokens stayed 0 forever and
    // this would have asserted "throttle".
    const pace = decideLimitPacing({
      nowMs: CHECKED_AT,
      windows: [state],
      estimatedRemainingSteps: 10,
      recentStepTokens: [1000, 1000, 1000, 1000, 1000],
      recentStepDurationsMs: [60_000, 60_000, 60_000, 60_000, 60_000],
    });
    expect(pace.action).toBe("push");
    expect(pace.sustainableTokensPerHour).toBe(Infinity);
  });

  it("a fresh ledger on the same database reads the persisted learned capacity", () => {
    ledger.appendLimitObservation({
      endpointTarget: "codex",
      windowKind: "weekly",
      observedAtMs: NOW - 1000,
      consumedTokensAtHit: 52_000,
    });

    const freshLedger = new EndpointLedger(endpointLedgerPath(dir));
    try {
      expect(freshLedger.windowState("codex", WEEKLY, NOW).capacityTokens).toBe(52_000);
    } finally {
      freshLedger.close();
    }
  });

  it("feeds only learned capacity into pacing and stays observe-only before learning", () => {
    const withoutObservation = decideLimitPacing({
      nowMs: NOW,
      windows: [ledger.windowState("codex", WEEKLY, NOW)],
      estimatedRemainingSteps: 10,
      recentStepTokens: [1000, 1000, 1000, 1000, 1000],
      recentStepDurationsMs: [60_000, 60_000, 60_000, 60_000, 60_000],
    });
    expect(withoutObservation.action).toBe("push");
    expect(withoutObservation.sustainableTokensPerHour).toBe(Infinity);

    ledger.appendLimitObservation({
      endpointTarget: "codex",
      windowKind: "weekly",
      observedAtMs: NOW - 1000,
      resetAtMs: NOW + 10 * HOUR,
      consumedTokensAtHit: 100_000,
    });

    const freshLedger = new EndpointLedger(endpointLedgerPath(dir));
    try {
      const learnedWindow = freshLedger.windowState("codex", WEEKLY, NOW);
      expect(learnedWindow.capacityTokens).toBe(100_000);

      const withObservation = decideLimitPacing({
        nowMs: NOW,
        windows: [learnedWindow],
        estimatedRemainingSteps: 10,
        recentStepTokens: [1000, 1000, 1000, 1000, 1000],
        recentStepDurationsMs: [60_000, 60_000, 60_000, 60_000, 60_000],
      });
      expect(withObservation.action).toBe("throttle");
      expect(withObservation.limitingWindow).toBe("weekly");
      expect(withObservation.sustainableTokensPerHour).toBeCloseTo(10_000, 0);
      expect(withObservation.interStepDelayMs).toBe(300_000);
    } finally {
      freshLedger.close();
    }
  });

  it("survives reopen — two ledger handles on one file see the same rows", () => {
    ledger.appendConsumption(consume());
    const second = new EndpointLedger(endpointLedgerPath(dir));
    expect(second.windowState("codex", WEEKLY, NOW).consumedTokens).toBe(1000);
    second.close();
  });

  describe("member cooldowns (WP-573)", () => {
    const cool = (memberId: string, untilMs: number, reason: RotationTrigger = "limit") => ({
      memberId,
      reason,
      observedAtMs: NOW,
      cooldownUntilMs: untilMs,
    });

    it("returns only members still held out, soonest expiry first", () => {
      ledger.recordMemberCooldown(cool("sonnet-5", NOW + 3 * HOUR));
      ledger.recordMemberCooldown(cool("gemini-3-6-flash", NOW + HOUR));
      ledger.recordMemberCooldown(cool("gpt-5-6-terra", NOW - 1));

      const active = ledger.activeCooldowns(NOW);
      expect(active.map((c) => c.memberId)).toEqual(["gemini-3-6-flash", "sonnet-5"]);
      expect(active[0]?.cooldownUntilMs).toBe(NOW + HOUR);
    });

    it("EXTENDS an existing cooldown and never shortens it", () => {
      ledger.recordMemberCooldown(cool("gemini-3-6-flash", NOW + 4 * HOUR, "limit"));
      // An auth blip arriving after a four-hour wall must not resurrect the member.
      ledger.recordMemberCooldown(cool("gemini-3-6-flash", NOW + 10 * 60_000, "auth"));

      const [active] = ledger.activeCooldowns(NOW);
      expect(active?.cooldownUntilMs).toBe(NOW + 4 * HOUR);
      expect(active?.reason).toBe("limit");
    });

    it("takes the later expiry and its reason when the new signal is longer", () => {
      ledger.recordMemberCooldown(cool("gemini-3-6-flash", NOW + 10 * 60_000, "auth"));
      ledger.recordMemberCooldown(cool("gemini-3-6-flash", NOW + 4 * HOUR, "limit"));

      const [active] = ledger.activeCooldowns(NOW);
      expect(active?.cooldownUntilMs).toBe(NOW + 4 * HOUR);
      expect(active?.reason).toBe("limit");
    });

    it("clears a cooldown so a re-login is noticed before the timer expires", () => {
      ledger.recordMemberCooldown(cool("sonnet-5", NOW + 4 * HOUR, "auth"));
      expect(ledger.activeCooldowns(NOW)).toHaveLength(1);

      ledger.clearMemberCooldown("sonnet-5");
      expect(ledger.activeCooldowns(NOW)).toEqual([]);
    });

    it("is cross-run: a second handle on the same file sees the wall", () => {
      // This is the property that stops chain node N+1 walking back into the
      // wall node N just found — each node is a separate run.
      ledger.recordMemberCooldown(cool("gemini-3-6-flash", NOW + 4 * HOUR));
      const second = new EndpointLedger(endpointLedgerPath(dir));
      try {
        expect(second.activeCooldowns(NOW).map((c) => c.memberId)).toEqual(["gemini-3-6-flash"]);
      } finally {
        second.close();
      }
    });
  });
});
