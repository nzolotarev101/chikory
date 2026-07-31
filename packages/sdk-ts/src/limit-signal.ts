import type { EndpointCapability } from "./endpoint-capability.js";

/**
 * F-228 (WP-553): the definition moved to `types.js` when `StepRecord` grew a
 * `limitSignal` field — the contracts file must stay self-contained. Re-exported
 * here so every existing `from "./limit-signal.js"` import keeps working and
 * there is exactly ONE definition.
 */
export type { RawLimitSignal } from "./types.js";
import type { RawLimitSignal } from "./types.js";

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

// F-228: `quota` is the word the Antigravity/Gemini CLI uses — "Individual quota
// reached. Please upgrade your subscription to increase your limits." matched
// none of the original alternatives ("your limits" is not "usage limit", and
// "quota reached" is not "limit reached"), so a real wall was never classified.
const CLI_LIMIT_RE =
  /\b(rate|usage|session|quota)\s+limit\b|\b(limit|quota)\s+(reached|exceeded|exhausted|hit)\b/i;
// F-234: same letter-terminator rule as the per-part scan below — the window
// this captures is what the runner parks for, so a unit letter glued to more
// letters ("5months") must not be read as a unit.
const DURATION_RE =
  /\b(?:retry|try again|reset|resets|available|availability)[^\n.]*?\bin\s+((?:(?:\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)(?![a-z])\s*)+)/i;

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
  // F-234: the terminator must reject a following LETTER ("5months" is not five
  // minutes) while accepting a following DIGIT — a `\b` here did the opposite,
  // and COMPACT durations are exactly what the CLIs emit: `agy`'s "Resets in
  // 1h0m8s" parsed as 8 SECONDS (h→0 and m→8 are both word-char boundaries, so
  // only the trailing "8s" matched). Parking 8s against a 1-hour wall walks
  // straight back into it. Spaced forms ("1h 30m") were unaffected, which is why
  // this survived until a compact one arrived.
  const parts = match[1].matchAll(
    /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)(?![a-z])/gi,
  );
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
