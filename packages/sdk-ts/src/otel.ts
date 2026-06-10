/**
 * OTel emission (WP-105) — span names/attributes per observability.md.
 *
 * Uses only @opentelemetry/api: the SDK ships no exporter or provider.
 * Teams configure their own OTLP pipeline (`OTEL_EXPORTER_OTLP_ENDPOINT`)
 * and keep their existing stack (RT-7); with no provider registered the
 * API no-ops at zero cost.
 */
import { SpanStatusCode, trace, type Tracer } from "@opentelemetry/api";

import type { LLMCallResult, RouterError, Stage } from "./types.js";

export const TRACER_NAME = "chikory";
export const SPAN_LLM_CALL = "chikory.llm.call";

export function getTracer(): Tracer {
  return trace.getTracer(TRACER_NAME);
}

export interface LLMCallSpanInput {
  stage: Stage;
  result: LLMCallResult | RouterError;
  /** Total provider calls made (retries + failover + schema re-asks). */
  attempts: number;
  latencyMs: number;
}

/**
 * One span per Router.complete() — attrs per observability.md:
 * stage, provider, model, tokens, cost, latency, retries, outcome.
 * Context propagates from the caller's active span (runner step span),
 * so all calls of a run share one trace.
 */
export function recordLLMCallSpan(input: LLMCallSpanInput): void {
  const span = getTracer().startSpan(SPAN_LLM_CALL, {
    startTime: Date.now() - input.latencyMs,
  });
  span.setAttribute("stage", input.stage);
  span.setAttribute("retry.count", input.attempts - 1);
  span.setAttribute("latency.ms", input.latencyMs);
  span.setAttribute("outcome", input.result.status);
  if (input.result.status === "SUCCESS") {
    span.setAttribute("provider", input.result.provider);
    span.setAttribute("model", input.result.model);
    span.setAttribute("tokens.input", input.result.tokens.input);
    span.setAttribute("tokens.output", input.result.tokens.output);
    span.setAttribute("cost.usd", input.result.costUsd);
  } else {
    if (input.result.provider) span.setAttribute("provider", input.result.provider);
    span.setAttribute("error.reason", input.result.reason);
    span.setAttribute("error.retriable", input.result.retriable);
    span.setStatus({ code: SpanStatusCode.ERROR, message: input.result.reason });
  }
  span.end();
}
