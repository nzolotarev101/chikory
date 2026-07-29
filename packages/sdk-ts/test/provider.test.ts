import { describe, expect, it } from "vitest";
import { DEFAULT_TIMEOUT_MS, resolveTimeoutMs } from "../src/providers/provider.js";

describe("provider timeout resolution", () => {
  it("defaults to 600,000ms (10 minutes)", () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(600_000);
    expect(resolveTimeoutMs({ env: {} })).toBe(600_000);
  });

  it("respects explicit opts.timeoutMs over env", () => {
    expect(resolveTimeoutMs({ timeoutMs: 50_000, env: { CHIKORY_PROVIDER_TIMEOUT_MS: "300000" } })).toBe(50_000);
  });

  it("respects CHIKORY_PROVIDER_TIMEOUT_MS env variable", () => {
    expect(resolveTimeoutMs({ env: { CHIKORY_PROVIDER_TIMEOUT_MS: "900000" } })).toBe(900_000);
  });

  it("ignores invalid env values and falls back to default", () => {
    expect(resolveTimeoutMs({ env: { CHIKORY_PROVIDER_TIMEOUT_MS: "not-a-number" } })).toBe(600_000);
    expect(resolveTimeoutMs({ env: { CHIKORY_PROVIDER_TIMEOUT_MS: "-1000" } })).toBe(600_000);
  });
});
