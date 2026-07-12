import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  describeEndpointCapability,
  resolveEndpointCapabilities,
} from "../src/endpoint-capability.js";
import { createRouter } from "../src/router.js";
import { parseTaskSpec } from "../src/taskspec.js";
import type { RoutingPolicy } from "../src/types.js";

const dogfoodSpecPath = join(
  __dirname,
  "..",
  "..",
  "..",
  "examples",
  "dogfood",
  "dogfood-097-wp307-endpoint-capability-model.yaml",
);

describe("describeEndpointCapability", () => {
  it("describes Anthropic API-key auth, token limits, cost fields, and family", () => {
    expect(describeEndpointCapability("anthropic")).toEqual({
      kind: "provider",
      provider: "anthropic",
      family: "anthropic",
      auth: { kind: "api-key", requiredEnv: "ANTHROPIC_API_KEY", header: "x-api-key" },
      limits: { requestField: "max_tokens", defaultMaxTokens: 4096 },
      cost: {
        inputTokensField: "usage.input_tokens",
        outputTokensField: "usage.output_tokens",
        pricing: "static-price-table",
      },
    });
  });

  it("describes OpenAI API-key auth, token limits, cost fields, and family", () => {
    expect(describeEndpointCapability("openai")).toEqual({
      kind: "provider",
      provider: "openai",
      family: "openai",
      auth: { kind: "api-key", requiredEnv: "OPENAI_API_KEY", header: "authorization" },
      limits: { requestField: "max_completion_tokens", defaultMaxTokens: 4096 },
      cost: {
        inputTokensField: "usage.prompt_tokens",
        outputTokensField: "usage.completion_tokens",
        pricing: "static-price-table",
      },
    });
  });

  it("describes Gemini API-key auth, token limits, cost fields, and family", () => {
    expect(describeEndpointCapability("gemini")).toEqual({
      kind: "provider",
      provider: "gemini",
      family: "gemini",
      auth: { kind: "api-key", requiredEnv: "GEMINI_API_KEY", header: "x-goog-api-key" },
      limits: { requestField: "maxOutputTokens", defaultMaxTokens: 4096 },
      cost: {
        inputTokensField: "usageMetadata.promptTokenCount",
        outputTokensField: "usageMetadata.candidatesTokenCount",
        pricing: "static-price-table",
      },
    });
  });

  it("describes OpenAI-compatible optional API-key auth, token limits, cost fields, and family", () => {
    expect(describeEndpointCapability("openai-compat")).toEqual({
      kind: "provider",
      provider: "openai-compat",
      family: "openai-compat",
      auth: {
        kind: "optional-api-key",
        optionalEnv: "OPENAI_COMPAT_API_KEY",
        header: "authorization",
      },
      limits: { requestField: "max_tokens", defaultMaxTokens: 4096 },
      cost: {
        inputTokensField: "usage.prompt_tokens",
        outputTokensField: "usage.completion_tokens",
        pricing: "static-price-table-or-zero",
      },
    });
  });

  it("describes Claude Code as a CLI OAuth executor with subscription-linked limits and cost", () => {
    expect(describeEndpointCapability("claude-code")).toEqual({
      kind: "executor",
      adapter: "claude-code",
      family: "anthropic",
      auth: {
        kind: "cli-oauth-or-api-key",
        oauth: "anthropic-subscription",
        apiKeyEnv: "ANTHROPIC_API_KEY",
        binary: "claude",
      },
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
      cost: {
        pricing: "subscription-linked",
        metering: "cli-reported-total-cost-usd",
        costEstimated: false,
        subscriptionCost: "included-in-plan-or-zero-wire-cost",
      },
    });
  });

  it("describes Codex as a CLI OAuth executor with rolling subscription-window semantics", () => {
    expect(describeEndpointCapability("codex")).toEqual({
      kind: "executor",
      adapter: "codex",
      family: "openai",
      auth: {
        kind: "cli-oauth-or-api-key",
        oauth: "chatgpt-subscription",
        apiKeyEnv: "OPENAI_API_KEY",
        binary: "codex",
      },
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
      cost: {
        pricing: "subscription-linked",
        metering: "estimated-from-cli-usage",
        costEstimated: true,
        subscriptionCost: "included-in-plan-or-zero-wire-cost",
      },
    });
  });

  it("describes the native executor as router-delegated with turn-loop limits", () => {
    expect(describeEndpointCapability({ adapter: "native", family: "gemini" })).toEqual({
      kind: "executor",
      adapter: "native",
      family: "gemini",
      auth: { kind: "router-delegated" },
      limits: {
        kind: "rolling-window",
        window: "router-turn-loop",
        reset: "provider-managed",
        boundedBy: "native-turn-loop",
        defaultMaxTurns: 25,
      },
      cost: {
        pricing: "router-reported",
        metering: "router-summed-cost-usd",
        costEstimated: false,
        subscriptionCost: "not-subscription-backed",
      },
    });
  });

  it("returns conservative data for unknown targets instead of throwing", () => {
    expect(describeEndpointCapability("future-provider")).toEqual({
      kind: "unknown",
      target: "future-provider",
      family: "unknown",
      auth: { kind: "unknown" },
      limits: {
        kind: "unknown",
        conservative: true,
        scheduling: "do-not-assume-headroom",
      },
      cost: {
        pricing: "unknown",
        metering: "unknown",
        costEstimated: true,
      },
      reason: "unrecognized-endpoint",
    });
  });
});

describe("resolveEndpointCapabilities", () => {
  it("resolves parsed dogfood TaskSpec capabilities against the real router config surface", () => {
    const spec = parseTaskSpec(readFileSync(dogfoodSpecPath, "utf8"), {
      env: {
        OPENAI_API_KEY: "test-key",
        OPENAI_COMPAT_BASE_URL: "http://unused.invalid",
      },
    });
    const router = createRouter(spec.routing, {
      env: {
        OPENAI_COMPAT_BASE_URL: "http://unused.invalid",
      },
    });
    expect(router).toHaveProperty("complete");

    const capabilities = resolveEndpointCapabilities(spec);

    expect(capabilities.code).toEqual([describeEndpointCapability("codex")]);
    expect(capabilities.plan).toEqual([describeEndpointCapability("openai-compat")]);
    expect(capabilities.review).toEqual([describeEndpointCapability("openai-compat")]);
    expect(capabilities.judge).toEqual([describeEndpointCapability("openai-compat")]);
  });

  it("resolves CLI executor capabilities against the real router policy surface", () => {
    const choice = { provider: "openai-compat" as const, model: "gpt-5.5" };
    const policy: RoutingPolicy = {
      stages: {
        plan: choice,
        code: choice,
        review: choice,
        judge: { provider: "gemini", model: "gemini-2.5-pro" },
      },
      failover: {
        judge: [{ provider: "anthropic", model: "claude-haiku-4-5" }],
      },
    };

    const router = createRouter(policy, {
      env: {
        OPENAI_COMPAT_BASE_URL: "http://unused.invalid",
        GEMINI_API_KEY: "test-key",
        ANTHROPIC_API_KEY: "test-key",
      },
    });
    expect(router).toHaveProperty("complete");

    const capabilities = resolveEndpointCapabilities({
      routing: policy,
      executor: { adapter: "codex", family: "openai" },
    });

    expect(capabilities.code).toEqual([describeEndpointCapability("codex")]);
    expect(capabilities.plan).toEqual([describeEndpointCapability("openai-compat")]);
    expect(capabilities.review).toEqual([describeEndpointCapability("openai-compat")]);
    expect(capabilities.judge).toEqual([
      describeEndpointCapability("gemini"),
      describeEndpointCapability("anthropic"),
    ]);
  });

  it("resolves unknown executor adapters and routed providers conservatively without throwing", () => {
    const policy = {
      stages: {
        plan: { provider: "future-provider", model: "future-light" },
        code: { provider: "openai-compat", model: "gpt-5.5" },
        review: { provider: "openai-compat", model: "gpt-5.5" },
        judge: { provider: "gemini", model: "gemini-2.5-pro" },
      },
    } as unknown as RoutingPolicy;

    expect(() =>
      resolveEndpointCapabilities({
        routing: policy,
        executor: { adapter: "future-cli", family: "openai" },
      }),
    ).not.toThrow();

    const capabilities = resolveEndpointCapabilities({
      routing: policy,
      executor: { adapter: "future-cli", family: "openai" },
    });

    expect(capabilities.code).toEqual([
      {
        kind: "unknown",
        target: "future-cli",
        family: "unknown",
        auth: { kind: "unknown" },
        limits: {
          kind: "unknown",
          conservative: true,
          scheduling: "do-not-assume-headroom",
        },
        cost: {
          pricing: "unknown",
          metering: "unknown",
          costEstimated: true,
        },
        reason: "unrecognized-executor-adapter",
      },
    ]);
    expect(capabilities.plan[0]).toMatchObject({
      kind: "unknown",
      target: "future-provider",
      reason: "unrecognized-endpoint",
    });
  });
});
