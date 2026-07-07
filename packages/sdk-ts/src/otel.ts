/**
 * OTel emission (WP-105) — span names/attributes per observability.md.
 *
 * Uses only @opentelemetry/api: the SDK ships no exporter or provider.
 * Teams configure their own OTLP pipeline (`OTEL_EXPORTER_OTLP_ENDPOINT`)
 * and keep their existing stack (RT-7); with no provider registered the
 * API no-ops at zero cost.
 */
import { context, SpanStatusCode, trace, type Span, type SpanOptions, type Tracer } from "@opentelemetry/api";

import type {
  Checkpoint,
  JudgeVerdict,
  LLMCallResult,
  RouterError,
  Stage,
  StepRecord,
} from "./types.js";

export const TRACER_NAME = "chikory";
/** observability.md trace tree: root span for one durable run. */
export const SPAN_RUN = "chikory.run";
export const SPAN_LLM_CALL = "chikory.llm.call";
/** observability.md trace tree: one durable-loop span per journaled step. */
export const SPAN_RUN_STEP = "chikory.run.step";
/** observability.md trace tree: one span per durable checkpoint write. */
export const SPAN_CHECKPOINT = "chikory.checkpoint";
/** observability.md trace tree: one span per durable soak re-entry. */
export const SPAN_SOAK = "chikory.soak.reentry";
/** observability.md trace tree: one span per judge pass (WP-134). */
export const SPAN_JUDGE_PASS = "chikory.judge.pass";

export function getTracer(): Tracer {
  return trace.getTracer(TRACER_NAME);
}

const activeRunSpans = new Map<string, Span>();

function ensureRunSpan(runId: string): Span {
  const existing = activeRunSpans.get(runId);
  if (existing) return existing;
  const span = getTracer().startSpan(SPAN_RUN);
  span.setAttribute("run.id", runId);
  activeRunSpans.set(runId, span);
  return span;
}

function startRunChildSpan(runId: string, name: string, options?: SpanOptions): Span {
  const runSpan = ensureRunSpan(runId);
  return getTracer().startSpan(name, options, trace.setSpan(context.active(), runSpan));
}

export interface RunSpanInput {
  runId: string;
}

/** Start the durable run root span from an activity, if it is not active yet. */
export function recordRunStartSpan(input: RunSpanInput): void {
  ensureRunSpan(input.runId);
}

export interface RunEndSpanInput {
  runId: string;
  status: "SUCCESS" | "FAILED" | "CANCELLED";
  reason?: string;
}

/** End the durable run root span from the terminal seal activity. */
export function recordRunEndSpan(input: RunEndSpanInput): void {
  const span = ensureRunSpan(input.runId);
  span.setAttribute("status", input.status);
  if (input.reason !== undefined) span.setAttribute("terminal.reason", input.reason);
  if (input.status !== "SUCCESS") {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: input.reason ?? input.status,
    });
  }
  span.end();
  activeRunSpans.delete(input.runId);
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

export interface RunStepSpanInput {
  runId: string;
  stepIndex: number;
  planItem: string;
  record: StepRecord;
}

/**
 * One span per durable runner step — emitted from activities after the step is
 * journaled, so replay stays deterministic while the run trace carries the
 * same aggregate step telemetry as the journal row.
 */
export function recordRunStepSpan(input: RunStepSpanInput): void {
  const span = startRunChildSpan(input.runId, SPAN_RUN_STEP, {
    startTime: Date.now() - input.record.durationMs,
  });
  span.setAttribute("run.id", input.runId);
  span.setAttribute("step.index", input.stepIndex);
  span.setAttribute("plan.item", input.planItem);
  span.setAttribute("status", input.record.status);
  span.setAttribute("tokens.input", input.record.tokens.input);
  span.setAttribute("tokens.output", input.record.tokens.output);
  span.setAttribute("cost.usd", input.record.costUsd);
  span.setAttribute("cost.estimated", input.record.costEstimated);
  span.setAttribute("duration.ms", input.record.durationMs);
  span.setAttribute("tool.calls", input.record.toolCalls);
  span.setAttribute("artifact.diff.id", input.record.diffRef.id);
  span.setAttribute("artifact.transcript.id", input.record.transcriptRef.id);
  if (input.record.status === "FAILED") {
    span.setAttribute("error.reason", input.record.failure?.reason ?? "step failed");
    span.setAttribute("error.retriable", input.record.failure?.retriable ?? false);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: input.record.failure?.reason ?? "step failed",
    });
  }
  span.end();
}

export interface CheckpointSpanInput {
  runId: string;
  stepIndex: number;
  checkpoint: Checkpoint;
  startedAtMs: number;
}

/**
 * One span per checkpoint write — emitted from activities after the checkpoint
 * is committed and journaled, preserving workflow replay determinism.
 */
export function recordCheckpointSpan(input: CheckpointSpanInput): void {
  const span = startRunChildSpan(input.runId, SPAN_CHECKPOINT, { startTime: input.startedAtMs });
  span.setAttribute("run.id", input.runId);
  span.setAttribute("step", input.stepIndex);
  span.setAttribute("git.commit", Object.values(input.checkpoint.gitCommits)[0] ?? "");
  span.setAttribute("journal.idx", input.checkpoint.journalIdx);
  span.setAttribute("last.good", input.checkpoint.lastGood);
  span.setAttribute("budget.spent.usd", input.checkpoint.budgetSpentUsd);
  span.end();
}

export interface SoakSpanInput {
  runId: string;
  atStep: number;
  sleepMs: number;
  completedReentries: number;
  totalSleptMs: number;
}

/**
 * One span per durable soak re-entry — emitted from the control-event activity
 * when the workflow resumes from its Temporal timer.
 */
export function recordSoakSpan(input: SoakSpanInput): void {
  const span = startRunChildSpan(input.runId, SPAN_SOAK);
  span.setAttribute("run.id", input.runId);
  span.setAttribute("step", input.atStep);
  span.setAttribute("sleepMs", input.sleepMs);
  span.setAttribute("completedReentries", input.completedReentries);
  span.setAttribute("totalSleptMs", input.totalSleptMs);
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
