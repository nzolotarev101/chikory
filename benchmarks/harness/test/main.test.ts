import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { main } from "../src/main.js";

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return { out: (l: string) => out.push(l), err: (l: string) => err.push(l), lines: { out, err } };
}

const GOOD = `
id: greenfield-002
class: greenfield
status: pinned
goal: |
  Say hi.
requirements:
  - id: R1
    description: hi file
    check: test -f hi.txt
`;

describe("chikory-bench CLI", () => {
  it("validate: exit 0 on a clean dir, exit 1 with per-file issues on a broken one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-cli-"));
    writeFileSync(join(dir, "greenfield-002.yaml"), GOOD);
    const ok = io();
    expect(await main(["validate", dir], ok)).toBe(0);
    expect(ok.lines.out.join()).toContain("1 valid, 0 invalid");

    writeFileSync(join(dir, "bad.yaml"), "status: nonsense\n");
    const bad = io();
    expect(await main(["validate", dir], bad)).toBe(1);
    expect(bad.lines.err.join("\n")).toContain("bad.yaml");
  });

  it("list marks drafts not runnable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-cli-"));
    writeFileSync(join(dir, "greenfield-002.yaml"), GOOD.replace("status: pinned", "status: draft"));
    const o = io();
    expect(await main(["list", dir], o)).toBe(0);
    expect(o.lines.out.join()).toContain("(not runnable)");
  });

  it("run: full path through command adapter with artifacts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-cli-"));
    writeFileSync(join(dir, "greenfield-002.yaml"), GOOD);
    const results = mkdtempSync(join(tmpdir(), "bench-cli-results-"));
    const o = io();
    const code = await main(
      ["run", "--tasks", dir, "--adapter", "command", "--cmd", "touch hi.txt", "--out", results, "--suite", "smoke"],
      o,
    );
    expect(code).toBe(0);
    expect(o.lines.out.join("\n")).toContain("1/1 requirements satisfied");
  });

  it("run --adapter chikory: family preflight REFUSES a wrong-family arm before spending (WP-536)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-cli-"));
    writeFileSync(join(dir, "greenfield-002.yaml"), GOOD);
    const prevOverride = process.env.CHIKORY_BENCH_ALLOW_FAMILY_OVERRIDE;
    delete process.env.CHIKORY_BENCH_ALLOW_FAMILY_OVERRIDE;
    try {
      const o = io();
      // claude-code executor violates "Gemini executes" regardless of the judge
      // proxy — the refuse path returns before any `chikory` process spawns.
      const code = await main(
        ["run", "--tasks", dir, "--adapter", "chikory", "--executor", "claude-code"],
        o,
      );
      expect(code).toBe(1);
      expect(o.lines.out.join("\n")).toContain("bench preflight: executor claude-code(anthropic)");
      expect(o.lines.err.join("\n")).toContain("REFUSING to launch");
      expect(o.lines.err.join("\n")).toContain("executor family is 'anthropic'");
    } finally {
      if (prevOverride === undefined) delete process.env.CHIKORY_BENCH_ALLOW_FAMILY_OVERRIDE;
      else process.env.CHIKORY_BENCH_ALLOW_FAMILY_OVERRIDE = prevOverride;
    }
  });

  it("run --adapter chikory: CHIKORY_BENCH_ALLOW_FAMILY_OVERRIDE=1 bypasses the refuse", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-cli-"));
    writeFileSync(join(dir, "greenfield-002.yaml"), GOOD);
    const prevOverride = process.env.CHIKORY_BENCH_ALLOW_FAMILY_OVERRIDE;
    process.env.CHIKORY_BENCH_ALLOW_FAMILY_OVERRIDE = "1";
    // A bogus bin makes the spawned `chikory run` exit non-zero fast; the point
    // is only that the preflight did NOT short-circuit with exit 1.
    const results = mkdtempSync(join(tmpdir(), "bench-cli-results-"));
    try {
      const o = io();
      const code = await main(
        [
          "run", "--tasks", dir, "--adapter", "chikory", "--executor", "claude-code",
          "--out", results, "--filter", "__none__",
        ],
        o,
      );
      // --filter __none__ selects zero tasks → exit 1 for "no tasks selected",
      // which is a DIFFERENT exit path than the refuse. Assert we got past the
      // preflight banner and never printed REFUSING.
      expect(o.lines.out.join("\n")).toContain("bench preflight: executor claude-code(anthropic)");
      expect(o.lines.err.join("\n")).not.toContain("REFUSING to launch");
      expect(o.lines.err.join("\n")).toContain("no tasks selected");
      expect(code).toBe(1);
    } finally {
      if (prevOverride === undefined) delete process.env.CHIKORY_BENCH_ALLOW_FAMILY_OVERRIDE;
      else process.env.CHIKORY_BENCH_ALLOW_FAMILY_OVERRIDE = prevOverride;
    }
  });

  it("rejects unknown commands and missing flags", async () => {
    expect(await main(["frobnicate"], io())).toBe(1);
    expect(await main(["run", "--tasks", "x"], io())).toBe(1);
    expect(await main(["run", "--tasks", "x", "--adapter", "command"], io())).toBe(1);
  });
});
