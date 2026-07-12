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
});
