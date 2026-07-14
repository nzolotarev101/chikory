import { describe, expect, it } from "vitest";

import type { TaskSpec } from "../../src/types.js";
import {
  CONTEXT_WINDOW_TABLE,
  DEFAULT_CALIBRATION_MIN_WINDOW,
  calibrateContextWindow,
  lookupContextWindow,
  resolveContextWindowForSpec,
} from "../../src/runner/context-window.js";
import { decideContextWindowPacing } from "../../src/runner/pacing.js";

describe("context-window lookup (WP-252)", () => {
  it("resolves exact model families", () => {
    expect(lookupContextWindow("gpt-5.6-sol xhigh")).toBe(400_000);
    expect(lookupContextWindow("claude-opus-4-8")).toBe(200_000);
    expect(lookupContextWindow("gemini-3.1-pro-preview")).toBe(1_000_000);
  });

  it("resolves dated snapshot ids by longest prefix", () => {
    expect(lookupContextWindow("gpt-5.6-sol-2026-06-01")).toBe(400_000);
  });

  it("returns fallback values for unknown models", () => {
    expect(lookupContextWindow("mystery-model", 123_456)).toBe(123_456);
    expect(lookupContextWindow("mystery-model")).toBe(200_000);
  });

  it("exports the static context-window table", () => {
    expect(CONTEXT_WINDOW_TABLE["gpt-5.6-sol xhigh"]).toBe(400_000);
  });

  it("resolves the executor code-stage model from a task spec", () => {
    const spec = {
      routing: { stages: { code: { model: "gpt-5.6-sol xhigh" } } },
    } as TaskSpec;

    expect(resolveContextWindowForSpec(spec, 200_000)).toBe(400_000);
  });

  it("returns the resolver fallback for unknown or empty code-stage models", () => {
    const unknownModelSpec = {
      routing: { stages: { code: { model: "mystery-model" } } },
    } as TaskSpec;
    const emptyModelSpec = {
      routing: { stages: { code: { model: "" } } },
    } as TaskSpec;

    expect(resolveContextWindowForSpec(unknownModelSpec, 123_456)).toBe(123_456);
    expect(resolveContextWindowForSpec(emptyModelSpec, 123_456)).toBe(123_456);
  });
});

describe("calibrateContextWindow (F-125 window auto-calibration)", () => {
  it("sizes the window so the first step sits at the default 0.75 target utilization", () => {
    // 2400 observed → 2400/0.75 = 3200; first-step utilization is exactly 0.75.
    expect(calibrateContextWindow(2400)).toBe(3200);
    expect(2400 / calibrateContextWindow(2400)).toBeCloseTo(0.75, 5);
  });

  it("honors a custom target utilization and rounds up", () => {
    expect(calibrateContextWindow(1000, { targetUtilization: 0.5 })).toBe(2000);
    // ceil: 1000/0.7 = 1428.57 → 1429
    expect(calibrateContextWindow(1000, { targetUtilization: 0.7 })).toBe(1429);
  });

  it("clamps the target utilization into (0,1) and floors the window", () => {
    // target clamped to 0.99 → window ~= projected, never below it.
    expect(calibrateContextWindow(1000, { targetUtilization: 5 })).toBeGreaterThanOrEqual(1000);
    // a tiny first step cannot produce an unusably small window.
    expect(calibrateContextWindow(1)).toBe(DEFAULT_CALIBRATION_MIN_WINDOW);
    expect(calibrateContextWindow(0)).toBe(DEFAULT_CALIBRATION_MIN_WINDOW);
    expect(calibrateContextWindow(-500)).toBe(DEFAULT_CALIBRATION_MIN_WINDOW);
  });

  it("keeps the first step OUT of the compact band but real growth crosses it (the dogfood-094 fix)", () => {
    // dogfood-094's first step projected ~1600 with the 4000 window stayed at 40%
    // and never folded. Auto-calibration from that same 1600 forces the fold.
    const window = calibrateContextWindow(1600);
    const policy = { compactAtFraction: 0.8 };
    // step 1 (projected 1600) → still `continue` (0.75 < 0.8).
    const step1 = decideContextWindowPacing(
      { currentInputTokens: 1600, currentOutputTokens: 0, estimatedNextStepTokens: 0, contextWindowTokens: window },
      policy,
    );
    expect(step1.action).toBe("continue");
    // one more summary of real growth crosses the compact band.
    const step2 = decideContextWindowPacing(
      { currentInputTokens: 1900, currentOutputTokens: 0, estimatedNextStepTokens: 0, contextWindowTokens: window },
      policy,
    );
    expect(step2.action).toBe("compact");
    // a single step's estimate (~one summary) never parks against the window.
    const smallStep = decideContextWindowPacing(
      { currentInputTokens: 1600, currentOutputTokens: 0, estimatedNextStepTokens: 300, contextWindowTokens: window },
      policy,
    );
    expect(smallStep.action).not.toBe("park");
  });
});
