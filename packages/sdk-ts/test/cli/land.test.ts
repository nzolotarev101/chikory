import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { type LandDeps, VERIFY_COMMANDS } from "../../src/cli/land.js";
import { main } from "../../src/cli/main.js";

interface Cli {
  out: string[];
  err: string[];
  deps: LandDeps;
}

interface Fixture {
  root: string;
  repo: string;
  dataDir: string;
  workspace: string;
  runId: string;
  baseSha: string;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

function cli(): Cli {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    deps: {
      out: (line) => out.push(line),
      err: (line) => err.push(line),
    },
  };
}

describe("chikory land (WP-220)", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  async function fixture(opts: { changed?: boolean } = {}): Promise<Fixture> {
    const root = await mkdtemp(join(tmpdir(), "chikory-land-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const repo = join(root, "host");
    const dataDir = join(root, "data");
    const runId = "run-land-test";
    const workspace = join(dataDir, "runs", runId, "workspace");

    await mkdir(repo);
    git(repo, ["init", "-b", "main"]);
    git(repo, ["config", "user.name", "Chikory Test"]);
    git(repo, ["config", "user.email", "test@chikory.local"]);
    await writeFile(join(repo, "base.txt"), "base\n");
    git(repo, ["add", "--all"]);
    git(repo, ["commit", "-m", "chore: base"]);
    const baseSha = git(repo, ["rev-parse", "HEAD"]);

    await mkdir(join(dataDir, "runs", runId), { recursive: true });
    execFileSync("git", ["clone", repo, workspace], { encoding: "utf8" });
    git(workspace, ["config", "user.name", "Chikory Test"]);
    git(workspace, ["config", "user.email", "test@chikory.local"]);
    git(workspace, ["tag", "chikory-base", baseSha]);
    if (opts.changed !== false) {
      await writeFile(join(workspace, "landed.txt"), "from run workspace\n");
      git(workspace, ["add", "--all"]);
      git(workspace, ["commit", "-m", "feat: workspace change"]);
    }

    return { root, repo, dataDir, workspace, runId, baseSha };
  }

  test("creates a default branch and one squashed commit", async () => {
    const f = await fixture();
    const c = cli();

    expect(
      await main(["land", f.runId, "--repo", f.repo, "--data-dir", f.dataDir], c.deps),
    ).toBe(0);
    expect(git(f.repo, ["branch", "--show-current"])).toBe(`land-${f.runId}`);
    expect(git(f.repo, ["rev-list", "--count", `${f.baseSha}..HEAD`])).toBe("1");
    expect(git(f.repo, ["log", "-1", "--format=%B"])).toContain(f.runId);
    expect(git(f.repo, ["status", "--porcelain"])).toBe("");
    expect(git(f.repo, ["show", "HEAD:landed.txt"])).toBe("from run workspace");
    expect(c.out).toContain(`branch: land-${f.runId}`);
    expect(c.out).toContain(`forensics: chikory trace ${f.runId}`);
  });

  test("--branch overrides the default branch name", async () => {
    const f = await fixture();
    const c = cli();

    expect(
      await main(
        ["land", f.runId, "--branch", "review/wp-220", "--repo", f.repo, "--data-dir", f.dataDir],
        c.deps,
      ),
    ).toBe(0);
    expect(git(f.repo, ["branch", "--show-current"])).toBe("review/wp-220");
  });

  test("missing workspace exits 1 without creating a commit", async () => {
    const f = await fixture();
    const c = cli();
    const missingRun = "run-missing";

    expect(
      await main(["land", missingRun, "--repo", f.repo, "--data-dir", f.dataDir], c.deps),
    ).toBe(1);
    expect(c.err).toEqual([
      expect.stringContaining(`workspace for run '${missingRun}' not found`),
    ]);
    expect(git(f.repo, ["rev-parse", "HEAD"])).toBe(f.baseSha);
  });

  test("dirty target repo exits 1 without creating a commit", async () => {
    const f = await fixture();
    await writeFile(join(f.repo, "dirty.txt"), "dirty\n");
    const c = cli();

    expect(
      await main(["land", f.runId, "--repo", f.repo, "--data-dir", f.dataDir], c.deps),
    ).toBe(1);
    expect(c.err).toEqual([expect.stringContaining("has uncommitted changes")]);
    expect(git(f.repo, ["rev-parse", "HEAD"])).toBe(f.baseSha);
  });

  test("empty workspace diff exits 1 without creating a commit", async () => {
    const f = await fixture({ changed: false });
    const c = cli();

    expect(
      await main(["land", f.runId, "--repo", f.repo, "--data-dir", f.dataDir], c.deps),
    ).toBe(1);
    expect(c.err).toEqual([expect.stringContaining("has no workspace changes to land")]);
    expect(git(f.repo, ["rev-parse", "HEAD"])).toBe(f.baseSha);
  });

  test("--verify runs the four devbox checks in order against the target repo", async () => {
    const f = await fixture();
    const c = cli();
    const checks: Array<{ command: string; cwd: string }> = [];
    c.deps.runCheck = (command, cwd) => checks.push({ command, cwd });

    expect(
      await main(
        ["land", f.runId, "--verify", "--repo", f.repo, "--data-dir", f.dataDir],
        c.deps,
      ),
    ).toBe(0);
    expect(checks.map(({ command }) => command)).toEqual(VERIFY_COMMANDS);
    expect(checks.every(({ cwd }) => cwd === f.repo)).toBe(true);
    expect(c.out).toContain("verified: 4/4 checks green");
  });

  test("--verify stops at the first red check, keeps the commit, exits 1", async () => {
    const f = await fixture();
    const c = cli();
    const commands: string[] = [];
    c.deps.runCheck = (command) => {
      commands.push(command);
      if (command === "devbox run lint") throw new Error("red");
    };

    expect(
      await main(
        ["land", f.runId, "--verify", "--repo", f.repo, "--data-dir", f.dataDir],
        c.deps,
      ),
    ).toBe(1);
    expect(commands).toEqual(["devbox run build", "devbox run lint"]);
    expect(git(f.repo, ["rev-list", "--count", `${f.baseSha}..HEAD`])).toBe("1");
    expect(c.err).toEqual([
      expect.stringContaining("verification failed: devbox run lint"),
      expect.stringContaining("commit kept"),
    ]);
  });

  test("git failures surface git's stderr in the error message", async () => {
    const f = await fixture();
    await writeFile(join(f.repo, "landed.txt"), "from host repository\n");
    git(f.repo, ["add", "--all"]);
    git(f.repo, ["commit", "-m", "feat: conflicting host change"]);
    const c = cli();

    expect(
      await main(["land", f.runId, "--repo", f.repo, "--data-dir", f.dataDir], c.deps),
    ).toBe(1);
    expect(c.err).toHaveLength(1);
    expect(c.err[0]).toContain("land failed");
    expect(c.err[0]).toContain("landed.txt");
  });
});
