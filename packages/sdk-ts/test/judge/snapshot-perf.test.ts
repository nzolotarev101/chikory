import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { snapshotWorkspace, type GitDirtyEntry } from "../../src/judge/hermeticity.js";

const execFileAsync = promisify(execFile);

async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", dir, ...args]);
  return stdout;
}

describe("snapshotWorkspace performance benchmark", () => {
  let tempDirs: string[] = [];

  beforeEach(async () => {
    tempDirs = [];
    // Setup 5 independent git repositories
    for (let i = 0; i < 5; i++) {
      const dir = await mkdtemp(join(tmpdir(), `chikory-perf-repo-${i}-`));
      tempDirs.push(dir);

      await execFileAsync("git", ["init", "-q", dir]);
      await git(dir, ["config", "user.email", "test@chikory.dev"]);
      await git(dir, ["config", "user.name", "chikory-test"]);

      // Add a baseline file
      await writeFile(join(dir, "baseline.txt"), "This is some baseline content\n");
      await git(dir, ["add", "-A"]);
      await git(dir, ["commit", "-q", "-m", "initial"]);

      // Modify the baseline file and add a new untracked file
      await writeFile(join(dir, "baseline.txt"), "This is modified content\n");
      await writeFile(join(dir, "new-file.txt"), "This is new untracked content\n");
    }
  }, 15000);

  afterEach(async () => {
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("compares sequential vs concurrent snapshotting performance and correctness", async () => {
    // 1. Sequential snapshotting
    const startSeq = performance.now();
    const seqResults = new Map<string, Map<string, GitDirtyEntry>>();
    for (const dir of tempDirs) {
      seqResults.set(dir, await snapshotWorkspace(dir));
    }
    const endSeq = performance.now();
    const seqDuration = endSeq - startSeq;

    // 2. Concurrent snapshotting
    const startCon = performance.now();
    const conResults = new Map<string, Map<string, GitDirtyEntry>>();
    const concurrentPromises = tempDirs.map(async (dir) => {
      const snap = await snapshotWorkspace(dir);
      return { dir, snap };
    });
    const snaps = await Promise.all(concurrentPromises);
    for (const { dir, snap } of snaps) {
      conResults.set(dir, snap);
    }
    const endCon = performance.now();
    const conDuration = endCon - startCon;

    console.log(`[BENCHMARK] Sequential snapshotting of ${tempDirs.length} repos: ${seqDuration.toFixed(2)}ms`);
    console.log(`[BENCHMARK] Concurrent snapshotting of ${tempDirs.length} repos: ${conDuration.toFixed(2)}ms`);

    // Verify correctness: both maps should have identical content
    expect(conResults.size).toBe(seqResults.size);
    for (const dir of tempDirs) {
      const seqSnap = seqResults.get(dir);
      const conSnap = conResults.get(dir);
      expect(conSnap).toBeDefined();
      expect(seqSnap).toBeDefined();

      if (seqSnap && conSnap) {
        expect(conSnap.size).toBe(seqSnap.size);
        for (const [key, val] of seqSnap.entries()) {
          const conVal = conSnap.get(key);
          expect(conVal).toBeDefined();
          if (conVal) {
            expect(conVal.status).toBe(val.status);
            expect(conVal.hash).toBe(val.hash);
            expect(conVal.content).toBe(val.content);
          }
        }
      }
    }
  }, 30000);
});
