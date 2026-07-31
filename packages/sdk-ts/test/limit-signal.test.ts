import { describe, expect, it } from "vitest";

import { describeEndpointCapability, resolveEndpointCapabilities } from "../src/endpoint-capability.js";
import { classifyLimitSignal } from "../src/limit-signal.js";
import type { RoutingPolicy } from "../src/types.js";

const NOW_MS = Date.parse("2026-07-11T12:00:00.000Z");

describe("classifyLimitSignal", () => {
  it("normalizes HTTP 429 Retry-After seconds against provider token-limit semantics", () => {
    const capability = describeEndpointCapability("openai");

    expect(
      classifyLimitSignal({
        capability,
        nowMs: NOW_MS,
        signal: {
          kind: "http",
          statusCode: 429,
          headers: { "Retry-After": "12" },
          body: "rate limited",
        },
      }),
    ).toEqual({
      kind: "limit",
      source: "http-429",
      capability: {
        endpointKind: "provider",
        target: "openai",
        family: "openai",
        limits: { requestField: "max_completion_tokens", defaultMaxTokens: 4096 },
      },
      reason: "rate limited",
      retryAfterMs: 12_000,
      retryAtMs: NOW_MS + 12_000,
    });
  });

  it("normalizes HTTP 429 Retry-After dates", () => {
    const capability = describeEndpointCapability("gemini");

    expect(
      classifyLimitSignal({
        capability,
        nowMs: NOW_MS,
        signal: {
          kind: "http",
          statusCode: 429,
          headers: { "retry-after": "Sat, 11 Jul 2026 12:02:00 GMT" },
        },
      }),
    ).toMatchObject({
      source: "http-429",
      retryAfterMs: 120_000,
      retryAtMs: NOW_MS + 120_000,
      capability: {
        target: "gemini",
        limits: { requestField: "maxOutputTokens", defaultMaxTokens: 4096 },
      },
    });
  });

  it("normalizes CLI usage-limit stderr against resolved WP-307 executor capabilities", () => {
    const policy: RoutingPolicy = {
      stages: {
        plan: { provider: "openai-compat", model: "gpt-5.6-sol xhigh" },
        code: { provider: "openai-compat", model: "gpt-5.6-sol xhigh" },
        review: { provider: "openai-compat", model: "gpt-5.6-sol xhigh" },
        judge: { provider: "gemini", model: "gemini-2.5-pro" },
      },
    };
    const capabilities = resolveEndpointCapabilities({
      routing: policy,
      executor: { adapter: "codex", family: "openai" },
    });

    expect(
      classifyLimitSignal({
        capability: capabilities.code[0]!,
        nowMs: NOW_MS,
        signal: {
          kind: "cli-stderr",
          exitCode: 1,
          stderr: "You've hit your usage limit. Please try again in 1h 30m.",
        },
      }),
    ).toEqual({
      kind: "limit",
      source: "cli-usage-limit",
      capability: {
        endpointKind: "executor",
        target: "codex",
        family: "openai",
        limits: {
          kind: "rolling-window",
          window: "subscription-session",
          reset: "provider-managed",
          boundedBy: "max-seconds-and-prompt-scope",
          quotaWindows: [
            { window: "rolling-5h", durationMs: 18_000_000 },
            { window: "weekly", durationMs: 604_800_000 },
          ],
        },
      },
      reason: "You've hit your usage limit. Please try again in 1h 30m.",
      retryAfterMs: 5_400_000,
      retryAtMs: NOW_MS + 5_400_000,
    });
  });

  it("classifies the Antigravity CLI quota wall verbatim (F-228)", () => {
    // The exact stderr `agy` emitted on dogfood-121 `chain-86fbe5a7…-node-N-3-r1`,
    // four consecutive steps. It matched none of the pre-F-228 alternatives —
    // "your limits" is not "usage limit", "quota reached" is not "limit reached" —
    // so a wall that clears itself in an hour killed the node and then the chain.
    const stderr =
      "Error: Individual quota reached. Please upgrade your subscription to " +
      "increase your limits. Resets in 1h0m8s.\n";

    expect(
      classifyLimitSignal({
        capability: describeEndpointCapability({ adapter: "gemini-cli", family: "gemini" }),
        nowMs: NOW_MS,
        signal: { kind: "cli-stderr", exitCode: 1, stderr },
      }),
    ).toMatchObject({
      kind: "limit",
      source: "cli-usage-limit",
      capability: { endpointKind: "executor", target: "gemini-cli", family: "gemini" },
      reason: stderr.trim(),
      // F-234: the COMPACT "1h0m8s" must total 3,608,000 ms. Before the fix only
      // the trailing "8s" matched, so the runner would have parked 8 seconds and
      // walked straight back into a wall with an hour left on it.
      retryAfterMs: 3_608_000,
      retryAtMs: NOW_MS + 3_608_000,
    });
  });

  it("totals compact and spaced duration forms alike, and rejects letter runs (F-234)", () => {
    const capability = describeEndpointCapability({ adapter: "gemini-cli", family: "gemini" });
    const parse = (stderr: string): number | undefined =>
      classifyLimitSignal({ capability, nowMs: NOW_MS, signal: { kind: "cli-stderr", stderr } })
        ?.retryAfterMs;

    expect(parse("quota reached. Resets in 1h0m8s.")).toBe(3_608_000);
    expect(parse("quota reached. Resets in 1h 30m")).toBe(5_400_000);
    expect(parse("quota reached. Try again in 2m30s")).toBe(150_000);
    expect(parse("quota reached. Try again in 45 seconds")).toBe(45_000);
    // A unit letter glued to more letters is not a unit.
    expect(parse("quota reached. Try again in 5months")).toBeUndefined();
  });

  it("classifies quota exhaustion regardless of wording (F-228)", () => {
    const capability = describeEndpointCapability({ adapter: "gemini-cli", family: "gemini" });
    for (const stderr of ["quota exceeded", "Daily quota exhausted", "project quota limit"]) {
      expect(classifyLimitSignal({ capability, signal: { kind: "cli-stderr", stderr } })).toMatchObject(
        { source: "cli-usage-limit" },
      );
    }
    // Still not a limit — the widened alternation must not swallow ordinary errors.
    expect(
      classifyLimitSignal({
        capability,
        signal: { kind: "cli-stderr", stderr: "quota accounting is disabled for this project" },
      }),
    ).toBeUndefined();
  });

  it("normalizes injected limit seams without parsing transport text", () => {
    expect(
      classifyLimitSignal({
        capability: describeEndpointCapability("claude-code"),
        nowMs: NOW_MS,
        signal: {
          kind: "injected",
          reason: "debug limit seam",
          retryAfterMs: 30_000,
        },
      }),
    ).toEqual({
      kind: "limit",
      source: "injected",
      capability: {
        endpointKind: "executor",
        target: "claude-code",
        family: "anthropic",
        limits: {
          kind: "rolling-window",
          window: "subscription-session",
          reset: "provider-managed",
          boundedBy: "max-turns",
          defaultMaxTurns: 25,
          quotaWindows: [
            { window: "rolling-5h", durationMs: 18_000_000 },
            { window: "weekly", durationMs: 604_800_000 },
          ],
        },
      },
      reason: "debug limit seam",
      retryAfterMs: 30_000,
    });
  });

  it("returns undefined for non-limit transport and CLI signals", () => {
    const capability = describeEndpointCapability("openai-compat");

    expect(
      classifyLimitSignal({
        capability,
        signal: { kind: "http", statusCode: 500, body: "server error" },
      }),
    ).toBeUndefined();
    expect(
      classifyLimitSignal({
        capability,
        signal: { kind: "cli-stderr", stderr: "permission denied" },
      }),
    ).toBeUndefined();
  });
});
