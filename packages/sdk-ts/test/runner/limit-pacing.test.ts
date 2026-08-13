import { describe, expect, it } from "vitest";

import {
  decideLimitPacing,
  MAX_THROTTLE_DELAY_MS,
  type LimitPacingInput,
  type WindowQuotaState,
} from "../../src/runner/limit-pacing.js";

const NOW = 1_000_000_000;
const HOUR = 60 * 60 * 1000;

/** 5 steps × 1000 tokens / 60s each ⇒ observed = 60k tokens/hour. */
function burn(input: Partial<LimitPacingInput> = {}): LimitPacingInput {
  return {
    nowMs: NOW,
    windows: [],
    estimatedRemainingSteps: 10,
    recentStepTokens: [1000, 1000, 1000, 1000, 1000],
    recentStepDurationsMs: [60_000, 60_000, 60_000, 60_000, 60_000],
    ...input,
  };
}

function weekly(overrides: Partial<WindowQuotaState> = {}): WindowQuotaState {
  return {
    window: "weekly",
    windowMs: 7 * 24 * HOUR,
    consumedTokens: 0,
    ...overrides,
  };
}

describe("decideLimitPacing (WP-310)", () => {
  it("unknown capacity means observe, never throttle — push", () => {
    const decision = decideLimitPacing(
      burn({ windows: [weekly({ consumedTokens: 5_000_000 })] }),
    );
    expect(decision.action).toBe("push");
    expect(decision.interStepDelayMs).toBe(0);
    expect(decision.sustainableTokensPerHour).toBe(Infinity);
    expect(decision.limitingWindow).toBeUndefined();
  });

  it("no burn history yet — push (no data, no verdict)", () => {
    const decision = decideLimitPacing(
      burn({
        recentStepTokens: [],
        recentStepDurationsMs: [],
        windows: [weekly({ capacityTokens: 1000, consumedTokens: 999, resetAtMs: NOW + HOUR })],
      }),
    );
    expect(decision.action).toBe("push");
  });

  it("burn under half the sustainable pace — push", () => {
    // remaining 1.3M over 10h ⇒ sustainable 130k/h; observed 60k ≤ 65k
    const decision = decideLimitPacing(
      burn({
        windows: [weekly({ capacityTokens: 1_300_000, resetAtMs: NOW + 10 * HOUR })],
      }),
    );
    expect(decision.action).toBe("push");
    expect(decision.limitingWindow).toBe("weekly");
    expect(decision.sustainableTokensPerHour).toBeCloseTo(130_000, 0);
    expect(decision.observedTokensPerHour).toBeCloseTo(60_000, 0);
  });

  it("burn within sustainable pace — steady, no delay", () => {
    // remaining 800k over 10h ⇒ sustainable 80k/h; observed 60k in (40k, 80k]
    const decision = decideLimitPacing(
      burn({ windows: [weekly({ capacityTokens: 800_000, resetAtMs: NOW + 10 * HOUR })] }),
    );
    expect(decision.action).toBe("steady");
    expect(decision.interStepDelayMs).toBe(0);
  });

  it("burn over sustainable pace — throttle with the exact catch-down delay", () => {
    // remaining 100k over 10h ⇒ sustainable 10k/h; step = 1000 tokens ⇒
    // target step period 1000/(10k/h) = 6min ⇒ delay = 6min − 1min = 5min
    const decision = decideLimitPacing(
      burn({ windows: [weekly({ capacityTokens: 100_000, resetAtMs: NOW + 10 * HOUR })] }),
    );
    expect(decision.action).toBe("throttle");
    expect(decision.interStepDelayMs).toBe(300_000);
    expect(decision.limitingWindow).toBe("weekly");
    expect(decision.paceConflict).toBe(false);
  });

  it("tightest window binds — weekly beats rolling-5h", () => {
    const decision = decideLimitPacing(
      burn({
        windows: [
          { window: "rolling-5h", windowMs: 5 * HOUR, consumedTokens: 0, capacityTokens: 10_000_000, resetAtMs: NOW + 5 * HOUR },
          weekly({ capacityTokens: 100_000, resetAtMs: NOW + 10 * HOUR }),
        ],
      }),
    );
    expect(decision.action).toBe("throttle");
    expect(decision.limitingWindow).toBe("weekly");
  });

  it("missing learned reset falls back to now + windowMs (worst case)", () => {
    // remaining 100k over the full 10h fallback window ⇒ sustainable 10k/h
    const decision = decideLimitPacing(
      burn({ windows: [weekly({ windowMs: 10 * HOUR, capacityTokens: 100_000 })] }),
    );
    expect(decision.action).toBe("throttle");
    expect(decision.sustainableTokensPerHour).toBeCloseTo(10_000, 0);
  });

  it("next step would blow the window — predict-limit before the provider fires", () => {
    const decision = decideLimitPacing(
      burn({
        windows: [
          weekly({ capacityTokens: 10_000, consumedTokens: 9_500, resetAtMs: NOW + 2 * HOUR }),
        ],
      }),
    );
    expect(decision.action).toBe("predict-limit");
    expect(decision.predictedResetAtMs).toBe(NOW + 2 * HOUR);
    expect(decision.interStepDelayMs).toBe(0);
  });

  it("catch-down needs more than the max crawl — predict-limit beats endless throttle", () => {
    // remaining 1000 tokens over 10h ⇒ needed delay ≈ 10h ≫ 30min cap
    const decision = decideLimitPacing(
      burn({ windows: [weekly({ capacityTokens: 6_000, consumedTokens: 5_000, resetAtMs: NOW + 10 * HOUR })] }),
    );
    expect(decision.action).toBe("predict-limit");
    expect(decision.predictedResetAtMs).toBe(NOW + 10 * HOUR);
  });

  it("deadline demanding more than quota allows — paceConflict throttles only to required pace", () => {
    // sustainable 10k/h; deadline needs 30 steps × 1000 tokens inside 1h = 30k/h
    const decision = decideLimitPacing(
      burn({
        windows: [weekly({ capacityTokens: 100_000, resetAtMs: NOW + 10 * HOUR })],
        horizonDeadlineMs: NOW + HOUR,
        estimatedRemainingSteps: 30,
      }),
    );
    expect(decision.action).toBe("throttle");
    expect(decision.paceConflict).toBe(true);
    // required period 1000/(30k/h) = 2min ⇒ delay = 2min − 1min
    expect(decision.interStepDelayMs).toBe(60_000);
    expect(decision.requiredTokensPerHour).toBeCloseTo(30_000, 0);
  });

  it("delay clamps at MAX_THROTTLE_DELAY_MS under a pace conflict", () => {
    // sustainable ≈ 1 token/h, required ≈ 100 tokens/h: conflict, and even the
    // required pace needs a step period far beyond the crawl cap
    const decision = decideLimitPacing(
      burn({
        windows: [weekly({ capacityTokens: 6_000, consumedTokens: 4_999, resetAtMs: NOW + 1000 * HOUR })],
        horizonDeadlineMs: NOW + 100 * HOUR,
        estimatedRemainingSteps: 10,
      }),
    );
    expect(decision.paceConflict).toBe(true);
    expect(decision.action).toBe("throttle");
    expect(decision.interStepDelayMs).toBe(MAX_THROTTLE_DELAY_MS);
  });

  it("empty or zero duration steps fall back correctly", () => {
    // Empty durations - meanStepDurationMs falls back to 1
    // recentStepTokens: [1000], but durations are [0] -> mean step duration is Math.max(1, 0) = 1ms
    // observedPerMs should handle totalDurationMs = 0 -> observedPerMs = 0
    // If observedPerMs is 0, we should expect "push" action (spend freely, observe)
    const decisionZeroDurations = decideLimitPacing(
      burn({
        recentStepTokens: [1000, 1000],
        recentStepDurationsMs: [0, 0],
        windows: [weekly({ capacityTokens: 100_000, resetAtMs: NOW + 10 * HOUR })],
      }),
    );
    expect(decisionZeroDurations.action).toBe("push");
    expect(decisionZeroDurations.observedTokensPerHour).toBe(0);
  });

  it("negative or zero remaining tokens clamp to 0", () => {
    // If capacityTokens < consumedTokens, remainingTokens should clamp to 0
    // sustainablePerMs should be 0, leading to targetPerMs = 0 or requiredPerMs (if deadline is set)
    // If targetPerMs is 0, neededDelayMs should be Infinity, and if !paceConflict, we should predict-limit.
    const decisionClamped = decideLimitPacing(
      burn({
        windows: [weekly({ capacityTokens: 10_000, consumedTokens: 15_000, resetAtMs: NOW + 10 * HOUR })],
      }),
    );
    expect(decisionClamped.sustainableTokensPerHour).toBe(0);
    expect(decisionClamped.action).toBe("predict-limit");
  });

  it("expired reset times clamp untilResetMs to at least 1ms", () => {
    // If resetAtMs <= nowMs, untilResetMs = Math.max(1, resetAtMs - nowMs) = 1ms
    // capacity: 100_000, consumed: 0 -> remaining: 100_000
    // sustainablePerMs = 100_000 / 1ms = 100_000 tokens/ms
    const decisionExpiredReset = decideLimitPacing(
      burn({
        windows: [weekly({ capacityTokens: 100_000, resetAtMs: NOW - 1000 })],
      }),
    );
    expect(decisionExpiredReset.sustainableTokensPerHour).toBeCloseTo(100_000 * HOUR, 0);
  });

  it("deadline/horizon expired or estimated steps zero", () => {
    // If horizonDeadlineMs <= nowMs, requiredTokensPerHour should be 0
    const decisionExpiredDeadline = decideLimitPacing(
      burn({
        windows: [weekly({ capacityTokens: 100_000, resetAtMs: NOW + 10 * HOUR })],
        horizonDeadlineMs: NOW - 1000,
        estimatedRemainingSteps: 10,
      }),
    );
    expect(decisionExpiredDeadline.requiredTokensPerHour).toBe(0);

    // If estimatedRemainingSteps <= 0, requiredTokensPerHour should be 0
    const decisionZeroSteps = decideLimitPacing(
      burn({
        windows: [weekly({ capacityTokens: 100_000, resetAtMs: NOW + 10 * HOUR })],
        horizonDeadlineMs: NOW + HOUR,
        estimatedRemainingSteps: 0,
      }),
    );
    expect(decisionZeroSteps.requiredTokensPerHour).toBe(0);
  });

  it("extremely close deadline calculates high required pace", () => {
    // deadline is in 1ms, estimated remaining steps = 1, mean tokens = 1000
    // requiredPerMs = (1 * 1000) / 1ms = 1000 tokens/ms
    const decisionCloseDeadline = decideLimitPacing(
      burn({
        windows: [weekly({ capacityTokens: 100_000, resetAtMs: NOW + 10 * HOUR })],
        horizonDeadlineMs: NOW + 1,
        estimatedRemainingSteps: 1,
      }),
    );
    expect(decisionCloseDeadline.requiredTokensPerHour).toBeCloseTo(1000 * HOUR, 0);
  });

  it("mean step tokens is 0 under tightest window prevents predict-limit branch", () => {
    // capacity: 10, consumed: 5 -> remaining: 5
    // but meanStepTokens = 0, so next step won't blow the window
    const decisionZeroTokens = decideLimitPacing(
      burn({
        recentStepTokens: [0, 0, 0],
        windows: [weekly({ capacityTokens: 10, consumedTokens: 5, resetAtMs: NOW + HOUR })],
      }),
    );
    // Since observed is 0 (meanStepTokens is 0, so observed is 0), action should be push
    expect(decisionZeroTokens.action).toBe("push");
  });

  it("multi-window checks tightest limit correctly", () => {
    // Window 1: rolling-5h, capacity 100_000, reset in 1 hour -> sustainable 100_000 / hour
    // Window 2: weekly, capacity 50_000, reset in 1 hour -> sustainable 50_000 / hour
    // Tightest sustainable pace is 50_000 / hour from weekly.
    const decisionMulti = decideLimitPacing(
      burn({
        windows: [
          { window: "rolling-5h", windowMs: 5 * HOUR, capacityTokens: 100_000, consumedTokens: 0, resetAtMs: NOW + HOUR },
          weekly({ capacityTokens: 50_000, consumedTokens: 0, resetAtMs: NOW + HOUR }),
        ],
      }),
    );
    expect(decisionMulti.limitingWindow).toBe("weekly");
    expect(decisionMulti.sustainableTokensPerHour).toBeCloseTo(50_000, 0);
  });
});
