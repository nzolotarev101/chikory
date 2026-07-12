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

  it("rejects unknown commands and missing flags", async () => {
    expect(await main(["frobnicate"], io())).toBe(1);
    expect(await main(["run", "--tasks", "x"], io())).toBe(1);
    expect(await main(["run", "--tasks", "x", "--adapter", "command"], io())).toBe(1);
  });
});
