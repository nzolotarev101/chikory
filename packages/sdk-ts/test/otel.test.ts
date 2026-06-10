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

import { SPAN_LLM_CALL } from "../src/otel.js";
import { createRouter } from "../src/router.js";
import type { RoutingPolicy } from "../src/types.js";

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
