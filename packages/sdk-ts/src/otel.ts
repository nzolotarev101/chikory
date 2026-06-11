/**
 * OTel emission (WP-105) — span names/attributes per observability.md.
 *
 * Uses only @opentelemetry/api: the SDK ships no exporter or provider.
 * Teams configure their own OTLP pipeline (`OTEL_EXPORTER_OTLP_ENDPOINT`)
 * and keep their existing stack (RT-7); with no provider registered the
 * API no-ops at zero cost.
 */
import { SpanStatusCode, trace, type Tracer } from "@opentelemetry/api";

import type { JudgeVerdict, LLMCallResult, RouterError, Stage } from "./types.js";

export const TRACER_NAME = "chikory";
export const SPAN_LLM_CALL = "chikory.llm.call";
/** observability.md trace tree: one span per judge pass (WP-134). */
export const SPAN_JUDGE_PASS = "chikory.judge.pass";

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

export interface JudgePassSpanInput {
  runId: string;
  judgeIndex: number;
  atStep: number;
  verdict: JudgeVerdict;
  evidenceBytes: number;
  latencyMs: number;
  /** Run-level judge spend / total spend after this pass (JD-7). */
  judgeCostShare: number;
  /** TaskSpec `judge.maxCostShare`; breach is flagged on the span. */
  maxCostShare?: number;
}

/**
 * One span per judge pass — attrs per observability.md: verdict, per-form
 * pass/fail counts, cost (absolute + share of run spend), evidence size.
 * A non-PROCEED verdict is a *decision*, not an error — span status stays OK.
 */
export function recordJudgePassSpan(input: JudgePassSpanInput): void {
  const span = getTracer().startSpan(SPAN_JUDGE_PASS, {
    startTime: Date.now() - input.latencyMs,
  });
  const { form } = input.verdict;
  span.setAttribute("run.id", input.runId);
  span.setAttribute("judge.index", input.judgeIndex);
  span.setAttribute("step", input.atStep);
  span.setAttribute("verdict", input.verdict.kind);
  span.setAttribute("criteria.passed", form.criterionResults.filter((r) => r.pass).length);
  span.setAttribute("criteria.failed", form.criterionResults.filter((r) => !r.pass).length);
  span.setAttribute("rubric.failed", form.rubricResults.filter((r) => !r.pass).length);
  span.setAttribute("judge.provider", input.verdict.judgeModel.provider);
  span.setAttribute("judge.model", input.verdict.judgeModel.model);
  span.setAttribute("tokens.input", input.verdict.tokens.input);
  span.setAttribute("tokens.output", input.verdict.tokens.output);
  span.setAttribute("cost.usd", input.verdict.costUsd);
  span.setAttribute("cost.share", input.judgeCostShare);
  if (input.maxCostShare !== undefined) {
    span.setAttribute("cost.share.max", input.maxCostShare);
    span.setAttribute("cost.share.breached", input.judgeCostShare > input.maxCostShare);
  }
  span.setAttribute("evidence.bytes", input.evidenceBytes);
  span.setAttribute("latency.ms", input.latencyMs);
  span.end();
}
