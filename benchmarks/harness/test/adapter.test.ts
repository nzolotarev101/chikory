import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stringify as stringifyYaml } from "yaml";

import { parseTaskSpec } from "@chikory/sdk";

import { buildChikorySpec, commandAdapter } from "../src/adapter.js";
import type { BenchmarkTask } from "../src/task.js";

const BROWNFIELD: BenchmarkTask = {
  id: "brownfield-004",
  source: "authored",
  class: "brownfield",
  status: "pinned",
  goal: "Upgrade the dependency.",
  requirements: [
    { id: "R1", description: "lockfile", prerequisites: [], grading: { kind: "check", command: "test -f lock" } },
    { id: "R2", description: "judged", prerequisites: [], grading: { kind: "judge", criteria: "looks right" } },
  ],
  preferences: [],
  repo: { url: "https://github.com/example/app", ref: "0123456789abcdef0123456789abcdef01234567" },
  tags: [],
  flags: {},
};

describe("commandAdapter", () => {
  it("substitutes placeholders, runs in the workspace, captures the log", async () => {
    const ws = mkdtempSync(join(tmpdir(), "bench-ws-"));
    const out = mkdtempSync(join(tmpdir(), "bench-out-"));
    const adapter = commandAdapter("echo", 'echo "task {taskId}"; cat {goalFile} > produced.txt; pwd');
    const result = await adapter.run(BROWNFIELD, { workspaceDir: ws, outDir: out });
    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(ws, "produced.txt"), "utf8")).toBe("Upgrade the dependency.");
    const log = readFileSync(join(out, "adapter.log"), "utf8");
    expect(log).toContain("task brownfield-004");
  });

  it("reports a timeout", async () => {
    const ws = mkdtempSync(join(tmpdir(), "bench-ws-"));
    const out = mkdtempSync(join(tmpdir(), "bench-out-"));
    const adapter = commandAdapter("sleep", "sleep 30");
    const result = await adapter.run(BROWNFIELD, { workspaceDir: ws, outDir: out, timeoutMs: 200 });
    expect(result.notes).toContain("timed out");
  }, 10_000);
});

describe("buildChikorySpec", () => {
  it("produces YAML the real sdk parseTaskSpec accepts (round-trip freeze)", () => {
    const spec = buildChikorySpec(BROWNFIELD, {}, "/tmp/ws");
    const parsed = parseTaskSpec(stringifyYaml(spec), {
      env: { ANTHROPIC_API_KEY: "x", GEMINI_API_KEY: "x" },
      warn: () => {},
    });
    expect(parsed.name).toBe("bench-brownfield-004");
    expect(parsed.repos[0]).toMatchObject({
      url: "https://github.com/example/app",
      ref: "0123456789abcdef0123456789abcdef01234567",
      writable: true,
    });
    // check-graded requirement → AC with check; judge-graded → check-less AC
    expect(parsed.acceptanceCriteria).toHaveLength(2);
    expect(parsed.acceptanceCriteria[0]!.check).toBe("test -f lock");
    expect(parsed.acceptanceCriteria[1]!.check).toBeUndefined();
    // invariant #2: default judge family differs from executor family
    expect(parsed.judge.family).not.toBe(parsed.executor.family);
  });

  it("greenfield task: the workspace itself becomes the writable repo", () => {
    const green: BenchmarkTask = { ...BROWNFIELD, id: "greenfield-001", class: "greenfield", repo: undefined };
    const spec = buildChikorySpec(green, {}, "/work/space");
    expect((spec.repos as { url: string }[])[0]!.url).toBe("/work/space");
  });
});
