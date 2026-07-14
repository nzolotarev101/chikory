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
