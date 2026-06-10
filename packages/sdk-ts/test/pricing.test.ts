import { describe, expect, it } from "vitest";

import { computeCostUsd, lookupPricing, PRICE_TABLE, PRICING_VERSION } from "../src/pricing.js";
import { createAnthropicAdapter } from "../src/providers/anthropic.js";
import { createGeminiAdapter } from "../src/providers/gemini.js";
import { createOpenAIAdapter } from "../src/providers/openai.js";

describe("pricing (WP-101)", () => {
  it("is versioned", () => {
    expect(PRICING_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("computes cost from the static table", () => {
    // claude-sonnet-4-6: $3 in / $15 out per MTok
    expect(computeCostUsd("claude-sonnet-4-6", { input: 1_000_000, output: 1_000_000 })).toBe(18);
    expect(computeCostUsd("claude-sonnet-4-6", { input: 1000, output: 2000 })).toBeCloseTo(
      0.003 + 0.03,
      10,
    );
  });

  it("resolves date-suffixed model ids via longest prefix", () => {
    expect(lookupPricing("claude-haiku-4-5-20251001")).toEqual(PRICE_TABLE["claude-haiku-4-5"]);
  });

  it("unknown (open) models cost 0 unless overridden", () => {
    expect(computeCostUsd("llama-3.3-70b", { input: 1000, output: 1000 })).toBe(0);
    expect(
      computeCostUsd(
        "llama-3.3-70b",
        { input: 1_000_000, output: 1_000_000 },
        { "llama-3.3-70b": { inputPerMTok: 0.1, outputPerMTok: 0.4 } },
      ),
    ).toBeCloseTo(0.5, 10);
  });
});

describe("adapter construction (WP-101)", () => {
  it("fails fast naming the missing env var (invariant #5)", () => {
    expect(() => createAnthropicAdapter({ env: {} })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => createOpenAIAdapter({ env: {} })).toThrow(/OPENAI_API_KEY/);
    expect(() => createGeminiAdapter({ env: {} })).toThrow(/GEMINI_API_KEY/);
  });
});
