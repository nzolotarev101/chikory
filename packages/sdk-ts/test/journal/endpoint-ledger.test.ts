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
import type { DeclaredQuotaWindow } from "../../src/index.js";

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

  it("a stale (past) reset is not reported", () => {
    ledger.appendLimitObservation({
      endpointTarget: "codex",
      windowKind: "rolling-5h",
      observedAtMs: NOW - 10_000,
      resetAtMs: NOW - 1,
      consumedTokensAtHit: 40_000,
    });
    const state = ledger.windowState("codex", ROLLING_5H, NOW);
    expect(state.capacityTokens).toBe(40_000);
    expect(state.resetAtMs).toBeUndefined();
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
});
