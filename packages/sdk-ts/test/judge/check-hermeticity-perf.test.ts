import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyCleanupPlan } from "../../src/judge/hermeticity.js";
import type { CheckSideEffectCleanupPlan, WorkspaceDirtySnapshot } from "../../src/judge/hermeticity.js";

const execFileAsync = promisify(execFile);

async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", dir, ...args]);
  return stdout;
}

describe("applyCleanupPlan Performance Benchmark", () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "chikory-hermeticity-perf-"));
    await execFileAsync("git", ["init", "-q", workspace]);
    await git(workspace, ["config", "user.email", "perf@chikory.dev"]);
    await git(workspace, ["config", "user.name", "chikory-perf"]);
  });

  afterEach(async () => {
    if (workspace) {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("measures performance of applyCleanupPlan with delete, restore from memory, and restore from git", async () => {
    // 1. Setup tracked files in baseline commit (for git checkout test)
    const trackedFilesCount = 30;
    const checkoutPaths: string[] = [];
    for (let i = 0; i < trackedFilesCount; i++) {
      const relPath = `tracked_${i}.txt`;
      checkoutPaths.push(relPath);
      await writeFile(join(workspace, relPath), `Initial content ${i}\n`);
    }
    await git(workspace, ["add", "-A"]);
    await git(workspace, ["commit", "-q", "-m", "baseline"]);

    // 2. Modify these tracked files so they need restoring via git checkout
    for (let i = 0; i < trackedFilesCount; i++) {
      await writeFile(join(workspace, `tracked_${i}.txt`), `Modified content ${i}\n`);
    }

    // 3. Create a large number of untracked files to delete
    const deleteCount = 100;
    const toDelete: string[] = [];
    for (let i = 0; i < deleteCount; i++) {
      const relPath = `untracked_${i}.txt`;
      toDelete.push(relPath);
      await writeFile(join(workspace, relPath), `To be deleted ${i}\n`);
    }

    // 4. Create a large number of modified files to restore from snapshot memory
    const memoryRestoreCount = 100;
    const toRestoreMemory: string[] = [];
    const beforeSnapshotEntries: { path: string; status: string; content: string }[] = [];
    for (let i = 0; i < memoryRestoreCount; i++) {
      const relPath = `mem_restore_${i}.txt`;
      toRestoreMemory.push(relPath);
      // Create with "modified" content initially, but the snapshot has the "original" content
      await writeFile(join(workspace, relPath), `Modified memory content ${i}\n`);
      beforeSnapshotEntries.push({
        path: relPath,
        status: "M",
        content: `Original memory content ${i}\n`,
      });
    }

    // Combine all toRestore
    const plan: CheckSideEffectCleanupPlan = {
      toDelete,
      toRestore: [...checkoutPaths, ...toRestoreMemory],
    };

    const beforeSnapshot: WorkspaceDirtySnapshot = beforeSnapshotEntries;

    // Run measurement
    const startTime = performance.now();
    await applyCleanupPlan(workspace, plan, beforeSnapshot);
    const duration = performance.now() - startTime;

    console.log(`[PERF_BENCHMARK] applyCleanupPlan took ${duration.toFixed(2)} ms`);

    // Verify correctness: Deletions
    for (const relPath of toDelete) {
      expect(existsSync(join(workspace, relPath))).toBe(false);
    }

    // Verify correctness: Memory restores
    for (let i = 0; i < memoryRestoreCount; i++) {
      const content = await import("node:fs/promises").then((fs) =>
        fs.readFile(join(workspace, `mem_restore_${i}.txt`), "utf8")
      );
      expect(content).toBe(`Original memory content ${i}\n`);
    }

    // Verify correctness: Git restores
    for (let i = 0; i < trackedFilesCount; i++) {
      const content = await import("node:fs/promises").then((fs) =>
        fs.readFile(join(workspace, `tracked_${i}.txt`), "utf8")
      );
      expect(content).toBe(`Initial content ${i}\n`);
    }

    // Pass a dummy expectation to ensure test runs
    expect(duration).toBeGreaterThan(0);
  });
});
