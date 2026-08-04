import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function createTestGitRepo(fileContent = "from pinned base\n"): { repoDir: string; commitSha: string; cleanup: () => void } {
  const repoDir = mkdtempSync(join(tmpdir(), "adapter-git-fixture-"));
  execSync(`git init ${JSON.stringify(repoDir)}`, { stdio: "ignore" });
  execSync(`git -C ${JSON.stringify(repoDir)} config user.name "Test"`, { stdio: "ignore" });
  execSync(`git -C ${JSON.stringify(repoDir)} config user.email "test@example.com"`, { stdio: "ignore" });

  writeFileSync(join(repoDir, "base.txt"), fileContent);
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

describe("commandAdapter", () => {
  it("substitutes placeholders, runs in the workspace, captures the log", async () => {
    const ws = mkdtempSync(join(tmpdir(), "bench-ws-"));
    const out = mkdtempSync(join(tmpdir(), "bench-out-"));
    const task: BenchmarkTask = { ...BROWNFIELD, repo: undefined };
    const adapter = commandAdapter("echo", 'echo "task {taskId}"; cat {goalFile} > produced.txt; pwd');
    const result = await adapter.run(task, { workspaceDir: ws, outDir: out });
    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(ws, "produced.txt"), "utf8")).toBe("Upgrade the dependency.");
    const log = readFileSync(join(out, "adapter.log"), "utf8");
    expect(log).toContain("task brownfield-004");
  });

  it("materializes brownfield repo.url at repo.ref into empty workspace (AC-2)", async () => {
    const fixture = createTestGitRepo();
    try {
      const task: BenchmarkTask = {
        ...BROWNFIELD,
        repo: { url: fixture.repoDir, ref: fixture.commitSha },
      };
      const ws = mkdtempSync(join(tmpdir(), "bench-ws-"));
      const out = mkdtempSync(join(tmpdir(), "bench-out-"));
      const adapter = commandAdapter("edit", 'grep -q "from pinned base" base.txt && echo "edited" > edited.txt');
      const result = await adapter.run(task, { workspaceDir: ws, outDir: out });
      expect(result.exitCode).toBe(0);
      expect(readFileSync(join(ws, "base.txt"), "utf8")).toBe("from pinned base\n");
      expect(readFileSync(join(ws, "edited.txt"), "utf8")).toBe("edited\n");
    } finally {
      fixture.cleanup();
    }
  });

  it("verifies existing matching .git workspace without re-cloning", async () => {
    const fixture = createTestGitRepo();
    try {
      const task: BenchmarkTask = {
        ...BROWNFIELD,
        repo: { url: fixture.repoDir, ref: fixture.commitSha },
      };
      const ws = mkdtempSync(join(tmpdir(), "bench-ws-"));
      const out = mkdtempSync(join(tmpdir(), "bench-out-"));
      const adapter = commandAdapter("echo", "true");
      // First run materializes
      await adapter.run(task, { workspaceDir: ws, outDir: out });
      // Second run reuses existing matching .git workspace
      const result = await adapter.run(task, { workspaceDir: ws, outDir: out });
      expect(result.exitCode).toBe(0);
    } finally {
      fixture.cleanup();
    }
  });

  it("repairs an existing workspace with a stale or mismatched .git directory", async () => {
    const fixture1 = createTestGitRepo("repo 1 content\n");
    const fixture2 = createTestGitRepo("repo 2 content\n");
    try {
      const ws = mkdtempSync(join(tmpdir(), "bench-ws-stale-"));
      const out = mkdtempSync(join(tmpdir(), "bench-out-stale-"));
      const adapter = commandAdapter("check", 'cat base.txt > output.txt');

      // Populate ws with fixture1 first
      const task1: BenchmarkTask = { ...BROWNFIELD, repo: { url: fixture1.repoDir, ref: fixture1.commitSha } };
      await adapter.run(task1, { workspaceDir: ws, outDir: out });
      expect(readFileSync(join(ws, "base.txt"), "utf8")).toBe("repo 1 content\n");

      // Now run task2 (different repo URL and ref) on the SAME workspace containing fixture1's .git
      const task2: BenchmarkTask = { ...BROWNFIELD, repo: { url: fixture2.repoDir, ref: fixture2.commitSha } };
      const result = await adapter.run(task2, { workspaceDir: ws, outDir: out });
      expect(result.exitCode).toBe(0);
      expect(readFileSync(join(ws, "output.txt"), "utf8")).toBe("repo 2 content\n");
    } finally {
      fixture1.cleanup();
      fixture2.cleanup();
    }
  });

  it("fails closed when git clone or checkout fails", async () => {
    const task: BenchmarkTask = {
      ...BROWNFIELD,
      repo: { url: "/nonexistent/path/to/repo", ref: "0123456789abcdef0123456789abcdef01234567" },
    };
    const ws = mkdtempSync(join(tmpdir(), "bench-ws-bad-"));
    const out = mkdtempSync(join(tmpdir(), "bench-out-bad-"));
    const adapter = commandAdapter("noop", "true");
    const result = await adapter.run(task, { workspaceDir: ws, outDir: out });
    expect(result.exitCode).toBe(1);
    expect(result.notes[0]).toContain("Failed to materialize repo base");
  });

  it("never lets a task's repo ref reach a shell", async () => {
    const fixture = createTestGitRepo("from pinned base\n");
    const ws = mkdtempSync(join(tmpdir(), "bench-ws-inject-"));
    const out = mkdtempSync(join(tmpdir(), "bench-out-inject-"));
    const marker = join(out, "pwned.txt");
    try {
      // A task YAML is not a trusted shell author. Quoting the ref into a shell
      // string is not enough: `$(...)` and backticks expand INSIDE double
      // quotes, so a quoted-but-interpolated ref still executes. This ref is a
      // valid string and an invalid git ref — materialization must fail closed
      // with the substitution never evaluated.
      const task: BenchmarkTask = {
        ...BROWNFIELD,
        repo: { url: fixture.repoDir, ref: `HEAD$(touch ${marker})` },
      };
      const adapter = commandAdapter("noop", "true");
      const result = await adapter.run(task, { workspaceDir: ws, outDir: out });
      expect(result.exitCode).toBe(1);
      expect(result.notes[0]).toContain("Failed to materialize repo base");
      expect(existsSync(marker)).toBe(false);
    } finally {
      fixture.cleanup();
    }
  });

  it("reports a timeout", async () => {
    const ws = mkdtempSync(join(tmpdir(), "bench-ws-"));
    const out = mkdtempSync(join(tmpdir(), "bench-out-"));
    const task: BenchmarkTask = { ...BROWNFIELD, repo: undefined };
    const adapter = commandAdapter("sleep", "sleep 30");
    const result = await adapter.run(task, { workspaceDir: ws, outDir: out, timeoutMs: 200 });
    expect(result.notes).toContain("timed out");
  }, 10_000);

  /**
   * F-250 (WP-582): the deadline must kill the process GROUP.
   *
   * The old local `runShell` spawned `bash` undetached and signalled only that
   * direct child. A grandchild holding the stdout pipe open keeps `close` from
   * firing, so the adapter blocks long past its cap: p3-rung-4's
   * `brownfield-002` ran 9h47m against a 4h cap — 2.45× — which is the same
   * overrun signature F-59/WP-255 fixed in `runBounded` years of runs ago.
   *
   * `sh -c 'sleep 30 & wait'` reproduces it exactly: `bash` forks, the sleeper
   * inherits stdout, and killing only the parent leaves the pipe open.
   */
  it("kills the whole process group at the cap, not just the direct child", async () => {
    const ws = mkdtempSync(join(tmpdir(), "bench-ws-"));
    const out = mkdtempSync(join(tmpdir(), "bench-out-"));
    const task: BenchmarkTask = { ...BROWNFIELD, repo: undefined };
    const adapter = commandAdapter("orphan", "sh -c 'sleep 30 & wait' ");

    const started = Date.now();
    const result = await adapter.run(task, { workspaceDir: ws, outDir: out, timeoutMs: 500 });
    const elapsed = Date.now() - started;

    expect(result.notes).toContain("timed out");
    // Cap + SIGTERM→SIGKILL grace, nowhere near the 30 s the grandchild wanted.
    expect(elapsed).toBeLessThan(12_000);
  }, 40_000);
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

  /**
   * F-247 (WP-579): nobody answers `chikory approve` on a benchmark arm.
   * p3-rung-4's `brownfield-001` escalated, parked in AWAITING_APPROVAL, and
   * burned its remaining 4 hours before the harness SIGKILLed it — leaving the
   * Temporal workflow Running and orphaning the server for the next launch.
   */
  it("declares an unattended escalation policy so an ESCALATE seals instead of waiting", () => {
    const spec = buildChikorySpec(BROWNFIELD, {}, "/tmp/ws");
    const parsed = parseTaskSpec(stringifyYaml(spec), {
      env: { ANTHROPIC_API_KEY: "x", GEMINI_API_KEY: "x" },
      warn: () => {},
    });
    expect(parsed.unattended).toEqual({ escalation: "seal_resumable_failed" });
  });

  /**
   * F-253 (WP-585): with no declared classes `recordWallAndCheckPeer` is
   * skipped and every wall parks. p3-rung-4 hit 5 walls and journaled zero
   * `agent_rotation` entries — the whole WP-566…WP-576 system was inert.
   */
  it("passes declared agent class REFERENCES through, in a shape parseTaskSpec accepts", () => {
    const agentClasses = { executor: "executor-bench", judge: "judge-bench" };
    const spec = buildChikorySpec(BROWNFIELD, { agentClasses }, "/tmp/ws");
    expect(spec.agent_classes).toEqual(agentClasses);

    // The oracle that matters: `agent_classes` is a map of class-id STRINGS
    // (schemas.ts), not an inline registry. Asserting the field echoes back
    // would have passed just as happily on an inline registry the real parser
    // rejects — so round-trip it through the real parser.
    const parsed = parseTaskSpec(stringifyYaml(spec), {
      // The judge class rides the keyless openai-compat proxy, as the real arm does.
      env: { ANTHROPIC_API_KEY: "x", GEMINI_API_KEY: "x", OPENAI_COMPAT_BASE_URL: "http://127.0.0.1:8787" },
      warn: () => {},
      registry: {
        version: 1,
        classes: {
          "executor-bench": {
            id: "executor-bench",
            role: "executor",
            primary: { id: "g", role: "executor", adapter: "gemini-cli", family: "gemini", backend: "gemini", model: "gemini-3.6-flash-high" },
            adjacent: [],
          },
          "judge-bench": {
            id: "judge-bench",
            role: "judge",
            primary: { id: "s", role: "judge", transport: "openai-compat", backend: "openai", model: "gpt-5.6-sol xhigh" },
            adjacent: [],
          },
        },
      },
    });
    expect(parsed.agentClasses).toEqual(agentClasses);

    // Omitted when undeclared — the default arm stays byte-identical.
    expect(buildChikorySpec(BROWNFIELD, {}, "/tmp/ws").agent_classes).toBeUndefined();
  });
});
