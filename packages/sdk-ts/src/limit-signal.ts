import type { EndpointCapability } from "./endpoint-capability.js";

export type RawLimitSignal =
  | {
      readonly kind: "http";
      readonly statusCode: number;
      readonly headers?: Readonly<Record<string, string | readonly string[] | undefined>>;
      readonly body?: string;
    }
  | {
      readonly kind: "cli-stderr";
      readonly stderr: string;
      readonly exitCode?: number | null;
    }
  | {
      readonly kind: "injected";
      readonly reason: string;
      readonly retryAfterMs?: number;
      readonly retryAtMs?: number;
    };

export type LimitSignalSource = "http-429" | "cli-usage-limit" | "injected";

export interface LimitCapabilityDescriptor {
  readonly endpointKind: EndpointCapability["kind"];
  readonly target: string;
  readonly family: EndpointCapability["family"];
  readonly limits: EndpointCapability["limits"];
}

export interface ClassifiedLimitSignal {
  readonly kind: "limit";
  readonly source: LimitSignalSource;
  readonly capability: LimitCapabilityDescriptor;
  readonly reason: string;
  readonly retryAfterMs?: number;
  readonly retryAtMs?: number;
}

export interface ClassifyLimitSignalInput {
  readonly capability: EndpointCapability;
  readonly signal: RawLimitSignal | undefined;
  readonly nowMs?: number;
}

const CLI_LIMIT_RE = /\b(rate|usage|session)\s+limit\b|\blimit\s+(reached|exceeded|hit)\b/i;
const DURATION_RE =
  /\b(?:retry|try again|reset|resets|available|availability)[^\n.]*?\bin\s+((?:(?:\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\s*)+)/i;

function capabilityTarget(capability: EndpointCapability): string {
  switch (capability.kind) {
    case "provider":
      return capability.provider;
    case "executor":
      return capability.adapter;
    case "unknown":
      return capability.target;
  }
}

function describeCapability(capability: EndpointCapability): LimitCapabilityDescriptor {
  return {
    endpointKind: capability.kind,
    target: capabilityTarget(capability),
    family: capability.family,
    limits: capability.limits,
  };
}

function headerValue(
  headers: Readonly<Record<string, string | readonly string[] | undefined>> | undefined,
  name: string,
): string | undefined {
  if (headers === undefined) return undefined;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted || value === undefined) continue;
    return typeof value === "string" ? value : value[0];
  }
  return undefined;
}

function parseRetryAfterMs(value: string | undefined, nowMs: number): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);

  const retryAtMs = Date.parse(trimmed);
  if (!Number.isNaN(retryAtMs)) return Math.max(0, retryAtMs - nowMs);

  return undefined;
}

function parseDurationMs(text: string): number | undefined {
  const match = DURATION_RE.exec(text);
  if (match?.[1] === undefined) return undefined;

  let totalMs = 0;
  const parts = match[1].matchAll(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi);
  for (const part of parts) {
    const amount = Number(part[1]);
    const unit = part[2]?.toLowerCase();
    if (!Number.isFinite(amount) || unit === undefined) continue;
    if (unit.startsWith("h")) totalMs += amount * 60 * 60 * 1000;
    else if (unit.startsWith("m")) totalMs += amount * 60 * 1000;
    else totalMs += amount * 1000;
  }
  return totalMs > 0 ? Math.round(totalMs) : undefined;
}

function withRetryTime<T extends Omit<ClassifiedLimitSignal, "kind">>(
  descriptor: T,
  nowMs: number,
): ClassifiedLimitSignal {
  return {
    kind: "limit",
    ...descriptor,
    ...(descriptor.retryAfterMs === undefined ? {} : { retryAtMs: nowMs + descriptor.retryAfterMs }),
  };
}

export function classifyLimitSignal(input: ClassifyLimitSignalInput): ClassifiedLimitSignal | undefined {
  const { signal } = input;
  if (signal === undefined) return undefined;

  const nowMs = input.nowMs ?? Date.now();
  const capability = describeCapability(input.capability);

  switch (signal.kind) {
    case "http": {
      if (signal.statusCode !== 429) return undefined;
      const retryAfterMs = parseRetryAfterMs(headerValue(signal.headers, "retry-after"), nowMs);
      return withRetryTime(
        {
          source: "http-429",
          capability,
          reason: signal.body?.trim() || "HTTP 429 rate limit",
          retryAfterMs,
        },
        nowMs,
      );
    }
    case "cli-stderr": {
      if (!CLI_LIMIT_RE.test(signal.stderr)) return undefined;
      const retryAfterMs = parseDurationMs(signal.stderr);
      return withRetryTime(
        {
          source: "cli-usage-limit",
          capability,
          reason: signal.stderr.trim(),
          retryAfterMs,
        },
        nowMs,
      );
    }
    case "injected": {
      return {
        kind: "limit",
        source: "injected",
        capability,
        reason: signal.reason,
        ...(signal.retryAfterMs === undefined ? {} : { retryAfterMs: signal.retryAfterMs }),
        ...(signal.retryAtMs === undefined ? {} : { retryAtMs: signal.retryAtMs }),
      };
    }
  }
}
