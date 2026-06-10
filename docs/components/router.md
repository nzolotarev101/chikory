# Component: Router

**Phase**: P1 (lane M1) · **WPs**: WP-101..105 · **Requirements**: RT-1..7, RT-11, CG-1 (normalization), OB-4
**Code**: `packages/sdk-ts/src/router.ts` · **Invariants touched**: #1 (no lock-in), #3 (OTel), #4 (terminal states), #5 (keys via env)

## Purpose

The single vendor-neutral gateway for every LLM call Chikory itself makes (judge, native executor, planning/pacing passes). No business logic may import a provider SDK directly.

## Interface (contract — extends existing `types.ts`)

```ts
export type Stage = "plan" | "code" | "review" | "judge";

export interface RoutingPolicy {
  /** Per-stage model selection. Swapping providers = editing this object only. */
  stages: Record<Stage, { provider: LLMProvider; model: string }>;
  /** Optional ordered failover list per stage. */
  failover?: Partial<Record<Stage, Array<{ provider: LLMProvider; model: string }>>>;
}

export interface CompletionRequest {
  stage: Stage;
  messages: Message[];
  maxTokens?: number;
  temperature?: number;
  /** Structured output schema (JSON) — required by judge form-filling. */
  responseSchema?: object;
}

export interface Router {
  complete(req: CompletionRequest): Promise<LLMCallResult>; // never throws provider errors raw — see Failure policy
}
```

`LLMProvider` gains `"openai-compat"`; `ProviderConfig.baseUrl` already supports it (WP-102).

## Provider adapters (WP-101, WP-102)

- One file per provider: `providers/anthropic.ts`, `providers/openai.ts`, `providers/gemini.ts`, `providers/openai-compat.ts`.
- Each adapter: translate `Message[]` → provider wire format over raw HTTP (uniform transport keeps retry classification and transport-fake testing identical across providers; no provider SDK deps), normalize to `LLMCallResult` with **mandatory** `inputTokens`, `outputTokens`, computed `cost` (static price table, versioned in `pricing.ts`, overridable for open models — unknown models cost $0 unless overridden).
- API keys from env only (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`; openai-compat: `OPENAI_COMPAT_BASE_URL` required, `OPENAI_COMPAT_API_KEY` optional); construction fails fast with a clear message naming the missing var.
- Structured output: native JSON-schema modes on Anthropic (`output_config.format`) and OpenAI (`response_format`); Gemini and openai-compat use the fallback = prompt-embedded schema (+ JSON response mime type on Gemini) + parse-with-retry (1 re-ask, then FAILED). Markdown code fences around JSON are stripped before parsing.

## Failure & retry policy (WP-103)

| Error class | Behavior |
|---|---|
| 429 / 5xx / network timeout | Exponential backoff (base 1s, factor 2, jitter, max 5 attempts) |
| Retries exhausted | If `failover` configured for stage → next provider in list; else return FAILED result |
| 4xx (auth, bad request) | No retry; FAILED immediately with provider message |
| Schema-parse failure | 1 re-ask with error appended; then FAILED |

**Normalization rule (CG-1 / invariant #4):** `complete()` resolves with either a successful `LLMCallResult` or a typed `RouterError { status: "FAILED", reason, retriable, attempts }`. It never leaks raw provider exceptions and never returns an ambiguous state — callers can always branch deterministically.

## Per-stage routing (WP-104)

- `RoutingPolicy` ships in `TaskSpec`; defaults provided (`defaultPolicy(executorFamily)` picks a judge from a *different* family automatically).
- Acceptance test: identical task run under two policies (Anthropic-exec/Gemini-judge vs OpenAI-exec/Anthropic-judge) with **zero code changes** — config diff only.

## Telemetry (WP-105)

Every `complete()` wraps in an OTel span:
`chikory.llm.call` with attrs: `stage`, `provider`, `model`, `tokens.input`, `tokens.output`, `cost.usd`, `latency.ms`, `retry.count`, `outcome`. Exported via standard OTLP env config (`OTEL_EXPORTER_OTLP_ENDPOINT`) so teams keep their existing stack (RT-7). Span context propagates from the runner's step span (one trace per run).

## Testing

- Integration tests hit real providers (CLAUDE.md: no LLM mocks) — small max-token calls, skipped if key absent, tagged `@integration`.
- Retry/failover tests use a local fake **HTTP** server (mocking transport ≠ mocking the LLM layer; the normalization logic is what's under test).
- Conformance suite shared across adapters: same assertions run against all four.

## Non-goals

No prompt templating, no caching layer, no semantic routing/"smart" model selection (P2+ at earliest, only with dogfood evidence). Minimal abstraction rule applies.
