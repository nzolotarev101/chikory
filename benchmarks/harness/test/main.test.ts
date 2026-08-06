import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

  /**
   * F-259: the canonical `<out>/summary.json` two arms are compared from used to
   * be promoted by hand, with `ls -d <out>/*-chikory | tail -1` — "the newest
   * directory". Run one diagnostic task afterwards and the newest directory is a
   * ONE-task summary, published as the five-task arm. p3-rung-4 had exactly that
   * directory sitting on disk (`20260806-010237-chikory`) when the promote step
   * was due.
   */
  it("run: promotes a canonical summary.json for a full-corpus run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-cli-promote-"));
    writeFileSync(join(dir, "greenfield-002.yaml"), GOOD);
    writeFileSync(join(dir, "greenfield-003.yaml"), GOOD.replace("greenfield-002", "greenfield-003"));
    const results = mkdtempSync(join(tmpdir(), "bench-cli-results-"));
    const o = io();

    expect(
      await main(
        ["run", "--tasks", dir, "--adapter", "command", "--cmd", "touch hi.txt", "--out", results, "--suite", "smoke"],
        o,
      ),
    ).toBe(0);

    const canonical = join(results, "summary.json");
    expect(o.lines.out.join("\n")).toContain(`promoted canonical summary: ${canonical}`);
    const promoted = JSON.parse(readFileSync(canonical, "utf8"));
    expect(promoted.tasks).toBe(2);

    // Byte-faithful to the run's own summary — dogfood-123 publishes verbatim
    // copies and diffs them against this path.
    const runDir = o.lines.out.join("\n").match(/^artifacts: (.+)$/m)![1];
    expect(readFileSync(canonical, "utf8")).toBe(readFileSync(join(runDir, "summary.json"), "utf8"));
  });

  it("run: a filtered subset is a diagnostic and never clobbers the canonical summary", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-cli-filtered-"));
    writeFileSync(join(dir, "greenfield-002.yaml"), GOOD);
    writeFileSync(join(dir, "greenfield-003.yaml"), GOOD.replace("greenfield-002", "greenfield-003"));
    const results = mkdtempSync(join(tmpdir(), "bench-cli-results-"));

    const full = io();
    await main(
      ["run", "--tasks", dir, "--adapter", "command", "--cmd", "touch hi.txt", "--out", results, "--suite", "smoke"],
      full,
    );
    const afterFullRun = readFileSync(join(results, "summary.json"), "utf8");

    const diagnostic = io();
    expect(
      await main(
        [
          "run", "--tasks", dir, "--adapter", "command", "--cmd", "touch hi.txt",
          "--out", results, "--suite", "smoke", "--filter", "greenfield-003",
        ],
        diagnostic,
      ),
    ).toBe(0);

    expect(diagnostic.lines.out.join("\n")).toContain("NOT promoting a canonical summary: 1 of 2 tasks selected");
    expect(readFileSync(join(results, "summary.json"), "utf8")).toBe(afterFullRun);
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

  it("compare: compares two valid summary.json files and emits Wilson intervals", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-cli-compare-"));
    const makeSummary = (adapter: string, taskIds: string[]) => ({
      suite: "test-suite",
      adapter,
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T01:00:00.000Z",
      tasks: 5,
      tasksVerified: 5,
      unverifiedTasks: [],
      requirementsTotal: 20,
      requirementsSatisfied: 15,
      iSr: 0.75,
      dSr: 0.75,
      perTask: taskIds.map((id) => ({
        taskId: id,
        satisfied: 3,
        dependencySatisfied: 3,
        total: 4,
        exitCode: 0,
        wallClockMs: 100,
        baseVerified: true,
      })),
    });

    const tasks = ["task-1", "task-2", "task-3", "task-4", "task-5"];
    const fileA = join(dir, "summaryA.json");
    const fileB = join(dir, "summaryB.json");
    writeFileSync(fileA, JSON.stringify(makeSummary("chikory", tasks)));
    writeFileSync(fileB, JSON.stringify(makeSummary("command", tasks)));

    const o = io();
    const code = await main(["compare", fileA, fileB], o);
    expect(code).toBe(0);
    const text = o.lines.out.join("\n");
    expect(text).toContain("Arm A (chikory)");
    expect(text).toContain("Arm B (command)");
    expect(text).toContain("I-SR: 75.0% [95% CI: 53.1%, 88.8%]");
    expect(text).toContain("Tasks (5): task-1, task-2, task-3, task-4, task-5");
  });

  it("compare: exits 1 on mismatched or invalid inputs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-cli-compare-bad-"));
    const makeSummary = (taskIds: string[]) => ({
      suite: "test",
      adapter: "chikory",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T01:00:00.000Z",
      tasks: 5,
      tasksVerified: 5,
      unverifiedTasks: [],
      requirementsTotal: 20,
      requirementsSatisfied: 15,
      iSr: 0.75,
      dSr: 0.75,
      perTask: taskIds.map((id) => ({
        taskId: id,
        satisfied: 3,
        dependencySatisfied: 3,
        total: 4,
        exitCode: 0,
        wallClockMs: 100,
        baseVerified: true,
      })),
    });

    const fileA = join(dir, "summaryA.json");
    const fileB = join(dir, "summaryB.json");
    writeFileSync(fileA, JSON.stringify(makeSummary(["t1", "t2", "t3", "t4", "t5"])));
    writeFileSync(fileB, JSON.stringify(makeSummary(["t1", "t2", "t3", "t4", "t999"])));

    const o = io();
    const code = await main(["compare", fileA, fileB], o);
    expect(code).toBe(1);
    expect(o.lines.err.join("\n")).toContain("identical five-task sets");
  });

  it("compare: supports --left, --right, --left-label, --right-label, and --out flags", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-cli-compare-flags-"));
    const makeSummary = (adapter: string, taskIds: string[]) => ({
      suite: "test-suite",
      adapter,
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T01:00:00.000Z",
      tasks: 5,
      tasksVerified: 5,
      unverifiedTasks: [],
      requirementsTotal: 10,
      requirementsSatisfied: 8,
      iSr: 0.8,
      dSr: 0.8,
      perTask: taskIds.map((id) => ({
        taskId: id,
        satisfied: 1,
        dependencySatisfied: 1,
        total: 1,
        exitCode: 0,
        wallClockMs: 100,
        baseVerified: true,
      })),
    });

    const tasks = ["b-1", "b-2", "b-3", "b-4", "b-5"];
    const leftFile = join(dir, "left.json");
    const rightFile = join(dir, "right.json");
    const outFile = join(dir, "out.json");
    writeFileSync(leftFile, JSON.stringify(makeSummary("chikory", tasks)));
    writeFileSync(rightFile, JSON.stringify(makeSummary("command", tasks)));

    const o = io();
    const code = await main(
      [
        "compare",
        "--left",
        leftFile,
        "--right",
        rightFile,
        "--left-label",
        "custom-left",
        "--right-label",
        "custom-right",
        "--out",
        outFile,
      ],
      o,
    );
    expect(code).toBe(0);
    const text = o.lines.out.join("\n");
    expect(text).toContain("Arm A (custom-left)");
    expect(text).toContain("Arm B (custom-right)");

    const outJson = JSON.parse(readFileSync(outFile, "utf8"));
    expect(outJson.taskIds).toEqual(tasks);
    expect(outJson.arms).toHaveLength(2);
    expect(outJson.arms[0].label).toBe("custom-left");
    expect(outJson.arms[1].label).toBe("custom-right");
    expect(outJson.arms[0].iSrRange.low).toBeCloseTo(0.49, 2);
  });

  it("rejects unknown commands and missing flags", async () => {
    expect(await main(["frobnicate"], io())).toBe(1);
    expect(await main(["run", "--tasks", "x"], io())).toBe(1);
    expect(await main(["run", "--tasks", "x", "--adapter", "command"], io())).toBe(1);
  });
});
