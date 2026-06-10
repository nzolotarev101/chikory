/**
 * Workspace diff capture (WP-111). The workspace is always a git worktree;
 * the runner guarantees a clean tree at step start (the checkpointer commits
 * after every step), so the step's work product is exactly `git diff` against
 * that state. The adapter never commits (executors.md: commits belong to the
 * checkpointer).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function git(workspaceDir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", workspaceDir, ...args], {
    maxBuffer: 256 * 1024 * 1024,
  });
  return stdout;
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
  await git(workspaceDir, ["add", "-N", "."]);
  return git(workspaceDir, ["diff"]);
}
