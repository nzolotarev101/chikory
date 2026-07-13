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

## Endpoint capability model (WP-307)

The router owns model choice, but scheduling and validation need to reason about
the **effective endpoint** behind each stage. `endpoint-capability.ts` keeps that
as pure data:

| Function | Purpose |
|---|---|
| `describeEndpointCapability(target)` | Describes one provider or executor adapter with no env reads, network calls, or adapter construction. |
| `resolveEndpointCapabilities(input)` | Expands a `RoutingPolicy` or parsed `TaskSpec` into per-stage endpoint descriptors, including failover choices. |
| `endpointCapabilityFamily(capability)` | Extracts the structural family used for judge/executor diversity checks. |

Capability descriptors cover:

- **Provider endpoints**: `anthropic`, `openai`, `gemini`, and
  `openai-compat`, including auth mode, request-token field, token-usage fields,
  and pricing-table linkage.
- **Executor endpoints**: `claude-code`, `codex`, and `native`. For parsed
  `TaskSpec` input, the `code` stage resolves through `executor.adapter`, not
  merely `routing.stages.code.provider`, because CLI executors are the real
  endpoint for coding work.
- **Unknown endpoints**: unrecognized providers/adapters resolve to conservative
  `unknown` descriptors instead of throwing, so trace and validation callers can
  remain total.

Current consumers:

- Task-spec validation compares judge and executor families from resolved
  capabilities, so stale `executor.family` / `judge.family` labels cannot hide a
  same-family pairing.
- `decideLimitResponse` is the pure work-conserving scheduler for classified
  limit signals. It reads the resolved WP-307 capabilities, orders legal
  declared failover for the throttled stage first, then later-stage
  limit-independent work, then `park-until-reset` as the final fallback. The
  same-family judge/executor invariant still applies when considering headroom,
  so a limit response never "solves" capacity by violating family separation.
- `prepareRun` journals one replay-safe `capability` row at run start; `chikory
  trace` renders an `endpoints plan ... · code ... · review ... · judge ...`
  line only when that row exists. Older journals stay readable without the line.
- `executeStep` consumes the scheduler when `CHIKORY_LIMIT_AT_STEP` injects a
  code-stage limit in tests/dogfood. The activity journals a replay-safe
  `limit_signal` row with the classified signal, full scheduler plan, and chosen
  response, then applies that chosen response through the executor-side
  `applyLimitResponse` helper. Declared failover re-dispatches the real executor
  through the selected failover target; limit-independent work runs a later legal
  target and journals both `executedPlanItem` and `deferredPlanItem`; park
  responses return an internal workflow timer request instead of sleeping inside
  the activity.
- The workflow treats a `deferredPlanItem` as real conservation, not completion
  of the throttled item. In bounded work-unit runs, a limit-independent step does
  not consume the active chunk or trigger chunk-success judging; the original
  chunk must still run and be judged before the run can seal `SUCCESS`.
  `chikory trace` derives `limit-slept` from workflow-side limit resume events
  and derives `conserved` only from executed non-park limit-response step
  payloads. When reset learning has enough per-endpoint observations, the same
  limit summary also renders `learned resets <endpointCapabilityId> <duration>`
  so operators can see which endpoint supplied the park timing without opening
  the raw journal. Limit-free runs render exactly as before.
- `decideLimitPacing` (WP-310) is the proactive twin: before each step the
  workflow reads quota-window burn state (`readQuotaState` merges the
  descriptor's declared `quotaWindows` — rolling-5h and weekly on the
  subscription CLI executors — with the cross-run consumption ledger at
  `<dataDir>/ledger/endpoints.db`) and decides push / steady / throttle
  (durable `source:"pace"` sleep, clamped, never below the TaskSpec `horizon`
  deadline pace) / predict-limit. A predicted limit synthesizes an injected
  signal into the same `classifyLimitSignal → decideLimitResponse →
  applyLimitResponse` path above, so proactive responses inherit failover
  ordering and the family invariant for free. Window capacity is never
  vendor-declared: it is learned from `limit_observations` the WP-309 call
  sites append at real limit hits. Unknown capacity means observe-only —
  the governor never throttles on a guess, and pace-free runs render exactly
  as before.

## Telemetry (WP-105)

Every `complete()` wraps in an OTel span:
`chikory.llm.call` with attrs: `stage`, `provider`, `model`, `tokens.input`, `tokens.output`, `cost.usd`, `latency.ms`, `retry.count`, `outcome`. Exported via standard OTLP env config (`OTEL_EXPORTER_OTLP_ENDPOINT`) so teams keep their existing stack (RT-7). Span context propagates from the runner's step span (one trace per run).

## Testing

- Integration tests hit real providers (CLAUDE.md: no LLM mocks) — small max-token calls, skipped if key absent, tagged `@integration`.
- Retry/failover tests use a local fake **HTTP** server (mocking transport ≠ mocking the LLM layer; the normalization logic is what's under test).
- Conformance suite shared across adapters: same assertions run against all four.

## Non-goals

No prompt templating, no caching layer, no semantic routing/"smart" model selection (P2+ at earliest, only with dogfood evidence). Minimal abstraction rule applies.
