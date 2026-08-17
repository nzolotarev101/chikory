/**
 * WP-626 / F-376 — an unobserved tool count must never be published as an OTel
 * measurement, on EITHER span that carries it: `chikory.step` (emitted by
 * `runCliStep`) and `chikory.run.step` (emitted by the durable runner after the
 * step is journaled). dogfood-151 guarded only the first; the second published
 * `tool.calls: 0` for every gemini step until this test pinned it.
 *
 * Both arms drive the real entry point (the adapter over the fake wire), not the
 * private span helper, so a future refactor that stops threading the mark still
 * fails here.
 */
import { fileURLToPath } from "node:url";

import { trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createClaudeCodeAdapter } from "../../src/executors/claude-code.js";
import { createGeminiCliAdapter } from "../../src/executors/gemini-cli.js";
import { SPAN_STEP } from "../../src/executors/step.js";
import { recordRunStepSpan, SPAN_RUN_STEP } from "../../src/otel.js";
import type { StepRecord } from "../../src/types.js";
import { makeStepInput, makeWorkspace } from "./conformance.js";

const FAKE_BIN = fileURLToPath(new URL("./fake-bins/fake-cli.cjs", import.meta.url));
const exporter = new InMemorySpanExporter();

function fakeEnv(dialect: "agy" | "claude"): Record<string, string | undefined> {
  return { ...process.env, FAKE_DIALECT: dialect, FAKE_MODE: "ok" };
}

function attrsOf(spanName: string): Record<string, unknown> {
  const span = exporter.getFinishedSpans().find((s) => s.name === spanName);
  expect(span, `no ${spanName} span was exported`).toBeDefined();
  return span!.attributes as Record<string, unknown>;
}

beforeAll(() => {
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }),
  );
});

beforeEach(() => exporter.reset());

describe("chikory.step span (runCliStep) and the observation mark", () => {
  it("omits tool.calls for an executor that cannot enumerate them", async () => {
    const ws = await makeWorkspace();
    const adapter = createGeminiCliAdapter({
      store: ws.store,
      binPath: FAKE_BIN,
      env: fakeEnv("agy"),
    });
    const record = await adapter.runStep(makeStepInput(ws, "create a file", 30));
    expect(record.toolCallsObserved).toBe(false);
    expect(
      Object.keys(attrsOf(SPAN_STEP)),
      "publishing tool.calls for an unobservable adapter records a constant as an " +
        "empirical measurement — the exact defect WP-626 closes",
    ).not.toContain("tool.calls");
  });

  it("still publishes tool.calls for an executor that CAN enumerate them", async () => {
    const ws = await makeWorkspace();
    const adapter = createClaudeCodeAdapter({
      store: ws.store,
      binPath: FAKE_BIN,
      env: fakeEnv("claude"),
    });
    const record = await adapter.runStep(makeStepInput(ws, "create a file", 30));
    expect(record.toolCallsObserved).toBeUndefined();
    expect(
      attrsOf(SPAN_STEP)["tool.calls"],
      "a real count is real telemetry; suppressing it to make the branch uniform " +
        "destroys information",
    ).toBe(record.toolCalls);
  });
});

describe("chikory.run.step span (durable runner) and the observation mark", () => {
  const base: StepRecord = {
    status: "SUCCESS",
    diffRef: { id: "diff-1", kind: "diff", bytes: 123, summary: "d" },
    summary: "did the work",
    toolCalls: 0,
    tokens: { input: 1200, output: 240 },
    costUsd: 0,
    costEstimated: true,
    durationMs: 42,
    transcriptRef: { id: "t-1", kind: "transcript", bytes: 456, summary: "t" },
  };

  it("omits tool.calls when the count is unobserved", () => {
    recordRunStepSpan({
      runId: "run-f376",
      stepIndex: 0,
      planItem: "p",
      record: { ...base, toolCallsObserved: false },
    });
    expect(
      Object.keys(attrsOf(SPAN_RUN_STEP)),
      "this is the span every durable step emits — it carried `tool.calls: 0` for " +
        "every gemini step in the campaign (F-376)",
    ).not.toContain("tool.calls");
  });

  it("publishes an OBSERVED zero, and an unmarked historical record, unchanged", () => {
    recordRunStepSpan({
      runId: "run-f376-observed",
      stepIndex: 0,
      planItem: "p",
      record: { ...base, toolCallsObserved: true },
    });
    expect(attrsOf(SPAN_RUN_STEP)["tool.calls"]).toBe(0);

    exporter.reset();
    recordRunStepSpan({ runId: "run-f376-legacy", stepIndex: 0, planItem: "p", record: base });
    expect(
      attrsOf(SPAN_RUN_STEP)["tool.calls"],
      "every journal written before WP-626 carries no mark; absent must mean observed",
    ).toBe(0);
  });
});
