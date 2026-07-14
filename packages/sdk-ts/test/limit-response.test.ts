import { describe, expect, it } from "vitest";

import { resolveEndpointCapabilities } from "../src/endpoint-capability.js";
import { decideLimitResponse } from "../src/limit-response.js";
import type { ClassifiedLimitSignal } from "../src/limit-signal.js";
import type { RoutingPolicy, Stage } from "../src/types.js";

const routing: RoutingPolicy = {
  stages: {
    plan: { provider: "openai-compat", model: "gpt-5.6-sol xhigh" },
    code: { provider: "openai-compat", model: "gpt-5.6-sol xhigh" },
    review: { provider: "openai-compat", model: "gpt-5.6-sol xhigh" },
    judge: { provider: "gemini", model: "gemini-2.5-pro" },
  },
  failover: {
    judge: [
      { provider: "anthropic", model: "claude-haiku-4-5" },
      { provider: "openai", model: "gpt-5-mini" },
    ],
  },
};

function limitSignal(
  stage: Stage,
  capability: ClassifiedLimitSignal["capability"],
): ClassifiedLimitSignal {
  return {
    kind: "limit",
    source: "injected",
    capability,
    reason: `${stage} endpoint throttled`,
    retryAfterMs: 60_000,
    retryAtMs: 120_000,
  };
}

describe("decideLimitResponse", () => {
  it("orders legal declared failover before parking on the real WP-307 model", () => {
    const capabilities = resolveEndpointCapabilities({
      routing,
      executor: { adapter: "codex", family: "openai" },
    });
    const throttled = capabilities.judge[0]!;

    const decision = decideLimitResponse({
      stage: "judge",
      capabilities,
      signal: limitSignal("judge", {
        endpointKind: throttled.kind,
        target: "gemini",
        family: throttled.family,
        limits: throttled.limits,
      }),
    });

    expect(decision).toMatchObject({
      stage: "judge",
      throttled: {
        endpointKind: "provider",
        target: "gemini",
        family: "gemini",
        limits: { requestField: "maxOutputTokens", defaultMaxTokens: 4096 },
      },
      steps: [
        {
          action: "declared-failover",
          target: {
            stage: "judge",
            index: 1,
            capability: {
              endpointKind: "provider",
              target: "anthropic",
              family: "anthropic",
              limits: { requestField: "max_tokens", defaultMaxTokens: 4096 },
            },
          },
        },
        {
          action: "park-until-reset",
          reason: "no-legal-headroom",
          retryAfterMs: 60_000,
          retryAtMs: 120_000,
        },
      ],
      blocked: [
        { index: 0, reason: "throttled-capability" },
        { index: 2, reason: "invariant-2-same-family" },
      ],
    });
  });

  it("orders limit-independent work before parking when the throttled stage has no legal failover", () => {
    const capabilities = resolveEndpointCapabilities({
      routing,
      executor: { adapter: "codex", family: "openai" },
    });
    const throttled = capabilities.code[0]!;

    const decision = decideLimitResponse({
      stage: "code",
      capabilities,
      signal: limitSignal("code", {
        endpointKind: throttled.kind,
        target: "codex",
        family: throttled.family,
        limits: throttled.limits,
      }),
    });

    expect(decision.steps).toEqual([
      {
        action: "limit-independent-work",
        target: {
          stage: "review",
          index: 0,
          capability: {
            endpointKind: "provider",
            target: "openai-compat",
            family: "openai-compat",
            limits: { requestField: "max_tokens", defaultMaxTokens: 4096 },
          },
        },
      },
      {
        action: "limit-independent-work",
        target: {
          stage: "judge",
          index: 0,
          capability: {
            endpointKind: "provider",
            target: "gemini",
            family: "gemini",
            limits: { requestField: "maxOutputTokens", defaultMaxTokens: 4096 },
          },
        },
      },
      {
        action: "limit-independent-work",
        target: {
          stage: "judge",
          index: 1,
          capability: {
            endpointKind: "provider",
            target: "anthropic",
            family: "anthropic",
            limits: { requestField: "max_tokens", defaultMaxTokens: 4096 },
          },
        },
      },
      {
        action: "park-until-reset",
        reason: "no-legal-headroom",
        retryAfterMs: 60_000,
        retryAtMs: 120_000,
      },
    ]);
    expect(decision.blocked).toEqual([
      {
        stage: "code",
        index: 0,
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
        reason: "throttled-capability",
      },
      {
        stage: "judge",
        index: 2,
        capability: {
          endpointKind: "provider",
          target: "openai",
          family: "openai",
          limits: { requestField: "max_completion_tokens", defaultMaxTokens: 4096 },
        },
        reason: "invariant-2-same-family",
      },
    ]);
  });

  it("parks last when invariant #2 blocks the only alternative headroom target", () => {
    const capabilities = resolveEndpointCapabilities({
      routing: {
        ...routing,
        failover: {
          judge: [{ provider: "openai", model: "gpt-5-mini" }],
        },
      },
      executor: { adapter: "codex", family: "openai" },
    });
    const throttled = capabilities.judge[0]!;

    const decision = decideLimitResponse({
      stage: "judge",
      capabilities,
      signal: limitSignal("judge", {
        endpointKind: throttled.kind,
        target: "gemini",
        family: throttled.family,
        limits: throttled.limits,
      }),
    });

    expect(decision).toEqual({
      stage: "judge",
      throttled: {
        endpointKind: "provider",
        target: "gemini",
        family: "gemini",
        limits: { requestField: "maxOutputTokens", defaultMaxTokens: 4096 },
      },
      blocked: [
        {
          stage: "judge",
          index: 0,
          capability: {
            endpointKind: "provider",
            target: "gemini",
            family: "gemini",
            limits: { requestField: "maxOutputTokens", defaultMaxTokens: 4096 },
          },
          reason: "throttled-capability",
        },
        {
          stage: "judge",
          index: 1,
          capability: {
            endpointKind: "provider",
            target: "openai",
            family: "openai",
            limits: { requestField: "max_completion_tokens", defaultMaxTokens: 4096 },
          },
          reason: "invariant-2-same-family",
        },
      ],
      steps: [
        {
          action: "park-until-reset",
          reason: "no-legal-headroom",
          retryAfterMs: 60_000,
          retryAtMs: 120_000,
        },
      ],
    });
  });
});
