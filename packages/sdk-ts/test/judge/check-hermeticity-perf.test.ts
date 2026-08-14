import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applyCleanupPlan,
  planCheckSideEffectCleanup,
  snapshotWorkspace,
} from "../../src/judge/hermeticity.js";

const execFileAsync = promisify(execFile);

async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", dir, ...args]);
  return stdout;
}

describe("applyCleanupPlan performance benchmark", () => {
  let workspace: string | undefined;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "chikory-hermeticity-perf-"));
    await execFileAsync("git", ["init", "-q", workspace]);
    await git(workspace, ["config", "user.email", "test@chikory.dev"]);
    await git(workspace, ["config", "user.name", "chikory-test"]);
  });

  afterEach(async () => {
    if (workspace) {
      await rm(workspace, { recursive: true, force: true });
      workspace = undefined;
    }
  });

  it("measures performance of applyCleanupPlan with 50 deletions and 50 restorations", async () => {
    if (!workspace) throw new Error("No workspace");

    const numFiles = 50;

    // 1. Create baseline files and commit
    const pathsToModify: string[] = [];
    for (let i = 0; i < numFiles; i++) {
      const relPath = `file-${i}.txt`;
      pathsToModify.push(relPath);
      await writeFile(join(workspace, relPath), `Original content for file ${i}\n`);
    }

    await git(workspace, ["add", "-A"]);
    await git(workspace, ["commit", "-q", "-m", "baseline"]);

    // 2. Take before snapshot
    const beforeSnapshot = await snapshotWorkspace(workspace);

    // 3. Simulate check modifications (modify 50 existing files and create 50 untracked files)
    const pathsToDelete: string[] = [];
    for (let i = 0; i < numFiles; i++) {
      const relPath = `file-${i}.txt`;
      await writeFile(join(workspace, relPath), `Modified content for file ${i}\n`);

      const untrackedPath = `untracked-${i}.txt`;
      pathsToDelete.push(untrackedPath);
      await writeFile(join(workspace, untrackedPath), `Untracked content ${i}\n`);
    }

    // Generate after snapshot and plan
    const afterSnapshot = await snapshotWorkspace(workspace);
    const plan = planCheckSideEffectCleanup(beforeSnapshot, afterSnapshot);

    expect(plan.toDelete).toHaveLength(numFiles);
    expect(plan.toRestore).toHaveLength(numFiles);

    // 4. Measure execution time of applyCleanupPlan
    const start = performance.now();
    await applyCleanupPlan(workspace, plan, beforeSnapshot);
    const duration = performance.now() - start;

    console.log(`\n⏱️ Baseline Cleanup Duration for ${numFiles} files: ${duration.toFixed(2)}ms`);

    // Verify cleanup was successful
    const finalSnapshot = await snapshotWorkspace(workspace);
    const finalPlan = planCheckSideEffectCleanup(beforeSnapshot, finalSnapshot);
    expect(finalPlan.toDelete).toHaveLength(0);
    expect(finalPlan.toRestore).toHaveLength(0);
  });
});
