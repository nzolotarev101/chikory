import { execSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { commandAdapter, type RunnerAdapter } from "../src/adapter.js";
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

  it("verifies base ref materialized in separate checkout: declared + repo-pinned gets green verdict from base ref", async () => {
    const fixture = createGitRepoFixture();
    try {
      const taskYaml = `
id: brownfield-001
class: brownfield
status: pinned
repo:
  url: ${JSON.stringify(fixture.repoDir)}
  ref: ${fixture.commitSha}
base_verification_command: ./test.sh
goal: test goal
requirements:
  - id: R1
    description: requirement 1
    check: test -f result.txt
`;
      const dir = mkdtempSync(join(tmpdir(), "bench-suite-"));
      writeFileSync(join(dir, "brownfield-001.yaml"), taskYaml);
      const { tasks, invalid } = loadTaskDir(dir);
      expect(invalid).toEqual({});
      expect(tasks[0].baseVerificationCommand).toBe("./test.sh");

      let workspaceWasEmptyAtStart = false;
      const stubAdapter: RunnerAdapter = {
        name: "stub-adapter",
        run: async (_task, ctx) => {
          const entries = readdirSync(ctx.workspaceDir);
          workspaceWasEmptyAtStart = entries.length === 0;
          // Rewrite workspace to a RED output file / state
          writeFileSync(join(ctx.workspaceDir, "test.sh"), '#!/bin/sh\necho "Tests  0 passed (0)"\nexit 1\n', { mode: 0o755 });
          return { exitCode: 0, wallClockMs: 10, artifacts: [], notes: [] };
        },
      };

      const resultsDir = mkdtempSync(join(tmpdir(), "bench-results-"));
      const { outDir } = await runSuite({
        suite: "unit",
        tasks,
        adapter: stubAdapter,
        resultsDir,
      });

      expect(workspaceWasEmptyAtStart).toBe(true);

      const taskResult = JSON.parse(readFileSync(join(outDir, "brownfield-001.json"), "utf8"));
      expect(taskResult.baseVerification).toBeDefined();
      expect(taskResult.baseVerification.green).toBe(true);
      expect(taskResult.baseVerification.testsPassed).toBe(3);
      expect(taskResult.baseVerification.testsFailed).toBe(0);
      expect(taskResult.baseVerification.reason).toContain("green");

      // Verify no base checkout directory was left behind in temp
      const baseVerifyTempDirs = readdirSync(tmpdir()).filter((name) => name.startsWith("base-verify-brownfield-001"));
      expect(baseVerifyTempDirs).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });

  it("task with no repo pin records no baseVerification verdict in result", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-suite-"));
    writeFileSync(join(dir, "greenfield-001.yaml"), PINNED_YAML);
    const { tasks } = loadTaskDir(dir);

    const resultsDir = mkdtempSync(join(tmpdir(), "bench-results-"));
    const { outDir } = await runSuite({
      suite: "unit",
      tasks,
      adapter: commandAdapter("solver", "echo hello > hello.txt"),
      resultsDir,
    });

    const taskResult = JSON.parse(readFileSync(join(outDir, "greenfield-001.json"), "utf8"));
    expect(taskResult.baseVerification).toBeUndefined();
  });

  it("repo-pinned task with no declared base_verification_command records a non-green verdict", async () => {
    const fixture = createGitRepoFixture();
    try {
      const taskYaml = `
id: brownfield-002
class: brownfield
status: pinned
repo:
  url: ${JSON.stringify(fixture.repoDir)}
  ref: ${fixture.commitSha}
goal: test goal
requirements:
  - id: R1
    description: requirement 1
    check: "true"
`;
      const dir = mkdtempSync(join(tmpdir(), "bench-suite-"));
      writeFileSync(join(dir, "brownfield-002.yaml"), taskYaml);
      const { tasks } = loadTaskDir(dir);

      const resultsDir = mkdtempSync(join(tmpdir(), "bench-results-"));
      const { outDir } = await runSuite({
        suite: "unit",
        tasks,
        adapter: commandAdapter("solver", "true"),
        resultsDir,
      });

      const taskResult = JSON.parse(readFileSync(join(outDir, "brownfield-002.json"), "utf8"));
      expect(taskResult.baseVerification).toBeDefined();
      expect(taskResult.baseVerification.green).toBe(false);
      expect(taskResult.baseVerification.reason).toMatch(/No base verification command declared/i);
    } finally {
      fixture.cleanup();
    }
  });

  it("handles base verification command execution failure gracefully and records non-green verdict", async () => {
    const fixture = createGitRepoFixture();
    try {
      const taskYaml = `
id: brownfield-003
class: brownfield
status: pinned
repo:
  url: ${JSON.stringify(fixture.repoDir)}
  ref: ${fixture.commitSha}
base_verification_command: ./nonexistent-script.sh
goal: test goal
requirements:
  - id: R1
    description: requirement 1
    check: "true"
`;
      const dir = mkdtempSync(join(tmpdir(), "bench-suite-"));
      writeFileSync(join(dir, "brownfield-003.yaml"), taskYaml);
      const { tasks } = loadTaskDir(dir);

      const resultsDir = mkdtempSync(join(tmpdir(), "bench-results-"));
      const { outDir } = await runSuite({
        suite: "unit",
        tasks,
        adapter: commandAdapter("solver", "true"),
        resultsDir,
      });

      const taskResult = JSON.parse(readFileSync(join(outDir, "brownfield-003.json"), "utf8"));
      expect(taskResult.baseVerification).toBeDefined();
      expect(taskResult.baseVerification.green).toBe(false);
      expect(taskResult.baseVerification.reason).toMatch(/Verification command failed|Unparseable/i);
    } finally {
      fixture.cleanup();
    }
  });

  it("records non-green verdict when base verification command outputs failing tests on base ref", async () => {
    const fixture = createGitRepoFixture();
    try {
      // Overwrite test script to return failing summary
      const testScript = join(fixture.repoDir, "test.sh");
      writeFileSync(testScript, '#!/bin/sh\necho "Tests  2 failed | 1 passed (3)"\nexit 1\n', { mode: 0o755 });
      execSync(`git -C ${JSON.stringify(fixture.repoDir)} commit -am "failing test script"`, { stdio: "ignore" });
      const failSha = execSync(`git -C ${JSON.stringify(fixture.repoDir)} rev-parse HEAD`, { encoding: "utf8" }).trim();

      const taskYaml = `
id: brownfield-004
class: brownfield
status: pinned
repo:
  url: ${JSON.stringify(fixture.repoDir)}
  ref: ${failSha}
base_verification_command: ./test.sh
goal: test goal
requirements:
  - id: R1
    description: requirement 1
    check: "true"
`;
      const dir = mkdtempSync(join(tmpdir(), "bench-suite-"));
      writeFileSync(join(dir, "brownfield-004.yaml"), taskYaml);
      const { tasks } = loadTaskDir(dir);

      const resultsDir = mkdtempSync(join(tmpdir(), "bench-results-"));
      const { outDir } = await runSuite({
        suite: "unit",
        tasks,
        adapter: commandAdapter("solver", "true"),
        resultsDir,
      });

      const taskResult = JSON.parse(readFileSync(join(outDir, "brownfield-004.json"), "utf8"));
      expect(taskResult.baseVerification).toBeDefined();
      expect(taskResult.baseVerification.green).toBe(false);
      expect(taskResult.baseVerification.testsPassed).toBe(1);
      expect(taskResult.baseVerification.testsFailed).toBe(2);
    } finally {
      fixture.cleanup();
    }
  });
});

function createGitRepoFixture(): { repoDir: string; commitSha: string; cleanup: () => void } {
  const repoDir = mkdtempSync(join(tmpdir(), "git-fixture-"));
  execSync(`git init ${JSON.stringify(repoDir)}`, { stdio: "ignore" });
  execSync(`git -C ${JSON.stringify(repoDir)} config user.name "Test"`, { stdio: "ignore" });
  execSync(`git -C ${JSON.stringify(repoDir)} config user.email "test@example.com"`, { stdio: "ignore" });

  const testScript = join(repoDir, "test.sh");
  writeFileSync(testScript, '#!/bin/sh\necho "Tests  3 passed (3)"\nexit 0\n', { mode: 0o755 });

  execSync(`git -C ${JSON.stringify(repoDir)} add .`, { stdio: "ignore" });
  execSync(`git -C ${JSON.stringify(repoDir)} commit -m "initial commit"`, { stdio: "ignore" });

  const commitSha = execSync(`git -C ${JSON.stringify(repoDir)} rev-parse HEAD`, { encoding: "utf8" }).trim();

  const cleanup = () => {
    try {
      rmSync(repoDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  };

  return { repoDir, commitSha, cleanup };
}
