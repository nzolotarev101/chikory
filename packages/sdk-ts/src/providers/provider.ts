/**
 * Internal provider-adapter contract (WP-101) — one file per provider under
 * `providers/`, all normalized to the same request/response shape. The public
 * `Router` (router.ts) owns stage resolution, retries, failover, cost and
 * telemetry; adapters only translate wire formats.
 */
import type { LLMProvider, Message, TokenUsage } from "../types.js";

/** Stage already resolved to a concrete model by the router (WP-104). */
export interface ProviderRequest {
  model: string;
  messages: Message[];
  maxTokens?: number;
  temperature?: number;
  /** JSON Schema for structured output (judge form-filling). */
  responseSchema?: object;
}

export interface ProviderResponse {
  content: string;
  tokens: TokenUsage;
}

export interface ProviderAdapter {
  readonly provider: LLMProvider;
  /** Resolves or throws ProviderCallError — never a raw transport error. */
  complete(req: ProviderRequest): Promise<ProviderResponse>;
}

/** Per-adapter construction options. Keys always come from env (invariant #5). */
export interface AdapterOptions {
  /** Env source — injectable for tests; defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Override the provider endpoint (transport fakes, proxies). */
  baseUrl?: string;
  /** Per-request wall-clock timeout. */
  timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Typed provider failure (CG-1). `retriable` drives the router's policy:
 * 429/5xx/network/timeout retry with backoff; other 4xx fail immediately.
 */
export class ProviderCallError extends Error {
  constructor(
    message: string,
    public readonly retriable: boolean,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "ProviderCallError";
  }
}

export function requireEnv(
  env: Record<string, string | undefined>,
  envVar: string,
  provider: LLMProvider,
): string {
  const value = env[envVar];
  if (!value) {
    throw new Error(
      `Provider '${provider}' is not configured: missing env var ${envVar}. ` +
        `Set ${envVar} before routing to this provider.`,
    );
  }
  return value;
}

/** POST JSON; classify failures into ProviderCallError per router.md table. */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // Network failure or timeout — retriable by definition.
    const reason = err instanceof Error ? err.message : String(err);
    throw new ProviderCallError(`transport error: ${reason}`, true);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const retriable = response.status === 429 || response.status >= 500;
    throw new ProviderCallError(
      `HTTP ${response.status}: ${text.slice(0, 500)}`,
      retriable,
      response.status,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new ProviderCallError("provider returned non-JSON body", true, response.status);
  }
}

/** Split chat history into provider `system` text + non-system turns. */
export function splitSystem(messages: Message[]): {
  system: string | undefined;
  turns: Message[];
} {
  const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content);
  return {
    system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    turns: messages.filter((m) => m.role !== "system"),
  };
}

/**
 * Fallback structured-output instruction for providers without a native
 * JSON-schema mode (router.md: prompt-embedded schema + parse-with-retry).
 */
export function schemaInstruction(schema: object): string {
  return (
    "Respond with a single JSON object that conforms to this JSON Schema. " +
    "Output only the JSON — no prose, no code fences.\n" +
    JSON.stringify(schema)
  );
}

export const DEFAULT_MAX_TOKENS = 4096;
