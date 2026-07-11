/**
 * Router telemetry (WP-105) — every complete() emits a `chikory.llm.call`
 * span with the observability.md attribute set. Asserted via an in-memory
 * exporter (the conformance mechanism named in CONTRACTS.md §8).
 */
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  recordCheckpointSpan,
  recordRunEndSpan,
  recordRunStartSpan,
  recordRunStepSpan,
  recordSoakSpan,
  resolveRunRootContext,
  SPAN_CHECKPOINT,
  SPAN_LLM_CALL,
  SPAN_RUN,
  SPAN_RUN_STEP,
  SPAN_SOAK,
} from "../src/otel.js";
import { createRouter } from "../src/router.js";
import type { Checkpoint, RoutingPolicy, StepRecord } from "../src/types.js";

const exporter = new InMemorySpanExporter();
let server: Server;
let url = "";
let mode: "ok" | "rate-limit-once" | "always-500" = "ok";
let hits = 0;

function respond(res: ServerResponse): void {
  hits++;
  if (mode === "always-500" || (mode === "rate-limit-once" && hits === 1)) {
    res.statusCode = mode === "always-500" ? 500 : 429;
    res.end("err");
    return;
  }
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 100, output_tokens: 50 },
    }),
  );
}

beforeAll(async () => {
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
  // Parent propagation needs a context manager — apps get this from their
  // OTel SDK setup (e.g. NodeSDK); tests register one explicitly.
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  server = createServer((req, res) => {
    req.resume();
    req.on("end", () => respond(res));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  trace.disable();
  context.disable();
});

beforeEach(() => {
  exporter.reset();
  hits = 0;
  mode = "ok";
});

const POLICY: RoutingPolicy = {
  stages: {
    plan: { provider: "anthropic", model: "claude-haiku-4-5" },
    code: { provider: "anthropic", model: "claude-haiku-4-5" },
    review: { provider: "anthropic", model: "claude-haiku-4-5" },
    judge: { provider: "anthropic", model: "claude-haiku-4-5" },
  },
};

function makeRouter() {
  return createRouter(POLICY, {
    env: { ANTHROPIC_API_KEY: "k" },
    baseUrls: { anthropic: url },
    retry: { baseDelayMs: 1, jitter: false, maxAttempts: 2 },
  });
}

describe("OTel spans (WP-105)", () => {
  it("derives a stable well-formed run root context from runId", () => {
    const first = resolveRunRootContext("run-root-context-test");
    const second = resolveRunRootContext("run-root-context-test");

    expect(second).toEqual(first);
    expect(first.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(first.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(first.traceId).not.toBe("00000000000000000000000000000000");
    expect(first.spanId).not.toBe("0000000000000000");
  });

  it("derives distinct root contexts for distinct runIds", () => {
    const first = resolveRunRootContext("run-root-context-test-a");
    const second = resolveRunRootContext("run-root-context-test-b");

    expect(second.traceId).not.toBe(first.traceId);
    expect(second.spanId).not.toBe(first.spanId);
  });

  it("run root start/end spans use the derived durable root identity", () => {
    const rootContext = resolveRunRootContext("run-root-identity-test");

    recordRunStartSpan({ runId: "run-root-identity-test" });
    recordRunEndSpan({ runId: "run-root-identity-test", status: "SUCCESS" });

    const runSpans = exporter.getFinishedSpans().filter((span) => span.name === SPAN_RUN);
    expect(runSpans).toHaveLength(2);
    expect(runSpans.map((span) => span.attributes.lifecycle)).toEqual(["start", "end"]);
    for (const span of runSpans) {
      expect(span.attributes["run.id"]).toBe("run-root-identity-test");
      expect(span.spanContext().traceId).toBe(rootContext.traceId);
      expect(span.spanContext().spanId).toBe(rootContext.spanId);
      expect(span.parentSpanContext).toBeUndefined();
    }
  });

  it("terminal root span measures the run's wall-clock lifetime (F-118)", () => {
    const startedAtMs = Date.now() - 5_000;
    recordRunEndSpan({ runId: "run-duration-test", status: "SUCCESS", startedAtMs });

    const spans = exporter.getFinishedSpans().filter((span) => span.name === SPAN_RUN);
    expect(spans).toHaveLength(1);
    const span = spans[0]!;
    // hrTime → ms: the span opened at the run row's started_at, so its
    // duration covers the whole run (parks and soaks included).
    const durationMs = span.duration[0] * 1000 + span.duration[1] / 1e6;
    expect(durationMs).toBeGreaterThanOrEqual(4_900);
    expect(span.attributes["run.duration.ms"]).toBeGreaterThanOrEqual(4_900);
    expect(span.attributes["lifecycle"]).toBe("end");
  });

  it("run step emits chikory.run.step with durable-loop attributes", () => {
    const record: StepRecord = {
      status: "SUCCESS",
      diffRef: { id: "diff-1", kind: "diff", bytes: 123, summary: "step diff" },
      summary: "changed one file",
      toolCalls: 3,
      tokens: { input: 1200, output: 240 },
      costUsd: 0.0123,
      costEstimated: true,
      durationMs: 42,
      transcriptRef: {
        id: "transcript-1",
        kind: "transcript",
        bytes: 456,
        summary: "step transcript",
      },
    };

    recordRunStepSpan({
      runId: "run-otel-test",
      stepIndex: 2,
      planItem: "add telemetry",
      record,
    });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span.name).toBe(SPAN_RUN_STEP);
    expect(span.attributes).toMatchObject({
      "run.id": "run-otel-test",
      "step.index": 2,
      "plan.item": "add telemetry",
      status: "SUCCESS",
      "tokens.input": 1200,
      "tokens.output": 240,
      "cost.usd": 0.0123,
      "cost.estimated": true,
      "duration.ms": 42,
      "tool.calls": 3,
      "artifact.diff.id": "diff-1",
      "artifact.transcript.id": "transcript-1",
    });
    recordRunEndSpan({ runId: "run-otel-test", status: "SUCCESS" });
  });

  it("checkpoint emits chikory.checkpoint with durable checkpoint attributes", () => {
    const checkpoint: Checkpoint = {
      id: "run-otel-test@7",
      journalIdx: 7,
      gitCommits: { "file:///repo": "abc123" },
      contextSnapshotRef: {
        id: "snapshot-1",
        kind: "context_snapshot",
        bytes: 789,
        summary: "context snapshot",
      },
      budgetSpentUsd: 0.045,
      lastGood: true,
    };

    recordCheckpointSpan({
      runId: "run-otel-test",
      stepIndex: 3,
      checkpoint,
      startedAtMs: Date.now() - 25,
    });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span.name).toBe(SPAN_CHECKPOINT);
    expect(span.attributes).toMatchObject({
      "run.id": "run-otel-test",
      step: 3,
      "git.commit": "abc123",
      "repo.count": 1,
      "repo.refs": ["file:///repo:abc123"],
      "repo.0.name": "file:///repo",
      "repo.0.git.commit": "abc123",
      "journal.idx": 7,
      "last.good": true,
      "budget.spent.usd": 0.045,
    });
    recordRunEndSpan({ runId: "run-otel-test", status: "SUCCESS" });
  });

  it("checkpoint span carries repo count and per-repo commit refs", () => {
    const checkpoint: Checkpoint = {
      id: "run-otel-test@8",
      journalIdx: 8,
      gitCommits: {
        "service-api": "1111111111111111111111111111111111111111",
        "service-worker": "2222222222222222222222222222222222222222",
      },
      contextSnapshotRef: {
        id: "snapshot-2",
        kind: "context_snapshot",
        bytes: 987,
        summary: "context snapshot",
      },
      budgetSpentUsd: 0.067,
      lastGood: false,
    };

    recordCheckpointSpan({
      runId: "run-otel-test",
      stepIndex: 4,
      checkpoint,
      startedAtMs: Date.now() - 25,
    });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span.name).toBe(SPAN_CHECKPOINT);
    expect(span.attributes).toMatchObject({
      "run.id": "run-otel-test",
      step: 4,
      "git.commit": "1111111111111111111111111111111111111111",
      "repo.count": 2,
      "repo.refs": [
        "service-api:1111111111111111111111111111111111111111",
        "service-worker:2222222222222222222222222222222222222222",
      ],
      "repo.0.name": "service-api",
      "repo.0.git.commit": "1111111111111111111111111111111111111111",
      "repo.1.name": "service-worker",
      "repo.1.git.commit": "2222222222222222222222222222222222222222",
      "journal.idx": 8,
      "last.good": false,
      "budget.spent.usd": 0.067,
    });
    recordRunEndSpan({ runId: "run-otel-test", status: "SUCCESS" });
  });

  it("soak re-entry emits chikory.soak.reentry with timer counters", () => {
    recordSoakSpan({
      runId: "run-otel-test",
      atStep: 4,
      sleepMs: 1_200,
      completedReentries: 2,
      totalSleptMs: 2_400,
    });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span.name).toBe(SPAN_SOAK);
    expect(span.attributes).toMatchObject({
      "run.id": "run-otel-test",
      step: 4,
      sleepMs: 1_200,
      completedReentries: 2,
      totalSleptMs: 2_400,
    });
    recordRunEndSpan({ runId: "run-otel-test", status: "SUCCESS" });
  });

  it("parents durable-loop spans under the run root via OTel context", () => {
    const rootContext = resolveRunRootContext("run-tree-test");
    const record: StepRecord = {
      status: "SUCCESS",
      diffRef: { id: "diff-1", kind: "diff", bytes: 123, summary: "step diff" },
      summary: "changed one file",
      toolCalls: 3,
      tokens: { input: 1200, output: 240 },
      costUsd: 0.0123,
      costEstimated: true,
      durationMs: 42,
      transcriptRef: {
        id: "transcript-1",
        kind: "transcript",
        bytes: 456,
        summary: "step transcript",
      },
    };
    const checkpoint: Checkpoint = {
      id: "run-tree-test@7",
      journalIdx: 7,
      gitCommits: { "file:///repo": "abc123" },
      contextSnapshotRef: {
        id: "snapshot-1",
        kind: "context_snapshot",
        bytes: 789,
        summary: "context snapshot",
      },
      budgetSpentUsd: 0.045,
      lastGood: true,
    };

    recordRunStepSpan({
      runId: "run-tree-test",
      stepIndex: 2,
      planItem: "add telemetry",
      record,
    });
    recordCheckpointSpan({
      runId: "run-tree-test",
      stepIndex: 2,
      checkpoint,
      startedAtMs: Date.now() - 25,
    });
    recordSoakSpan({
      runId: "run-tree-test",
      atStep: 3,
      sleepMs: 1_200,
      completedReentries: 1,
      totalSleptMs: 1_200,
    });
    recordRunEndSpan({ runId: "run-tree-test", status: "SUCCESS" });

    const spans = exporter.getFinishedSpans();
    const runSpan = spans.find((s) => s.name === SPAN_RUN)!;
    const durableSpans = spans.filter((s) =>
      [SPAN_RUN_STEP, SPAN_CHECKPOINT, SPAN_SOAK].includes(s.name),
    );
    expect(durableSpans).toHaveLength(3);
    expect(runSpan.attributes).toMatchObject({
      "run.id": "run-tree-test",
      lifecycle: "end",
      status: "SUCCESS",
    });
    expect(runSpan.spanContext().traceId).toBe(rootContext.traceId);
    expect(runSpan.spanContext().spanId).toBe(rootContext.spanId);
    expect(runSpan.parentSpanContext).toBeUndefined();
    for (const span of durableSpans) {
      expect(span.spanContext().traceId).toBe(rootContext.traceId);
      expect(span.parentSpanContext?.spanId).toBe(rootContext.spanId);
    }
  });

  it("SUCCESS call emits chikory.llm.call with full attribute set", async () => {
    const result = await makeRouter().complete({
      stage: "judge",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.status).toBe("SUCCESS");

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span.name).toBe(SPAN_LLM_CALL);
    expect(span.attributes).toMatchObject({
      stage: "judge",
      provider: "anthropic",
      model: "claude-haiku-4-5",
      "tokens.input": 100,
      "tokens.output": 50,
      "retry.count": 0,
      outcome: "SUCCESS",
    });
    // $1/MTok in + $5/MTok out for haiku.
    expect(span.attributes["cost.usd"]).toBeCloseTo((100 * 1 + 50 * 5) / 1_000_000, 12);
    expect(span.attributes["latency.ms"]).toBeGreaterThanOrEqual(0);
  });

  it("retries are visible as retry.count", async () => {
    mode = "rate-limit-once";
    await makeRouter().complete({ stage: "code", messages: [{ role: "user", content: "hi" }] });
    const span = exporter.getFinishedSpans()[0];
    expect(span.attributes["retry.count"]).toBe(1);
    expect(span.attributes.outcome).toBe("SUCCESS");
  });

  it("FAILED call emits error span with reason + retriable", async () => {
    mode = "always-500";
    const result = await makeRouter().complete({
      stage: "plan",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.status).toBe("FAILED");
    const span = exporter.getFinishedSpans()[0];
    expect(span.attributes).toMatchObject({
      stage: "plan",
      provider: "anthropic",
      outcome: "FAILED",
      "error.retriable": true,
      "retry.count": 1,
    });
    expect(String(span.attributes["error.reason"])).toMatch(/500/);
    expect(span.status.code).toBe(2); // SpanStatusCode.ERROR
  });

  it("span joins the caller's active trace (one trace per run)", async () => {
    const tracer = trace.getTracer("test-runner");
    await tracer.startActiveSpan("chikory.step", async (stepSpan) => {
      await makeRouter().complete({ stage: "code", messages: [{ role: "user", content: "hi" }] });
      stepSpan.end();
    });
    const spans = exporter.getFinishedSpans();
    const llmSpan = spans.find((s) => s.name === SPAN_LLM_CALL)!;
    const stepSpan = spans.find((s) => s.name === "chikory.step")!;
    expect(llmSpan.spanContext().traceId).toBe(stepSpan.spanContext().traceId);
    expect(llmSpan.parentSpanContext?.spanId).toBe(stepSpan.spanContext().spanId);
  });
});
