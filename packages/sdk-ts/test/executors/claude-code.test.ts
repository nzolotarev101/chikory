/**
 * Claude Code adapter (WP-112): conformance via the fake CLI (transport-level
 * fake — wire format only), plus parser units against a real captured result
 * event, plus a gated @e2e block that drives the REAL `claude` binary through
 * the 3-step toy task (no LLM mocks — CLAUDE.md rule). Run e2e locally with:
 *   CHIKORY_E2E_CLAUDE=1 devbox run -- pnpm --filter @chikory/sdk test
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createClaudeCodeAdapter, parseClaudeCodeOutput } from "../../src/executors/claude-code.js";
import { StepRecordSchema } from "../../src/schemas.js";
import {
  executorConformanceSuite,
  makeStepInput,
  makeWorkspace,
  TOY_STEPS,
  type Scenario,
} from "./conformance.js";

const FAKE_BIN = fileURLToPath(new URL("./fake-bins/fake-cli.cjs", import.meta.url));

function fakeEnv(scenario: Scenario): Record<string, string | undefined> {
  return {
    ...process.env,
    FAKE_DIALECT: "claude",
    FAKE_MODE: scenario.startsWith("hang") ? "hang" : scenario,
    FAKE_TRAP_TERM: scenario === "hang-trap-term" ? "1" : undefined,
    FAKE_SPAWN_GRANDCHILD: scenario === "hang-grandchild" ? "1" : undefined,
  };
}

executorConformanceSuite({
  label: "claude-code (fake wire)",
  make: ({ store, scenario, killGraceMs }) =>
    createClaudeCodeAdapter({ store, binPath: FAKE_BIN, env: fakeEnv(scenario), killGraceMs }),
});

describe("parseClaudeCodeOutput", () => {
  // Captured verbatim from claude 2.1.170 (fields elided for length only).
  const REAL_RESULT_LINE = JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 1801,
    num_turns: 1,
    result: "pong",
    total_cost_usd: 0.00998195,
    usage: {
      input_tokens: 10,
      cache_creation_input_tokens: 6355,
      cache_read_input_tokens: 12122,
      output_tokens: 58,
    },
  });

  it("extracts summary, exact cost, and total input tokens from the result event", () => {
    const parsed = parseClaudeCodeOutput(undefined)(`{"type":"system"}\n${REAL_RESULT_LINE}\n`);
    expect(parsed.ok).toBe(true);
    expect(parsed.summary).toBe("pong");
    expect(parsed.costUsd).toBeCloseTo(0.00998195, 10);
    expect(parsed.costEstimated).toBe(false);
    expect(parsed.tokens).toEqual({ input: 10 + 6355 + 12122, output: 58 });
  });

  it("counts tool_use blocks across assistant events", () => {
    const lines = [
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use" }, { type: "text" }, { type: "tool_use" }] },
      }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use" }] } }),
      REAL_RESULT_LINE,
    ].join("\n");
    expect(parseClaudeCodeOutput(undefined)(lines).toolCalls).toBe(3);
  });

  it("treats error_max_turns as a successful bounded invocation", () => {
    const parsed = parseClaudeCodeOutput(undefined)(
      JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: false, result: "partial" }),
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.costEstimated).toBe(true); // no total_cost_usd on this event
  });

  it("fails on error subtypes and on missing result event", () => {
    const errored = parseClaudeCodeOutput(undefined)(
      JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, result: "bad" }),
    );
    expect(errored.ok).toBe(false);
    expect(errored.failure?.reason).toContain("error_during_execution");
    const empty = parseClaudeCodeOutput(undefined)("not json at all\n");
    expect(empty.ok).toBe(false);
    expect(empty.failure?.reason).toContain("no result event");
  });

  it("recovers partial usage from assistant turns when killed before the result event (WP-255)", () => {
    const stream = [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use" }],
          usage: { input_tokens: 100, cache_read_input_tokens: 50, output_tokens: 20 },
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text" }],
          usage: { input_tokens: 300, cache_read_input_tokens: 200, output_tokens: 40 },
        },
      }),
      // no `result` event — the step was killed mid-run
    ].join("\n");

    const recovered = parseClaudeCodeOutput("claude-haiku-4-5-20251001")(stream);
    expect(recovered.ok).toBe(false);
    // last assistant turn: 300 + 200 input, 40 output — NOT a misleading 0/0
    expect(recovered.tokens).toEqual({ input: 500, output: 40 });
    expect(recovered.costUsd).toBeGreaterThan(0); // priced from the table
    expect(recovered.costEstimated).toBe(true);
    expect(recovered.failure?.reason).toContain("partial usage recovered from 2 assistant turns");

    // with no model the tokens still flow through, cost stays 0 (nothing to price against)
    const noModel = parseClaudeCodeOutput(undefined)(stream);
    expect(noModel.tokens).toEqual({ input: 500, output: 40 });
    expect(noModel.costUsd).toBe(0);
  });
});

describe("claude-code adapter on error-result wire", () => {
  it("normalizes an in-band agent error to FAILED", async () => {
    const ws = await makeWorkspace();
    const adapter = createClaudeCodeAdapter({
      store: ws.store,
      binPath: FAKE_BIN,
      env: { ...process.env, FAKE_DIALECT: "claude", FAKE_MODE: "error-result" },
    });
    const record = await adapter.runStep(makeStepInput(ws, TOY_STEPS[0].instruction, 30));
    StepRecordSchema.parse(record);
    expect(record.status).toBe("FAILED");
    expect(record.failure?.reason).toContain("error_during_execution");
  });

  it("keeps a completed turn SUCCESS even when the process exits non-zero (WP-533/F-159)", async () => {
    const ws = await makeWorkspace();
    // The agent finishes its turn cleanly (a `result: success` event) but the
    // process exits 1 — exactly what claude does once Bash is allowed and the
    // agent's own final verification command (a still-red test suite) sets the
    // exit code on a not-yet-green task. The step must NOT be FAILED: the judge,
    // not the raw exit code, gates correctness (dogfood-110 sealed FAILED here
    // even though the judge voted PROCEED).
    const adapter = createClaudeCodeAdapter({
      store: ws.store,
      binPath: FAKE_BIN,
      env: { ...process.env, FAKE_DIALECT: "claude", FAKE_MODE: "ok", FAKE_EXIT_CODE: "1" },
    });
    const record = await adapter.runStep(makeStepInput(ws, TOY_STEPS[0].instruction, 30));
    StepRecordSchema.parse(record);
    expect(record.status).toBe("SUCCESS");
    expect(record.failure).toBeUndefined();
    // the executor's real work landed despite the non-zero process exit
    expect(record.summary).toContain("wrote alpha.txt");
  });
});

// WP-112 acceptance: integration test completes a 3-step toy task with the
// real agent. Gated: costs real tokens and needs a logged-in `claude`.
describe.skipIf(!process.env.CHIKORY_E2E_CLAUDE)("claude-code @e2e (real CLI)", () => {
  it("completes the 3-step toy task", async () => {
    const ws = await makeWorkspace();
    const adapter = createClaudeCodeAdapter({
      store: ws.store,
      model: "claude-haiku-4-5-20251001",
    });
    for (const step of TOY_STEPS) {
      const record = await adapter.runStep(makeStepInput(ws, step.instruction, 240));
      StepRecordSchema.parse(record);
      expect(record.status).toBe("SUCCESS");
      expect(record.costUsd).toBeGreaterThan(0);
      expect(record.costEstimated).toBe(false);
      expect(record.tokens.input).toBeGreaterThan(0);
      const file = await readFile(join(ws.workspaceDir, step.file), "utf8");
      expect(file.trim()).toBe(step.content);
    }
  }, 900_000);
});
