import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { commandAdapter } from "../src/adapter.js";
import { loadTaskDir, runSuite } from "../src/suite.js";

const PINNED_YAML = `
id: greenfield-001
class: greenfield
status: pinned
goal: |
  Produce hello.txt containing hello.
requirements:
  - id: R1
    description: hello.txt exists
    check: test -f hello.txt
  - id: R2
    description: hello.txt says hello
    check: grep -q hello hello.txt
    prerequisites: [R1]
`;

const DRAFT_YAML = `
id: brownfield-001
class: brownfield
status: draft
repo: { url: TBD, ref: TBD }
goal: |
  Draft only.
requirements:
  - id: R1
    description: tbd
    check: TBD
`;

const BLOCKED_YAML = `
id: brownfield-002
class: brownfield
status: blocked
blocked_reason: target needs node>=24; devbox provides node v22
repo:
  url: https://github.com/example/app
  ref: 0123456789abcdef0123456789abcdef01234567
goal: |
  Env cannot grade this yet.
requirements:
  - id: R1
    description: suite green
    check: test -f hello.txt
`;

describe("loadTaskDir", () => {
  it("loads authored YAML and DevAI JSON side by side, reports invalid files", () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-dir-"));
    writeFileSync(join(dir, "greenfield-001.yaml"), PINNED_YAML);
    writeFileSync(
      join(dir, "01_task.json"),
      readFileSync(join(import.meta.dirname, "fixtures", "devai-01.json")),
    );
    writeFileSync(join(dir, "broken.yaml"), "id: 42\n");
    writeFileSync(join(dir, "manifest.json"), '{"not": "a task"}'); // must be ignored
    const { tasks, invalid } = loadTaskDir(dir);
    expect(tasks.map((t) => t.source).sort()).toEqual(["authored", "devai"]);
    expect(Object.keys(invalid)).toEqual(["broken.yaml"]);
  });
});

describe("runSuite", () => {
  it("runs, grades, and writes per-task + summary artifacts; drafts are skipped", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-suite-"));
    writeFileSync(join(dir, "greenfield-001.yaml"), PINNED_YAML);
    writeFileSync(join(dir, "brownfield-001.yaml"), DRAFT_YAML);
    const { tasks, invalid } = loadTaskDir(dir);
    expect(invalid).toEqual({});

    const resultsDir = mkdtempSync(join(tmpdir(), "bench-results-"));
    const lines: string[] = [];
    const { summary, outDir } = await runSuite({
      suite: "unit",
      tasks,
      adapter: commandAdapter("solver", "echo hello > hello.txt"),
      resultsDir,
      log: (l) => lines.push(l),
    });

    expect(summary.tasks).toBe(1); // draft skipped
    expect(summary.requirementsTotal).toBe(2);
    expect(summary.requirementsSatisfied).toBe(2);
    expect(summary.iSr).toBe(1);
    expect(summary.dSr).toBe(1);
    expect(lines.join("\n")).toContain("skip brownfield-001 (draft)");

    const written = JSON.parse(readFileSync(join(outDir, "summary.json"), "utf8"));
    expect(written.perTask[0].taskId).toBe("greenfield-001");

    const taskJson = JSON.parse(readFileSync(join(outDir, "greenfield-001.json"), "utf8"));
    expect(taskJson.grading.grades).toHaveLength(2);
  });

  it("skips an env-blocked task with its reason, never scoring it (F-163)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-suite-"));
    writeFileSync(join(dir, "greenfield-001.yaml"), PINNED_YAML);
    writeFileSync(join(dir, "brownfield-002.yaml"), BLOCKED_YAML);
    const { tasks, invalid } = loadTaskDir(dir);
    expect(invalid).toEqual({});

    const resultsDir = mkdtempSync(join(tmpdir(), "bench-results-"));
    const lines: string[] = [];
    const { summary } = await runSuite({
      suite: "unit",
      tasks,
      adapter: commandAdapter("solver", "echo hello > hello.txt"),
      resultsDir,
      skipDrafts: false, // blocked is skipped regardless of skipDrafts
      log: (l) => lines.push(l),
    });

    expect(summary.tasks).toBe(1); // blocked not scored
    expect(lines.join("\n")).toContain("skip brownfield-002 (blocked: target needs node>=24");
  });

  it("a failing solver yields honest zeros, not an error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-suite-"));
    writeFileSync(join(dir, "greenfield-001.yaml"), PINNED_YAML);
    const { tasks } = loadTaskDir(dir);
    const resultsDir = mkdtempSync(join(tmpdir(), "bench-results-"));
    const { summary } = await runSuite({
      suite: "unit",
      tasks,
      adapter: commandAdapter("noop", "true"),
      resultsDir,
    });
    expect(summary.requirementsSatisfied).toBe(0);
    expect(summary.iSr).toBe(0);
  });
});
