/**
 * Pure endpoint capability descriptors for router providers and executor
 * adapters.
 *
 * This is intentionally plain data: no env reads, no adapter construction, and
 * no validation side effects.
 */
import type { LLMProvider, RoutingPolicy, Stage, TaskSpec } from "./types.js";

export type ExecutorAdapterName = "claude-code" | "codex" | "native";

export type EndpointCapabilityTarget = LLMProvider | ExecutorAdapterName;

export interface ExecutorEndpointTarget {
  readonly adapter: string;
  readonly family: LLMProvider;
}

interface KnownExecutorEndpointTarget {
  readonly adapter: ExecutorAdapterName;
  readonly family: LLMProvider;
}

export type EndpointAuthMode =
  | { kind: "api-key"; requiredEnv: string; header: string }
  | { kind: "optional-api-key"; optionalEnv: string; header: string }
  | {
      kind: "cli-oauth-or-api-key";
      oauth: "anthropic-subscription" | "chatgpt-subscription";
      apiKeyEnv: string;
      binary: "claude" | "codex";
    }
  | { kind: "router-delegated" };

export interface EndpointLimitSemantics {
  readonly requestField: "max_tokens" | "max_completion_tokens" | "maxOutputTokens";
  readonly defaultMaxTokens: number;
}

/**
 * A provider-imposed usage window on a subscription endpoint (WP-310).
 * Capacity is deliberately absent: providers do not publish subscription
 * token quotas, so capacity is learned from limit observations recorded in
 * the endpoint ledger — descriptors stay pure static data.
 */
export interface DeclaredQuotaWindow {
  readonly window: "rolling-5h" | "weekly";
  readonly durationMs: number;
}

export const ROLLING_5H_WINDOW_MS = 5 * 60 * 60 * 1000;
export const WEEKLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const SUBSCRIPTION_QUOTA_WINDOWS: readonly DeclaredQuotaWindow[] = [
  { window: "rolling-5h", durationMs: ROLLING_5H_WINDOW_MS },
  { window: "weekly", durationMs: WEEKLY_WINDOW_MS },
];

export interface ExecutorLimitSemantics {
  readonly kind: "rolling-window";
  readonly window: "subscription-session" | "router-turn-loop";
  readonly reset: "provider-managed";
  readonly boundedBy: "max-turns" | "max-seconds-and-prompt-scope" | "native-turn-loop";
  readonly defaultMaxTurns?: number;
  readonly quotaWindows?: readonly DeclaredQuotaWindow[];
}

export interface EndpointCostLinkage {
  readonly inputTokensField:
    | "usage.input_tokens"
    | "usage.prompt_tokens"
    | "usageMetadata.promptTokenCount";
  readonly outputTokensField:
    | "usage.output_tokens"
    | "usage.completion_tokens"
    | "usageMetadata.candidatesTokenCount";
  readonly pricing: "static-price-table" | "static-price-table-or-zero";
}

export interface ExecutorCostLinkage {
  readonly pricing: "subscription-linked" | "router-reported";
  readonly metering: "cli-reported-total-cost-usd" | "estimated-from-cli-usage" | "router-summed-cost-usd";
  readonly costEstimated: boolean;
  readonly subscriptionCost: "included-in-plan-or-zero-wire-cost" | "not-subscription-backed";
}

export interface UnknownLimitSemantics {
  readonly kind: "unknown";
  readonly conservative: true;
  readonly scheduling: "do-not-assume-headroom";
}

export interface UnknownCostLinkage {
  readonly pricing: "unknown";
  readonly metering: "unknown";
  readonly costEstimated: true;
}

export interface ProviderEndpointCapability {
  readonly kind: "provider";
  readonly provider: LLMProvider;
  readonly family: LLMProvider;
  readonly auth: EndpointAuthMode;
  readonly limits: EndpointLimitSemantics;
  readonly cost: EndpointCostLinkage;
}

export interface ExecutorEndpointCapability {
  readonly kind: "executor";
  readonly adapter: ExecutorAdapterName;
  readonly family: LLMProvider | "router-delegated";
  readonly auth: EndpointAuthMode;
  readonly limits: ExecutorLimitSemantics;
  readonly cost: ExecutorCostLinkage;
}

export interface UnknownEndpointCapability {
  readonly kind: "unknown";
  readonly target: string;
  readonly family: "unknown";
  readonly auth: { readonly kind: "unknown" };
  readonly limits: UnknownLimitSemantics;
  readonly cost: UnknownCostLinkage;
  readonly reason: "unrecognized-provider" | "unrecognized-executor-adapter" | "unrecognized-endpoint";
}

export type EndpointCapability =
  | ProviderEndpointCapability
  | ExecutorEndpointCapability
  | UnknownEndpointCapability;

const DEFAULT_MAX_TOKENS = 4096;

const STAGES: readonly Stage[] = ["plan", "code", "review", "judge"];

function isExecutorAdapterName(adapter: string): adapter is ExecutorAdapterName {
  return adapter === "claude-code" || adapter === "codex" || adapter === "native";
}

function executorTarget(target: string | ExecutorEndpointTarget): KnownExecutorEndpointTarget | undefined {
  if (typeof target === "string") {
    switch (target) {
      case "claude-code":
        return { adapter: target, family: "anthropic" };
      case "codex":
        return { adapter: target, family: "openai" };
      case "native":
        return { adapter: target, family: "openai-compat" };
      default:
        return undefined;
    }
  }
  switch (target.adapter) {
    case "claude-code":
      return { adapter: target.adapter, family: "anthropic" };
    case "codex":
      return { adapter: target.adapter, family: "openai" };
    case "native":
      return { adapter: target.adapter, family: target.family };
    default:
      return undefined;
  }
}

export function endpointCapabilityFamily(capability: EndpointCapability | undefined): LLMProvider | undefined {
  switch (capability?.family) {
    case "anthropic":
    case "openai":
    case "gemini":
    case "openai-compat":
      return capability.family;
    case "router-delegated":
    case "unknown":
    case undefined:
      return undefined;
  }
}

function unknownCapability(
  target: string,
  reason: UnknownEndpointCapability["reason"],
): UnknownEndpointCapability {
  return {
    kind: "unknown",
    target,
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
    reason,
  };
}

function describeExecutorCapability(target: KnownExecutorEndpointTarget): ExecutorEndpointCapability {
  switch (target.adapter) {
    case "claude-code":
      return {
        kind: "executor",
        adapter: "claude-code",
        family: target.family,
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
          quotaWindows: SUBSCRIPTION_QUOTA_WINDOWS,
        },
        cost: {
          pricing: "subscription-linked",
          metering: "cli-reported-total-cost-usd",
          costEstimated: false,
          subscriptionCost: "included-in-plan-or-zero-wire-cost",
        },
      };
    case "codex":
      return {
        kind: "executor",
        adapter: "codex",
        family: target.family,
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
          quotaWindows: SUBSCRIPTION_QUOTA_WINDOWS,
        },
        cost: {
          pricing: "subscription-linked",
          metering: "estimated-from-cli-usage",
          costEstimated: true,
          subscriptionCost: "included-in-plan-or-zero-wire-cost",
        },
      };
    case "native":
      return {
        kind: "executor",
        adapter: "native",
        family: target.family,
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
      };
  }
}

export function describeEndpointCapability(
  target: EndpointCapabilityTarget | ExecutorEndpointTarget | string,
): EndpointCapability {
  if (typeof target !== "string" && !isExecutorAdapterName(target.adapter)) {
    return unknownCapability(target.adapter, "unrecognized-executor-adapter");
  }

  const executor = executorTarget(target);
  if (executor) return describeExecutorCapability(executor);

  const provider = target;
  switch (provider) {
    case "anthropic":
      return {
        kind: "provider",
        provider,
        family: "anthropic",
        auth: { kind: "api-key", requiredEnv: "ANTHROPIC_API_KEY", header: "x-api-key" },
        limits: { requestField: "max_tokens", defaultMaxTokens: DEFAULT_MAX_TOKENS },
        cost: {
          inputTokensField: "usage.input_tokens",
          outputTokensField: "usage.output_tokens",
          pricing: "static-price-table",
        },
      };
    case "openai":
      return {
        kind: "provider",
        provider,
        family: "openai",
        auth: { kind: "api-key", requiredEnv: "OPENAI_API_KEY", header: "authorization" },
        limits: { requestField: "max_completion_tokens", defaultMaxTokens: DEFAULT_MAX_TOKENS },
        cost: {
          inputTokensField: "usage.prompt_tokens",
          outputTokensField: "usage.completion_tokens",
          pricing: "static-price-table",
        },
      };
    case "gemini":
      return {
        kind: "provider",
        provider,
        family: "gemini",
        auth: { kind: "api-key", requiredEnv: "GEMINI_API_KEY", header: "x-goog-api-key" },
        limits: { requestField: "maxOutputTokens", defaultMaxTokens: DEFAULT_MAX_TOKENS },
        cost: {
          inputTokensField: "usageMetadata.promptTokenCount",
          outputTokensField: "usageMetadata.candidatesTokenCount",
          pricing: "static-price-table",
        },
      };
    case "openai-compat":
      return {
        kind: "provider",
        provider,
        family: "openai-compat",
        auth: { kind: "optional-api-key", optionalEnv: "OPENAI_COMPAT_API_KEY", header: "authorization" },
        limits: { requestField: "max_tokens", defaultMaxTokens: DEFAULT_MAX_TOKENS },
        cost: {
          inputTokensField: "usage.prompt_tokens",
          outputTokensField: "usage.completion_tokens",
          pricing: "static-price-table-or-zero",
        },
      };
  }
  return unknownCapability(String(provider), "unrecognized-endpoint");
}

export interface ResolveEndpointCapabilitiesInput {
  readonly routing: RoutingPolicy;
  readonly executor?: {
    readonly adapter: string;
    readonly family: LLMProvider;
  };
}

export type ResolvedEndpointCapabilities = Record<Stage, readonly EndpointCapability[]>;

export function resolveEndpointCapabilities(
  input: RoutingPolicy | ResolveEndpointCapabilitiesInput | Pick<TaskSpec, "routing" | "executor">,
): ResolvedEndpointCapabilities {
  const routing = "stages" in input ? input : input.routing;
  const executor = "stages" in input ? undefined : input.executor;
  const resolved = {} as Record<Stage, EndpointCapability[]>;

  for (const stage of STAGES) {
    if (stage === "code" && executor) {
      resolved[stage] = [describeEndpointCapability({ adapter: executor.adapter, family: executor.family })];
      continue;
    }

    resolved[stage] = [
      describeEndpointCapability(String(routing.stages[stage].provider)),
      ...(routing.failover?.[stage] ?? []).map((choice) => describeEndpointCapability(String(choice.provider))),
    ];
  }

  return resolved;
}
