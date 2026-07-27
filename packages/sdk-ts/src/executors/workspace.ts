/**
 * Workspace diff capture (WP-111). The workspace is always a git worktree;
 * the runner guarantees a clean tree at step start (the checkpointer commits
 * after every step), so the step's work product is exactly `git diff` against
 * that state. The adapter never commits (executors.md: commits belong to the
 * checkpointer).
 */
import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function git(workspaceDir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", workspaceDir, ...args], {
    maxBuffer: 256 * 1024 * 1024,
  });
  return stdout;
}

/**
 * Remove a stale `index.lock` left by a git process that was killed
 * mid-operation — e.g. an executor step tripped its `maxSeconds` cap (SIGKILL)
 * while a git call held the index. The per-run workspace is single-writer, so a
 * leftover lock is always stale; left in place it makes the retry's
 * `git add -N .` hard-fail ("Unable to create '.git/index.lock': File exists")
 * and Temporal then retries the activity forever (F-150). `--git-path` resolves
 * the lock location for both normal and worktree layouts. Best-effort: a missing
 * lock or removal race is non-fatal — the real git op surfaces any true problem.
 */
export async function clearStaleIndexLock(workspaceDir: string): Promise<void> {
  try {
    const lockPath = (await git(workspaceDir, ["rev-parse", "--git-path", "index.lock"])).trim();
    if (lockPath.length === 0) return;
    await rm(isAbsolute(lockPath) ? lockPath : join(workspaceDir, lockPath), { force: true });
  } catch {
    // No workspace / no lock / racing cleanup — non-fatal.
  }
}

/** Throws when `workspaceDir` is not inside a git worktree (step precondition). */
export async function assertGitWorkspace(workspaceDir: string): Promise<void> {
  try {
    await git(workspaceDir, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    throw new Error(
      `workspaceDir is not a git worktree: ${workspaceDir} — steps require a prepared workspace`,
    );
  }
}

/**
 * Unified diff of everything the step changed, including untracked files
 * (`git add -N` makes them diffable without staging content; the
 * checkpointer's later `git add -A` supersedes the intent-to-add entries).
 */
export async function captureWorkspaceDiff(workspaceDir: string): Promise<string> {
  await clearStaleIndexLock(workspaceDir);
  await git(workspaceDir, ["add", "-N", "."]);
  return git(workspaceDir, ["diff"]);
}

/**
 * Dirty paths in the repo this workspace was CLONED FROM (F-192).
 *
 * The workspace is a clone whose `origin` is a local path, and it lives at
 * `<dataDir>/runs/<id>/workspace` — i.e. INSIDE that source repo. Nothing
 * structurally separates the two: an executor launched with
 * `--dangerously-skip-permissions` can read `origin` out of `.git/config` and
 * edit the source checkout instead of the sandbox. When it does, the workspace
 * diff is 0 bytes and the harness cannot tell "the executor did nothing" from
 * "the executor did everything, somewhere else" — dogfood-115
 * (`run-c19147fe`) burned 4 steps and sealed FAILED while a complete, all-ACs-
 * green delivery sat unversioned in the operator's checkout.
 *
 * Returns `null` when `origin` is absent or not a local path (nothing to
 * compare); otherwise the porcelain path set, sampled before and after a step
 * so a repo that was ALREADY dirty at run start does not read as an escape.
 */
export async function sourceRepoDirtyPaths(workspaceDir: string): Promise<Set<string> | null> {
  try {
    const origin = (await git(workspaceDir, ["remote", "get-url", "origin"])).trim();
    if (origin.length === 0 || !isAbsolute(origin)) return null;
    const porcelain = await git(origin, ["status", "--porcelain"]);
    return new Set(
      porcelain
        .split("\n")
        .map((line) => line.slice(3).trim())
        .filter((p) => p.length > 0),
    );
  } catch {
    // No origin / not a repo / unreadable — the detector simply does not arm.
    return null;
  }
}
