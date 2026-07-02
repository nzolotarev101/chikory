import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { cmdChain } from "../../src/cli/chain.js";

const tempDirs: string[] = [];

// A parse-VALID spec (the guard now runs AFTER parseTaskSpec — WP-262a drift #1)
// whose header comment asks for a single `chikory run`.
const VALID_SINGLE_RUN_SPEC = `# Launch with \`chikory run\`, NOT a chain.
name: launch-mode-test
goal: exercise the launch-mode guard
repos:
  - url: /tmp/chikory-launch-mode-test
    writable: true
acceptance_criteria:
  - id: AC-1
    description: the guard fires before any planning spend
budget_usd: 5
max_steps: 4
executor:
  adapter: scripted
  family: anthropic
judge:
  family: gemini
  cadence: 2
routing:
  stages:
    plan: { provider: anthropic, model: claude-fable-5 }
    code: { provider: anthropic, model: claude-fable-5 }
    review: { provider: anthropic, model: claude-fable-5 }
    judge: { provider: gemini, model: gemini-2.5-pro }
`;

beforeEach(() => {
  // parseTaskSpec validates routed-provider keys against process.env; supply
  // dummies so parse succeeds and the guard is reached. No real call is made:
  // the no-override tests return before router creation, and the override test
  // points the router at a dead localhost endpoint.
  process.env["ANTHROPIC_API_KEY"] = "test-key";
  process.env["GEMINI_API_KEY"] = "test-key";
});

afterEach(async () => {
  delete process.env["CHIKORY_ALLOW_LAUNCH_MODE_MISMATCH"];
  delete process.env["ANTHROPIC_API_KEY"];
  delete process.env["GEMINI_API_KEY"];
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true });
  }
});

async function writeSpec(text: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "chikory-chain-launch-mode-"));
  tempDirs.push(dir);
  const file = join(dir, "task.yaml");
  await writeFile(file, text);
  return file;
}

function capture(): { out: string[]; err: string[]; sink: { out: (l: string) => void; err: (l: string) => void } } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, sink: { out: (l) => out.push(l), err: (l) => err.push(l) } };
}

describe("cmdChain launch-mode guard (WP-261 / WP-262a)", () => {
  it("refuses a parse-valid single-run-authored spec launched as a chain, with a VISIBLE override hint", async () => {
    const file = await writeSpec(VALID_SINGLE_RUN_SPEC);
    const { out, err, sink } = capture();

    const code = await cmdChain(
      { file, watch: false, json: false, dataDir: join(tempDirs[0]!, "data"), address: "127.0.0.1:7233" },
      sink,
    );

    expect(code).toBe(1);
    expect(out).toEqual([]);
    // WP-262a drift #2: BOTH the warning and the override-hint line are emitted.
    expect(err).toHaveLength(2);
    expect(err[0]).toContain("WARNING");
    expect(err[0]).toContain("launch mode mismatch");
    expect(err[0]).toContain("single `chikory run`");
    expect(err[0]).toContain("chikory chain");
    expect(err[1]).toContain("CHIKORY_ALLOW_LAUNCH_MODE_MISMATCH");
    expect(err[1]).toContain("chikory run");
  });

  it("runs the guard AFTER parseTaskSpec: an unparseable single-run spec surfaces the PARSE error, not the guard warning", async () => {
    // WP-262a drift #1: pre-fix the guard ran before the parse, so this spec
    // (single-run marker + invalid body) emitted the mismatch warning. Now the
    // parse failure must win.
    const file = await writeSpec("# Launch with `chikory run`, NOT a chain.\nnot: parsed\n");
    const { err, sink } = capture();

    const code = await cmdChain(
      { file, watch: false, json: false, dataDir: join(tempDirs[0]!, "data"), address: "127.0.0.1:7233" },
      sink,
    );

    expect(code).toBe(1);
    expect(err.join("\n")).not.toContain("launch mode mismatch");
    expect(err.join("\n")).toContain("Invalid task spec");
  });

  it("accepts ANY non-empty CHIKORY_ALLOW_LAUNCH_MODE_MISMATCH (not just \"1\") to bypass the guard", async () => {
    // WP-262a drift #3: the override must not be narrowed to the literal "1".
    process.env["CHIKORY_ALLOW_LAUNCH_MODE_MISMATCH"] = "yes";
    const file = await writeSpec(VALID_SINGLE_RUN_SPEC);
    const { err, sink } = capture();

    const code = await cmdChain(
      { file, watch: false, json: false, dataDir: join(tempDirs[0]!, "data"), address: "127.0.0.1:7233" },
      {
        ...sink,
        // Fail fast on the dead endpoint so we observe that the guard was
        // bypassed (execution reached planning) without a real network call.
        routerOptions: {
          retry: { maxAttempts: 1, baseDelayMs: 0 },
          baseUrls: { anthropic: "http://127.0.0.1:9", gemini: "http://127.0.0.1:9" },
        },
      },
    );

    // Guard bypassed: no mismatch lines. Execution proceeded past the guard into
    // planning, which fails fast against the dead endpoint.
    expect(err.join("\n")).not.toContain("launch mode mismatch");
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("goal decomposition stopped");
  });
});
