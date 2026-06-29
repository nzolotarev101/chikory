/**
 * Codex CLI adapter (WP-113): same conformance suite as WP-112 (executors.md
 * acceptance), parser units against a real captured JSONL tail, and a gated
 * @e2e block driving the REAL `codex` binary. Run e2e locally with:
 *   CHIKORY_E2E_CODEX=1 devbox run -- pnpm --filter @chikory/sdk test
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createCodexAdapter, parseCodexOutput } from "../../src/executors/codex.js";
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
    FAKE_DIALECT: "codex",
    FAKE_MODE: scenario.startsWith("hang") ? "hang" : scenario,
    FAKE_TRAP_TERM: scenario === "hang-trap-term" ? "1" : undefined,
    FAKE_SPAWN_GRANDCHILD: scenario === "hang-grandchild" ? "1" : undefined,
  };
}

executorConformanceSuite({
  label: "codex (fake wire)",
  make: ({ store, scenario, killGraceMs }) =>
    createCodexAdapter({ store, binPath: FAKE_BIN, env: fakeEnv(scenario), killGraceMs }),
});

describe("parseCodexOutput", () => {
  // Captured verbatim from codex-cli 0.128.0.
  const REAL_TAIL = [
    '{"type":"thread.started","thread_id":"019eb28c-4f9d-7a91-bd1c-daa6d682d038"}',
    '{"type":"turn.started"}',
    '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"pong"}}',
    '{"type":"turn.completed","usage":{"input_tokens":14407,"cached_input_tokens":2432,"output_tokens":5,"reasoning_output_tokens":0}}',
  ].join("\n");

  it("extracts summary and tokens; cost is an estimate", () => {
    const parsed = parseCodexOutput(undefined)(REAL_TAIL);
    expect(parsed.ok).toBe(true);
    expect(parsed.summary).toBe("pong");
    expect(parsed.tokens).toEqual({ input: 14407, output: 5 });
    expect(parsed.costEstimated).toBe(true);
    expect(parsed.costUsd).toBe(0); // no model given → no estimate possible
  });

  it("counts non-message items as tool calls", () => {
    const lines = [
      '{"type":"item.completed","item":{"id":"i0","type":"command_execution"}}',
      '{"type":"item.completed","item":{"id":"i1","type":"reasoning"}}',
      '{"type":"item.completed","item":{"id":"i2","type":"patch_apply"}}',
      '{"type":"item.completed","item":{"id":"i3","type":"agent_message","text":"done"}}',
      '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}',
    ].join("\n");
    expect(parseCodexOutput(undefined)(lines).toolCalls).toBe(2);
  });

  it("fails on turn.failed and on missing turn.completed", () => {
    const failed = parseCodexOutput(undefined)(
      '{"type":"turn.failed","error":{"message":"sandbox denied"}}',
    );
    expect(failed.ok).toBe(false);
    expect(failed.failure?.reason).toBe("sandbox denied");
    const truncated = parseCodexOutput(undefined)('{"type":"turn.started"}');
    expect(truncated.ok).toBe(false);
    expect(truncated.failure?.reason).toContain("no turn.completed");
  });
});

// WP-113 acceptance: same conformance bar as WP-112, real binary, gated.
describe.skipIf(!process.env.CHIKORY_E2E_CODEX)("codex @e2e (real CLI)", () => {
  it("completes the 3-step toy task", async () => {
    const ws = await makeWorkspace();
    const adapter = createCodexAdapter({ store: ws.store });
    for (const step of TOY_STEPS) {
      const record = await adapter.runStep(makeStepInput(ws, step.instruction, 240));
      StepRecordSchema.parse(record);
      expect(record.status).toBe("SUCCESS");
      expect(record.costEstimated).toBe(true);
      expect(record.tokens.input).toBeGreaterThan(0);
      const file = await readFile(join(ws.workspaceDir, step.file), "utf8");
      expect(file.trim()).toBe(step.content);
    }
  }, 900_000);
});
