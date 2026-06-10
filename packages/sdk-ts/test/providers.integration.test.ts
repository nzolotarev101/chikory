/**
 * Provider-adapter conformance suite (WP-101/WP-102) — real calls, no LLM
 * mocks (CLAUDE.md rule). Each provider's block is skipped when its key is
 * absent so CI without secrets stays green. Tagged @integration.
 */
import { describe, expect, it } from "vitest";

import { createAnthropicAdapter } from "../src/providers/anthropic.js";
import { createGeminiAdapter } from "../src/providers/gemini.js";
import { createOpenAIAdapter } from "../src/providers/openai.js";
import type { ProviderAdapter } from "../src/providers/provider.js";
import { computeCostUsd, lookupPricing } from "../src/pricing.js";

/** Small, cheap models — the suite spends a few hundred tokens per provider. */
const CASES: Array<{
  envVar: string;
  model: string;
  make: () => ProviderAdapter;
}> = [
  {
    envVar: "ANTHROPIC_API_KEY",
    model: "claude-haiku-4-5-20251001",
    make: () => createAnthropicAdapter(),
  },
  {
    envVar: "OPENAI_API_KEY",
    model: "gpt-5.2-mini",
    make: () => createOpenAIAdapter(),
  },
  {
    envVar: "GEMINI_API_KEY",
    model: "gemini-2.5-flash",
    make: () => createGeminiAdapter(),
  },
];

/**
 * Shared assertions run identically against every adapter — this is the
 * conformance contract new adapters (WP-102, WP-113…) must pass.
 */
export function conformanceSuite(name: string, model: string, make: () => ProviderAdapter): void {
  it(`${name}: returns content + token counts @integration`, async () => {
    const adapter = make();
    const result = await adapter.complete({
      model,
      messages: [{ role: "user", content: "Reply with the single word: pong" }],
      maxTokens: 32,
    });
    expect(result.content.toLowerCase()).toContain("pong");
    expect(result.tokens.input).toBeGreaterThan(0);
    expect(result.tokens.output).toBeGreaterThan(0);
    // Cost mandatory on every call (RT-11 acceptance).
    expect(lookupPricing(model)).toBeDefined();
    expect(computeCostUsd(model, result.tokens)).toBeGreaterThan(0);
  }, 60_000);

  it(`${name}: structured output returns parseable JSON @integration`, async () => {
    const adapter = make();
    const result = await adapter.complete({
      model,
      messages: [{ role: "user", content: "Give me a color and a number." }],
      maxTokens: 256,
      responseSchema: {
        type: "object",
        properties: { color: { type: "string" }, number: { type: "integer" } },
        required: ["color", "number"],
        additionalProperties: false,
      },
    });
    const parsed: unknown = JSON.parse(result.content);
    expect(parsed).toMatchObject({ color: expect.any(String), number: expect.any(Number) });
  }, 60_000);
}

for (const { envVar, model, make } of CASES) {
  describe.skipIf(!process.env[envVar])(`adapter conformance: ${envVar}`, () => {
    conformanceSuite(envVar, model, make);
  });
}
