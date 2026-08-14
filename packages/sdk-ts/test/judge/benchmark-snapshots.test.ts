import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";

import { snapshotWorkspace } from "../../src/judge/hermeticity.js";

function initRepo(at: string): void {
  for (const args of [
    ["init", "-q"],
    ["config", "user.email", "test@chikory.local"],
    ["config", "user.name", "test"],
    ["add", "-A"],
    ["commit", "-qm", "base"],
  ]) {
    execFileSync("git", args, { cwd: at, stdio: "ignore" });
  }
}

describe("Benchmark workspace snapshotting", () => {
  it("measures snapshotting time for multiple repositories", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "benchmark-snapshots-"));
    const repoCount = 10;
    const repoDirs: string[] = [];

    // Create 10 mock repositories
    for (let i = 0; i < repoCount; i++) {
      const repoDir = join(rootDir, `repo-${i}`);
      mkdirSync(repoDir, { recursive: true });
      writeFileSync(join(repoDir, "file.txt"), `content ${i}\n`);
      initRepo(repoDir);
      repoDirs.push(repoDir);
    }

    try {
      // 1. Sequential Snapshotting
      const seqStart = performance.now();
      const seqSnapshots = new Map<string, unknown>();
      for (const dir of repoDirs) {
        seqSnapshots.set(dir, await snapshotWorkspace(dir));
      }
      const seqEnd = performance.now();
      const seqDuration = seqEnd - seqStart;

      // 2. Concurrent Snapshotting
      const conStart = performance.now();
      const conSnapshotsList = await Promise.all(
        repoDirs.map((dir) => snapshotWorkspace(dir))
      );
      const conSnapshots = new Map<string, unknown>();
      repoDirs.forEach((dir, idx) => {
        conSnapshots.set(dir, conSnapshotsList[idx]);
      });
      const conEnd = performance.now();
      const conDuration = conEnd - conStart;

      console.log("-----------------------------------------");
      console.log(`Sequential snapshotting of ${repoCount} repos took: ${seqDuration.toFixed(2)} ms`);
      console.log(`Concurrent snapshotting of ${repoCount} repos took: ${conDuration.toFixed(2)} ms`);
      console.log(`Speedup factor: ${(seqDuration / conDuration).toFixed(2)}x`);
      console.log("-----------------------------------------");
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
