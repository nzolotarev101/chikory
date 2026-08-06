import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stringify as stringifyYaml } from "yaml";

import { parseTaskSpec } from "@chikory/sdk";

import { buildChikorySpec, chikoryAdapter, commandAdapter } from "../src/adapter.js";
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

  it("verifies the pinned base BEFORE the agent runs (F-258 reference behaviour)", async () => {
    const fixture = createTestGitRepo();
    try {
      const task: BenchmarkTask = {
        ...BROWNFIELD,
        repo: { url: fixture.repoDir, ref: fixture.commitSha },
        // Green on the pinned tree, red once `base.txt` is rewritten.
        baseVerificationCommand: 'grep -q "from pinned base" base.txt && echo "Tests  1 passed (1)"',
      };
      const ws = mkdtempSync(join(tmpdir(), "bench-ws-cmdbase-"));
      const out = mkdtempSync(join(tmpdir(), "bench-out-cmdbase-"));
      const adapter = commandAdapter("mutate", 'echo "agent rewrote this" > base.txt');
      const result = await adapter.run(task, { workspaceDir: ws, outDir: out });

      expect(result.baseVerification).toMatchObject({ green: true, testsPassed: 1, testsFailed: 0 });
      // The agent really did break the base command afterwards — the verification
      // above is only meaningful because it ran first.
      expect(readFileSync(join(ws, "base.txt"), "utf8")).toBe("agent rewrote this\n");
    } finally {
      fixture.cleanup();
    }
  }, 60_000);
});

/**
 * A stand-in `chikory` binary: announces a run-id the way the real CLI does,
 * clones the pin into its OWN `dataDir/runs/<id>/workspace` (never the harness
 * workspace), and edits the tree there. That is the shape that made F-258
 * invisible — the adapter's agent works somewhere else entirely, and the
 * harness only sees the result.
 */
function writeChikoryStub(repoDir: string, mutation: string): string {
  const binDir = mkdtempSync(join(tmpdir(), "chikory-stub-"));
  const binPath = join(binDir, "chikory-stub.sh");
  writeFileSync(
    binPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'DATA_DIR="$4"',
      'RUN_ID="run-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"',
      'WS="$DATA_DIR/runs/$RUN_ID/workspace"',
      'mkdir -p "$WS"',
      `git clone --quiet ${JSON.stringify(repoDir)} "$WS"`,
      'echo "run-id: $RUN_ID"',
      `cd "$WS" && ${mutation}`,
    ].join("\n"),
    { mode: 0o755 },
  );
  return `bash ${JSON.stringify(binPath)}`;
}

describe("chikoryAdapter base verification (F-258)", () => {
  /**
   * F-258: the harness reported `baseVerified` for the Chikory arm by running
   * the base command against `ctx.workspaceDir` — which this adapter overwrites
   * with the agent's FINAL tree before grading. So "was the base green?" was
   * answered by testing the agent's output.
   *
   * p3-rung-4's `brownfield-001` (zod v3→v4) failed on `Your lockfile needs to
   * be updated, but yarn was run with --frozen-lockfile`: a frozen install
   * against the `yarn.lock` the agent had correctly rewritten. Same pin, same
   * command, verified green (117 passed) through `commandAdapter`, which
   * verifies pre-agent. The other four tasks passed only because they do not
   * perturb their lockfiles enough to trip a frozen install — so `baseVerified`
   * had never measured what its name claims, on any Chikory-arm run.
   *
   * The mutation below is that defect in miniature: a base command that is green
   * on the pin and red on the agent's tree.
   */
  it("verifies the pin, not the tree the agent handed back", async () => {
    const fixture = createTestGitRepo();
    try {
      const task: BenchmarkTask = {
        ...BROWNFIELD,
        repo: { url: fixture.repoDir, ref: fixture.commitSha },
        baseVerificationCommand: 'grep -q "from pinned base" base.txt && echo "Tests  1 passed (1)"',
      };
      const ws = mkdtempSync(join(tmpdir(), "bench-ws-chik-"));
      const out = mkdtempSync(join(tmpdir(), "bench-out-chik-"));
      const adapter = chikoryAdapter({
        bin: writeChikoryStub(fixture.repoDir, 'echo "agent rewrote this" > base.txt'),
      });

      const result = await adapter.run(task, { workspaceDir: ws, outDir: out });

      expect(result.exitCode).toBe(0);
      // Pre-agent, against the pin.
      expect(result.baseVerification).toMatchObject({ green: true, testsPassed: 1, testsFailed: 0 });
      expect(result.baseVerification?.reason).toContain("Base suite is green");
      // …and the graded workspace really is the post-agent tree, on which that
      // same command would have failed. Without this line the assertion above
      // could pass for the wrong reason.
      expect(readFileSync(join(ws, "base.txt"), "utf8")).toBe("agent rewrote this\n");
    } finally {
      fixture.cleanup();
    }
  }, 60_000);

  it("leaves no base-verification residue in the graded workspace", async () => {
    const fixture = createTestGitRepo();
    try {
      const task: BenchmarkTask = {
        ...BROWNFIELD,
        repo: { url: fixture.repoDir, ref: fixture.commitSha },
        // Writes an artifact the way a real install does (`node_modules`).
        baseVerificationCommand: 'mkdir -p node_modules && echo "Tests  1 passed (1)"',
      };
      const ws = mkdtempSync(join(tmpdir(), "bench-ws-residue-"));
      const out = mkdtempSync(join(tmpdir(), "bench-out-residue-"));
      const adapter = chikoryAdapter({ bin: writeChikoryStub(fixture.repoDir, "true") });

      const result = await adapter.run(task, { workspaceDir: ws, outDir: out });

      expect(result.baseVerification?.green).toBe(true);
      // The scratch clone is deleted…
      expect(existsSync(join(out, "base-verify"))).toBe(false);
      // …and its install output never reaches the graded artifact. `cpSync` runs
      // with `force` but does NOT delete extra files at the destination, so
      // anything left here would survive into grading.
      expect(existsSync(join(ws, "node_modules"))).toBe(false);
    } finally {
      fixture.cleanup();
    }
  }, 60_000);

  it("reports a red base without inventing a reason of its own", async () => {
    const fixture = createTestGitRepo("not what the command wants\n");
    try {
      const task: BenchmarkTask = {
        ...BROWNFIELD,
        repo: { url: fixture.repoDir, ref: fixture.commitSha },
        baseVerificationCommand: 'grep -q "from pinned base" base.txt && echo "Tests  1 passed (1)"',
      };
      const ws = mkdtempSync(join(tmpdir(), "bench-ws-red-"));
      const out = mkdtempSync(join(tmpdir(), "bench-out-red-"));
      const adapter = chikoryAdapter({ bin: writeChikoryStub(fixture.repoDir, "true") });

      const result = await adapter.run(task, { workspaceDir: ws, outDir: out });
      expect(result.baseVerification?.green).toBe(false);
      expect(result.baseVerification?.reason).toContain("failed with exit code 1");
    } finally {
      fixture.cleanup();
    }
  }, 60_000);

  it("names a missing base_verification_command the same way commandAdapter does", async () => {
    const fixture = createTestGitRepo();
    try {
      const task: BenchmarkTask = { ...BROWNFIELD, repo: { url: fixture.repoDir, ref: fixture.commitSha } };
      const chikOut = mkdtempSync(join(tmpdir(), "bench-out-nocmd-chik-"));
      const cmdOut = mkdtempSync(join(tmpdir(), "bench-out-nocmd-cmd-"));

      const viaChikory = await chikoryAdapter({ bin: writeChikoryStub(fixture.repoDir, "true") }).run(task, {
        workspaceDir: mkdtempSync(join(tmpdir(), "bench-ws-nocmd-chik-")),
        outDir: chikOut,
      });
      const viaCommand = await commandAdapter("noop", "true").run(task, {
        workspaceDir: mkdtempSync(join(tmpdir(), "bench-ws-nocmd-cmd-")),
        outDir: cmdOut,
      });

      // Two arms of one published comparison: `baseVerified` has to mean the
      // same thing in each, down to the reason text an operator greps for.
      expect(viaChikory.baseVerification).toEqual(viaCommand.baseVerification);
      expect(viaChikory.baseVerification?.reason).toContain("No base verification command declared");
    } finally {
      fixture.cleanup();
    }
  }, 60_000);

  it("does not verify a base for a greenfield task with no repo pin", async () => {
    const fixture = createTestGitRepo();
    try {
      const task: BenchmarkTask = { ...BROWNFIELD, id: "greenfield-001", class: "greenfield", repo: undefined };
      const result = await chikoryAdapter({ bin: writeChikoryStub(fixture.repoDir, "true") }).run(task, {
        workspaceDir: mkdtempSync(join(tmpdir(), "bench-ws-green-")),
        outDir: mkdtempSync(join(tmpdir(), "bench-out-green-")),
      });
      expect(result.baseVerification).toBeUndefined();
    } finally {
      fixture.cleanup();
    }
  }, 60_000);
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

  /**
   * F-256/F-257: `bench-run.sh` exports `OPENAI_COMPAT_BASE_URL` (real
   * `process.env`, not the `env:` option below) for every launch, and passes
   * `--agent-classes` in the same breath, but never `ANTHROPIC_API_KEY` — the
   * standing directive is Gemini executes, Codex judges, never Claude.
   * `buildChikorySpec` used to always set an explicit `routing` block AND
   * default `judge.family` to a Claude/Gemini guess whenever agent classes
   * weren't threaded all the way through — both leftovers from before agent
   * classes existed. The `routing` override collided with `parseTaskSpec`'s
   * "routing is DERIVED from agent_classes, not both" check; the `judge`
   * guess survived that fix and got checked independently by
   * `missingProviderEnv`, demanding a Claude key the bench arm never sets.
   * Both killed every task before it materialized a workspace.
   */
  it("derives judge + routing from agent classes, never guessing anthropic, even with the proxy env set (F-256/F-257)", () => {
    const prior = process.env.OPENAI_COMPAT_BASE_URL;
    process.env.OPENAI_COMPAT_BASE_URL = "http://127.0.0.1:8787";
    try {
      const agentClasses = { executor: "executor-bench", judge: "judge-bench" };
      const spec = buildChikorySpec(BROWNFIELD, { agentClasses }, "/tmp/ws");
      expect(spec.routing).toBeUndefined();
      expect(spec.judge).toEqual({});

      const parsed = parseTaskSpec(stringifyYaml(spec), {
        // No ANTHROPIC_API_KEY — the real bench arm never sets one.
        env: { GEMINI_API_KEY: "x", OPENAI_COMPAT_BASE_URL: "http://127.0.0.1:8787" },
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
      expect(parsed.judge.family).toBe("openai-compat");
      expect(parsed.routing.stages.judge).toEqual({ provider: "openai-compat", model: "gpt-5.6-sol xhigh" });
      expect(parsed.routing.stages.code).toEqual({ provider: "gemini", model: "gemini-3.6-flash-high" });
    } finally {
      if (prior === undefined) delete process.env.OPENAI_COMPAT_BASE_URL;
      else process.env.OPENAI_COMPAT_BASE_URL = prior;
    }
  });
});
