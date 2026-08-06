import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { commandAdapter, ensureGitWorkspace, type RunnerAdapter } from "../src/adapter.js";
import { verifyBaseGreen } from "../src/base-verify.js";
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

  it("verifies base ref materialized in workspace: declared + repo-pinned gets green verdict from base ref", async () => {
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

      let workspaceHasBaseScriptAtStart = false;
      const stubAdapter: RunnerAdapter = {
        name: "stub-adapter",
        run: async (_task, ctx) => {
          if (_task.repo) {
            ensureGitWorkspace(ctx.workspaceDir, _task.repo.url, _task.repo.ref);
          }
          const entries = readdirSync(ctx.workspaceDir);
          workspaceHasBaseScriptAtStart = entries.includes("test.sh");
          const baseVerification = _task.baseVerificationCommand
            ? await verifyBaseGreen({
                command: _task.baseVerificationCommand,
                cwd: ctx.workspaceDir,
                provisioning: ctx.nodeProvisioning ?? { type: "ambient" },
              })
            : undefined;
          // Rewrite workspace to a RED output file / state
          writeFileSync(join(ctx.workspaceDir, "test.sh"), '#!/bin/sh\necho "Tests  0 passed (0)"\nexit 1\n', { mode: 0o755 });
          return { exitCode: 0, wallClockMs: 10, artifacts: [], notes: [], baseVerification };
        },
      };

      const resultsDir = mkdtempSync(join(tmpdir(), "bench-results-"));
      const { outDir } = await runSuite({
        suite: "unit",
        tasks,
        adapter: stubAdapter,
        resultsDir,
      });

      expect(workspaceHasBaseScriptAtStart).toBe(true);

      const taskResult = JSON.parse(readFileSync(join(outDir, "brownfield-001.json"), "utf8"));
      expect(taskResult.baseVerification).toBeDefined();
      expect(taskResult.baseVerification.green).toBe(true);
      expect(taskResult.baseVerification.testsPassed).toBe(3);
      expect(taskResult.baseVerification.testsFailed).toBe(0);
      expect(taskResult.baseVerification.reason).toContain("green");

      // Verify no separate base checkout directory was created in temp
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

  it("runSuite summary includes base verification metrics and gates headline rates over verified tasks", async () => {
    const fixture = createGitRepoFixture();
    try {
      const greenYaml = `
id: brownfield-901
class: brownfield
status: pinned
repo:
  url: ${JSON.stringify(fixture.repoDir)}
  ref: ${fixture.commitSha}
base_verification_command: ./test.sh
goal: goal
requirements:
  - id: R1
    description: requirement 1
    check: test -f green.txt
`;
      const redYaml = `
id: brownfield-902
class: brownfield
status: pinned
repo:
  url: ${JSON.stringify(fixture.repoDir)}
  ref: ${fixture.commitSha}
base_verification_command: ./nonexistent.sh
goal: goal
requirements:
  - id: R1
    description: requirement 1
    check: "false"
`;
      const undeclaredYaml = `
id: brownfield-903
class: brownfield
status: pinned
repo:
  url: ${JSON.stringify(fixture.repoDir)}
  ref: ${fixture.commitSha}
goal: goal
requirements:
  - id: R1
    description: requirement 1
    check: "false"
`;
      const dir = mkdtempSync(join(tmpdir(), "bench-suite-summary-"));
      writeFileSync(join(dir, "brownfield-901.yaml"), greenYaml);
      writeFileSync(join(dir, "brownfield-902.yaml"), redYaml);
      writeFileSync(join(dir, "brownfield-903.yaml"), undeclaredYaml);
      writeFileSync(join(dir, "greenfield-904.yaml"), PINNED_YAML);

      const { tasks, invalid } = loadTaskDir(dir);
      expect(invalid).toEqual({});

      const resultsDir = mkdtempSync(join(tmpdir(), "bench-results-"));
      // F-258: base verification is the ADAPTER's job now — `runSuite` cannot do
      // it after the fact, because the workspace it would test is the adapter's
      // output. This stub works in place (like `commandAdapter`), so it verifies
      // the freshly-materialized tree before touching it.
      const adapter: RunnerAdapter = {
        name: "test-adapter",
        run: async (task, ctx) => {
          let baseVerification;
          if (task.repo) {
            ensureGitWorkspace(ctx.workspaceDir, task.repo.url, task.repo.ref);
            baseVerification = task.baseVerificationCommand
              ? await verifyBaseGreen({
                  command: task.baseVerificationCommand,
                  cwd: ctx.workspaceDir,
                  provisioning: { type: "ambient" },
                })
              : {
                  green: false,
                  reason: "No base verification command declared (base_verification_command is missing)",
                  testsPassed: 0,
                  testsFailed: 0,
                };
          }
          if (task.id === "brownfield-901") {
            writeFileSync(join(ctx.workspaceDir, "green.txt"), "ok");
          }
          if (task.id === "greenfield-001") {
            writeFileSync(join(ctx.workspaceDir, "hello.txt"), "hello");
          }
          return {
            exitCode: 0,
            wallClockMs: 10,
            artifacts: [],
            notes: [],
            ...(baseVerification !== undefined ? { baseVerification } : {}),
          };
        },
      };

      const { summary, outDir } = await runSuite({
        suite: "summary-test",
        tasks,
        adapter,
        resultsDir,
      });

      expect(summary.tasks).toBe(4);
      expect(summary.tasksVerified).toBe(2); // 901 and greenfield-001
      expect(summary.unverifiedTasks).toHaveLength(2);
      expect(summary.unverifiedTasks.map((u) => u.taskId).sort()).toEqual(["brownfield-902", "brownfield-903"]);
      expect(summary.iSr).toBe(1); // 901 (1/1) + greenfield-001 (2/2) = 3/3 = 1
      expect(summary.perTask).toHaveLength(4);

      const writtenSummary = JSON.parse(readFileSync(join(outDir, "summary.json"), "utf8"));
      expect(writtenSummary.tasksVerified).toBe(2);
      expect(writtenSummary.unverifiedTasks).toHaveLength(2);
      expect(writtenSummary.iSr).toBe(1);
    } finally {
      fixture.cleanup();
    }
  });

  /**
   * F-258, end to end and at the altitude the defect lived at.
   *
   * `runSuite` used to fall back to running the base command against
   * `workspaceDir` whenever an adapter reported nothing. For an adapter whose
   * agent works elsewhere — `chikoryAdapter` clones into
   * `dataDir/runs/<id>/workspace` and copies the finished tree back for grading
   * — that directory holds the agent's OUTPUT by then. The suite answered "was
   * the base green?" by testing the thing the agent produced.
   *
   * It failed exactly where it mattered: p3-rung-4's `brownfield-001` is a real
   * zod v3→v4 upgrade, so a `--frozen-lockfile` install against the agent's
   * rewritten `yarn.lock` could only fail. That marked Chikory's best task
   * (3/3, dep 3) unverified, and `compareSummaries` refuses to publish an arm
   * with `tasksVerified !== 5`. The other four tasks passed by luck.
   *
   * The adapter below is that geometry in miniature: it works in a private
   * directory, reports nothing, and hands back a tree that PASSES the base
   * command for reasons of its own. On the old code the suite read that pass as
   * "the base is green" — a fabricated green, from a tree the pin never
   * produced. The false-red p3-rung-4 actually hit and this false-green are the
   * same defect seen from two sides.
   */
  it("never manufactures a base verdict from a workspace the agent overwrote (F-258)", async () => {
    const fixture = createGitRepoFixture();
    try {
      const taskYaml = `
id: brownfield-905
class: brownfield
status: pinned
repo:
  url: ${JSON.stringify(fixture.repoDir)}
  ref: ${fixture.commitSha}
base_verification_command: ./test.sh
goal: goal
requirements:
  - id: R1
    description: requirement 1
    check: test -f delivered.txt
`;
      const dir = mkdtempSync(join(tmpdir(), "bench-suite-f258-"));
      writeFileSync(join(dir, "brownfield-905.yaml"), taskYaml);
      const { tasks } = loadTaskDir(dir);

      const outOfBandAdapter: RunnerAdapter = {
        name: "out-of-band",
        run: async (task, ctx) => {
          const agentDir = mkdtempSync(join(tmpdir(), "agent-private-"));
          ensureGitWorkspace(agentDir, task.repo!.url, task.repo!.ref);
          // The agent's own tree: a `test.sh` that reports green while testing
          // nothing, plus the deliverable. Materially different from the pin.
          writeFileSync(join(agentDir, "test.sh"), '#!/bin/sh\necho "Tests  99 passed (99)"\nexit 0\n', {
            mode: 0o755,
          });
          writeFileSync(join(agentDir, "delivered.txt"), "ok");
          cpSync(agentDir, ctx.workspaceDir, { recursive: true, force: true });
          rmSync(agentDir, { recursive: true, force: true });
          return { exitCode: 0, wallClockMs: 10, artifacts: [], notes: [] };
        },
      };

      const resultsDir = mkdtempSync(join(tmpdir(), "bench-results-"));
      const { summary, outDir } = await runSuite({
        suite: "unit",
        tasks,
        adapter: outOfBandAdapter,
        resultsDir,
      });

      const taskResult = JSON.parse(readFileSync(join(outDir, "brownfield-905.json"), "utf8"));
      // The old fallback answered `green: true, testsPassed: 99` here — read off
      // the agent's own substituted suite.
      expect(taskResult.baseVerification.green).toBe(false);
      expect(taskResult.baseVerification.testsPassed).toBe(0);
      expect(taskResult.baseVerification.reason).toContain(
        "adapter 'out-of-band' did not report a base verification",
      );
      expect(summary.tasksVerified).toBe(0);
      expect(summary.unverifiedTasks).toHaveLength(1);
      // The graded tree really is the agent's, not the pin's — without this the
      // assertions above could hold for the wrong reason.
      expect(existsSync(join(outDir, "brownfield-905", "workspace", "delivered.txt"))).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });

  /**
   * Same contract, the in-place case: an adapter can hand back a perfectly green
   * tree and still owe a verification. `runSuite` must not accept the tree as a
   * substitute for the measurement.
   */
  it("reports a repo-pinned task as unverified when the adapter reports nothing", async () => {
    const fixture = createGitRepoFixture();
    try {
      const taskYaml = `
id: brownfield-906
class: brownfield
status: pinned
repo:
  url: ${JSON.stringify(fixture.repoDir)}
  ref: ${fixture.commitSha}
base_verification_command: ./test.sh
goal: goal
requirements:
  - id: R1
    description: requirement 1
    check: "true"
`;
      const dir = mkdtempSync(join(tmpdir(), "bench-suite-silent-"));
      writeFileSync(join(dir, "brownfield-906.yaml"), taskYaml);
      const { tasks } = loadTaskDir(dir);

      const silentAdapter: RunnerAdapter = {
        name: "silent",
        run: async (task, ctx) => {
          // Materializes a genuinely green tree — and still reports nothing.
          ensureGitWorkspace(ctx.workspaceDir, task.repo!.url, task.repo!.ref);
          return { exitCode: 0, wallClockMs: 10, artifacts: [], notes: [] };
        },
      };

      const resultsDir = mkdtempSync(join(tmpdir(), "bench-results-"));
      const { summary, outDir } = await runSuite({
        suite: "unit",
        tasks,
        adapter: silentAdapter,
        resultsDir,
      });

      const taskResult = JSON.parse(readFileSync(join(outDir, "brownfield-906.json"), "utf8"));
      expect(taskResult.baseVerification.green).toBe(false);
      expect(taskResult.baseVerification.reason).toContain("adapter 'silent' did not report a base verification");
      expect(summary.tasksVerified).toBe(0);
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
