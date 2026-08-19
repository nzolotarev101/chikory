import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  assertGitWorkspace,
  clearStaleIndexLock,
} from "../../src/executors/workspace.js";

const execFileAsync = promisify(execFile);

async function makeGitRepo(): Promise<{ dir: string }> {
  const parentDir = await mkdtemp(join(tmpdir(), "chikory-workspace-test-"));
  await execFileAsync("git", ["-C", parentDir, "init", "-q"]);
  await execFileAsync("git", ["-C", parentDir, "config", "user.email", "test@chikory.dev"]);
  await execFileAsync("git", ["-C", parentDir, "config", "user.name", "chikory-test"]);
  return { dir: parentDir };
}

describe("clearStaleIndexLock", () => {
  it("removes index.lock when it exists in a git repo", async () => {
    const { dir } = await makeGitRepo();
    const lockPath = join(dir, ".git", "index.lock");
    await writeFile(lockPath, "lock content");
    expect(existsSync(lockPath)).toBe(true);

    await clearStaleIndexLock(dir);

    expect(existsSync(lockPath)).toBe(false);
  });

  it("handles a git repo with no index.lock without error", async () => {
    const { dir } = await makeGitRepo();
    const lockPath = join(dir, ".git", "index.lock");
    expect(existsSync(lockPath)).toBe(false);

    await expect(clearStaleIndexLock(dir)).resolves.toBeUndefined();
  });

  it("catches errors and resolves cleanly when directory is not a git workspace", async () => {
    const nonGitDir = await mkdtemp(join(tmpdir(), "chikory-nongit-"));
    await expect(clearStaleIndexLock(nonGitDir)).resolves.toBeUndefined();
  });

  it("catches errors and resolves cleanly when directory does not exist", async () => {
    const nonexistentDir = join(tmpdir(), `nonexistent-${Date.now()}`);
    await expect(clearStaleIndexLock(nonexistentDir)).resolves.toBeUndefined();
  });
});

describe("assertGitWorkspace", () => {
  it("passes for a valid git repo", async () => {
    const { dir } = await makeGitRepo();
    await expect(assertGitWorkspace(dir)).resolves.toBeUndefined();
  });

  it("throws when directory is not a git worktree", async () => {
    const nonGitDir = await mkdtemp(join(tmpdir(), "chikory-nongit-"));
    await expect(assertGitWorkspace(nonGitDir)).rejects.toThrow(
      "workspaceDir is not a git worktree",
    );
  });
});
