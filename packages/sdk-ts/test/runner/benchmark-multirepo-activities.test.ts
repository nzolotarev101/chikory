import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { commitAllRepos, type WorkspaceRepo } from "../../src/index.js";

function initRepo(at: string): void {
  for (const args of [
    ["init", "-b", "main", "-q"],
    ["config", "user.email", "test@chikory.local"],
    ["config", "user.name", "test"],
    ["add", "-A"],
    ["commit", "-qm", "base"],
    ["tag", "chikory-base"],
  ]) {
    execFileSync("git", args, { cwd: at, stdio: "ignore" });
  }
}

describe("Benchmark multi-repo activities", () => {
  it("measures performance of multi-repo commitAllRepos and git operations", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "benchmark-multirepo-"));
    const repoCount = 8;
    const workspaceRepos: WorkspaceRepo[] = [];

    for (let i = 0; i < repoCount; i++) {
      const name = `repo-${i}`;
      const repoDir = join(rootDir, name);
      mkdirSync(repoDir, { recursive: true });
      writeFileSync(join(repoDir, "file.txt"), `initial ${i}\n`);
      initRepo(repoDir);
      workspaceRepos.push({
        index: i,
        name,
        relativePath: name,
        repo: { url: repoDir, writable: true },
        writable: true,
      });
    }

    try {
      // Modify a file in each repository to simulate step changes
      for (let i = 0; i < repoCount; i++) {
        writeFileSync(join(rootDir, `repo-${i}`, "file.txt"), `modified ${i}\n`);
      }

      // Sequential execution measurement
      const seqStart = performance.now();
      for (const repo of workspaceRepos) {
        const repoDir = join(rootDir, repo.relativePath);
        execFileSync("git", ["-C", repoDir, "add", "-A"]);
        execFileSync("git", ["-C", repoDir, "commit", "-qm", "chikory: step 1"]);
      }
      const seqEnd = performance.now();
      const seqDuration = seqEnd - seqStart;

      // Reset repo files for second run
      for (let i = 0; i < repoCount; i++) {
        writeFileSync(join(rootDir, `repo-${i}`, "file.txt"), `modified again ${i}\n`);
      }

      // Concurrent commitAllRepos measurement
      const conStart = performance.now();
      const commits = await commitAllRepos({
        workspaceDir: rootDir,
        writableRepos: workspaceRepos,
        repoCount,
        stepIndex: 2,
      });
      const conEnd = performance.now();
      const conDuration = conEnd - conStart;

      expect(Object.keys(commits)).toHaveLength(repoCount);
      console.log("-----------------------------------------");
      console.log(`Sequential multi-repo git commits for ${repoCount} repos took: ${seqDuration.toFixed(2)} ms`);
      console.log(`Concurrent commitAllRepos for ${repoCount} repos took: ${conDuration.toFixed(2)} ms`);
      console.log(`Speedup factor: ${(seqDuration / conDuration).toFixed(2)}x`);
      console.log("-----------------------------------------");
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
