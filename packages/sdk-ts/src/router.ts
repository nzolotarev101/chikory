/**
 * Vendor-neutral router (WP-103/WP-104/WP-105) — the single gateway for every
 * LLM call Chikory makes (invariant #1). Wraps the provider adapters with:
 *
 *  - per-stage routing from `RoutingPolicy` (swap vendors = config diff, RT-4/5)
 *  - exponential backoff + per-stage failover (router.md failure table)
 *  - normalization to `LLMCallResult | RouterError` — provider exceptions
 *    never escape, callers always branch deterministically (CG-1, invariant #4)
 *  - structured-output parse-with-retry (1 re-ask, then FAILED)
 *  - one `chikory.llm.call` OTel span per complete() (invariant #3)
 */
import type {
  CompletionRequest,
  LLMCallResult,
  LLMProvider,
  Message,
  ModelChoice,
  Router,
  RouterError,
  RoutingPolicy,
} from "./types.js";
import { computeCostUsd, type ModelPricing } from "./pricing.js";
import {
  createAdapter,
  ProviderCallError,
  type ProviderAdapter,
  type ProviderResponse,
} from "./providers/index.js";
import { recordLLMCallSpan } from "./otel.js";

/** Defaults per router.md: base 1s, factor 2, jitter, max 5 attempts. */
export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  factor: number;
  maxDelayMs: number;
  jitter: boolean;
}

const DEFAULT_RETRY: RetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  factor: 2,
  maxDelayMs: 30_000,
  jitter: true,
};

export interface RouterOptions {
  /** Env source for provider keys — injectable for tests. */
  env?: Record<string, string | undefined>;
  /** Per-provider endpoint overrides (transport fakes, proxies). */
  baseUrls?: Partial<Record<LLMProvider, string>>;
  /** Price-table overrides for open models. */
  pricing?: Record<string, ModelPricing>;
  retry?: Partial<RetryPolicy>;
  /** Per-request wall-clock timeout. */
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function backoffDelayMs(attempt: number, retry: RetryPolicy): number {
  const exp = Math.min(retry.baseDelayMs * retry.factor ** (attempt - 1), retry.maxDelayMs);
  return retry.jitter ? exp * (0.5 + Math.random() * 0.5) : exp;
}

/** Tolerant JSON extraction — models occasionally wrap output in fences. */
function parseJsonContent(content: string): { ok: true; text: string } | { ok: false; error: string } {
  let text = content.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text);
  if (fence) text = fence[1];
  try {
    JSON.parse(text);
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function createRouter(policy: RoutingPolicy, opts: RouterOptions = {}): Router {
  const retry: RetryPolicy = { ...DEFAULT_RETRY, ...opts.retry };

  // Eagerly construct one adapter per routed provider — a missing key fails
  // here, at startup, with a message naming the env var (router.md, WP-101).
  const providers = new Set<LLMProvider>();
  for (const choice of Object.values(policy.stages)) providers.add(choice.provider);
  for (const list of Object.values(policy.failover ?? {})) {
    for (const choice of list ?? []) providers.add(choice.provider);
  }
  const adapters = new Map<LLMProvider, ProviderAdapter>();
  for (const provider of providers) {
    adapters.set(
      provider,
      createAdapter(provider, {
        env: opts.env,
        baseUrl: opts.baseUrls?.[provider],
        timeoutMs: opts.timeoutMs,
      }),
    );
  }

  async function completeOnce(
    adapter: ProviderAdapter,
    model: string,
    req: CompletionRequest,
    messages: Message[],
  ): Promise<ProviderResponse> {
    return adapter.complete({
      model,
      messages,
      maxTokens: req.maxTokens,
      temperature: req.temperature,
      responseSchema: req.responseSchema,
    });
  }

  async function completeInner(req: CompletionRequest): Promise<{
    result: LLMCallResult | RouterError;
    attempts: number;
  }> {
    const candidates: ModelChoice[] = [
      policy.stages[req.stage],
      ...(policy.failover?.[req.stage] ?? []),
    ];

    let attempts = 0;
    let lastFailure: RouterError | undefined;

    for (const candidate of candidates) {
      const adapter = adapters.get(candidate.provider);
      if (!adapter) continue; // unreachable — constructed above
      for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) {
        attempts++;
        let response: ProviderResponse;
        try {
          response = await completeOnce(adapter, candidate.model, req, req.messages);
        } catch (err) {
          const failure = err instanceof ProviderCallError ? err : undefined;
          const reason = err instanceof Error ? err.message : String(err);
          if (!failure || !failure.retriable) {
            // 4xx / malformed response — no retry, no failover (router.md).
            return {
              result: {
                status: "FAILED",
                reason,
                retriable: false,
                attempts,
                provider: candidate.provider,
              },
              attempts,
            };
          }
          lastFailure = {
            status: "FAILED",
            reason,
            retriable: true,
            attempts,
            provider: candidate.provider,
          };
          if (attempt < retry.maxAttempts) await sleep(backoffDelayMs(attempt, retry));
          continue;
        }

        // Structured output: parse, one re-ask with the error appended, then FAILED.
        let content = response.content;
        let tokens = response.tokens;
        if (req.responseSchema !== undefined) {
          const first = parseJsonContent(content);
          if (first.ok) {
            content = first.text;
          } else {
            attempts++;
            const reaskMessages: Message[] = [
              ...req.messages,
              { role: "assistant", content: response.content },
              {
                role: "user",
                content:
                  `Your previous response was not valid JSON (${first.error}). ` +
                  "Respond again with only a valid JSON object matching the required schema.",
              },
            ];
            let reask: ProviderResponse;
            try {
              reask = await completeOnce(adapter, candidate.model, req, reaskMessages);
            } catch (err) {
              const reason = err instanceof Error ? err.message : String(err);
              return {
                result: {
                  status: "FAILED",
                  reason: `schema re-ask failed: ${reason}`,
                  retriable: err instanceof ProviderCallError ? err.retriable : false,
                  attempts,
                  provider: candidate.provider,
                },
                attempts,
              };
            }
            tokens = {
              input: tokens.input + reask.tokens.input,
              output: tokens.output + reask.tokens.output,
            };
            const second = parseJsonContent(reask.content);
            if (!second.ok) {
              return {
                result: {
                  status: "FAILED",
                  reason: `structured output is not valid JSON after re-ask: ${second.error}`,
                  retriable: false,
                  attempts,
                  provider: candidate.provider,
                },
                attempts,
              };
            }
            content = second.text;
          }
        }

        return {
          result: {
            status: "SUCCESS",
            content,
            provider: candidate.provider,
            model: candidate.model,
            tokens,
            costUsd: computeCostUsd(candidate.model, tokens, opts.pricing),
          },
          attempts,
        };
      }
      // Retries exhausted for this candidate → next provider in failover list.
    }

    return {
      result: lastFailure ?? {
        status: "FAILED",
        reason: `no provider configured for stage '${req.stage}'`,
        retriable: false,
        attempts,
      },
      attempts,
    };
  }

  return {
    async complete(req: CompletionRequest): Promise<LLMCallResult | RouterError> {
      const startedAt = Date.now();
      const { result, attempts } = await completeInner(req);
      recordLLMCallSpan({
        stage: req.stage,
        result,
        attempts,
        latencyMs: Date.now() - startedAt,
      });
      return result;
    },
  };
}
