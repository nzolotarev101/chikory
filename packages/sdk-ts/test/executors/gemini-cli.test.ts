/**
 * Gemini CLI adapter (WP-216) — Antigravity (`agy`) print-mode executor. Same
 * conformance suite as WP-112/113, parser units over plain-text output, and a
 * gated @e2e block driving the REAL `agy` binary. Run e2e locally with:
 *   CHIKORY_E2E_GEMINI=1 devbox run -- pnpm --filter @chikory/sdk test
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { describeEndpointCapability } from "../../src/endpoint-capability.js";
import { createGeminiCliAdapter, parseAgyOutput } from "../../src/executors/gemini-cli.js";
import { classifyLimitSignal } from "../../src/limit-signal.js";
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
    FAKE_DIALECT: "agy",
    FAKE_MODE: scenario.startsWith("hang") ? "hang" : scenario,
    FAKE_TRAP_TERM: scenario === "hang-trap-term" ? "1" : undefined,
    FAKE_SPAWN_GRANDCHILD: scenario === "hang-grandchild" ? "1" : undefined,
  };
}

executorConformanceSuite({
  label: "gemini-cli (fake wire)",
  make: ({ store, scenario, killGraceMs }) =>
    createGeminiCliAdapter({ store, binPath: FAKE_BIN, env: fakeEnv(scenario), killGraceMs }),
});

describe("parseAgyOutput", () => {
  it("takes trimmed stdout as the summary; tokens estimated, cost zero", () => {
    const parsed = parseAgyOutput("do the thing")("  wrote foo.txt\n");
    expect(parsed.ok).toBe(true);
    expect(parsed.summary).toBe("wrote foo.txt");
    expect(parsed.toolCalls).toBe(0);
    expect(parsed.costUsd).toBe(0);
    expect(parsed.costEstimated).toBe(true);
    // ~4 chars/token estimate over prompt + output.
    expect(parsed.tokens.input).toBeGreaterThan(0);
    expect(parsed.tokens.output).toBeGreaterThan(0);
  });

  it("fails on empty output (agy produced no response)", () => {
    const parsed = parseAgyOutput("prompt")("   \n");
    expect(parsed.ok).toBe(false);
    expect(parsed.failure?.reason).toContain("no response");
  });
});

describe("agy invocation flags", () => {
  it("passes --print-timeout equal to the step's maxSeconds (F-172)", async () => {
    const ws = await makeWorkspace();
    const adapter = createGeminiCliAdapter({
      store: ws.store,
      binPath: FAKE_BIN,
      env: { ...process.env, FAKE_DIALECT: "agy", FAKE_MODE: "ok", FAKE_ECHO_ARGV: "1" },
    });
    const record = await adapter.runStep(makeStepInput(ws, TOY_STEPS[0].instruction, 840));
    // Without this flag `agy` self-truncates at its 5m default and exits 0, so a
    // 14-minute step contract silently became a 5-minute one.
    expect(record.summary).toContain("--print-timeout 840s");
    expect(record.summary).toContain("--mode accept-edits");
  });
});

describe("quota wall (F-228)", () => {
  it("carries the provider's stderr as a limitSignal the scheduler can classify", async () => {
    const ws = await makeWorkspace();
    const adapter = createGeminiCliAdapter({
      store: ws.store,
      binPath: FAKE_BIN,
      env: { ...process.env, FAKE_DIALECT: "agy", FAKE_MODE: "quota" },
    });
    const record = await adapter.runStep(makeStepInput(ws, TOY_STEPS[0].instruction, 60));

    // Still a FAILED step — the adapter does not get to decide it was a limit.
    expect(record.status).toBe("FAILED");
    StepRecordSchema.parse(record);
    // …but the evidence now travels with it. Before F-228 nothing populated this
    // field, so `rawLimitSignalFromStepRecord` always returned undefined and the
    // park-until-reset scheduler was unreachable outside CHIKORY_LIMIT_AT_STEP.
    expect(record.limitSignal).toMatchObject({ kind: "cli-stderr", exitCode: 1 });
    expect(record.limitSignal).toHaveProperty("stderr", expect.stringContaining("quota reached"));

    // End to end: that raw signal is what the classifier turns into a 1h0m8s park.
    expect(
      classifyLimitSignal({
        capability: describeEndpointCapability({ adapter: "gemini-cli", family: "gemini" }),
        signal: record.limitSignal,
      }),
    ).toMatchObject({ source: "cli-usage-limit", retryAfterMs: 3_608_000 });
  });
});

// WP-216 acceptance: same conformance bar, real binary, gated.
describe.skipIf(!process.env.CHIKORY_E2E_GEMINI)("gemini-cli @e2e (real agy)", () => {
  it("completes the 3-step toy task", async () => {
    const ws = await makeWorkspace();
    const adapter = createGeminiCliAdapter({ store: ws.store });
    for (const step of TOY_STEPS) {
      const record = await adapter.runStep(makeStepInput(ws, step.instruction, 240));
      StepRecordSchema.parse(record);
      expect(record.status).toBe("SUCCESS");
      expect(record.costEstimated).toBe(true);
      const file = await readFile(join(ws.workspaceDir, step.file), "utf8");
      expect(file.trim()).toBe(step.content);
    }
  }, 900_000);
});
