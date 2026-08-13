import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

import { collectPerRepoDiffs } from "../../src/judge/evidence.js";

const execFileAsync = promisify(execFile);

async function initRepo(dir: string, fileName: string, content: string): Promise<string> {
  await execFileAsync("git", ["init", "-b", "main", dir]);
  await execFileAsync("git", ["-C", dir, "config", "user.name", "test"]);
  await execFileAsync("git", ["-C", dir, "config", "user.email", "test@chikory.local"]);
  await writeFile(join(dir, fileName), content);
  await execFileAsync("git", ["-C", dir, "add", "-A"]);
  await execFileAsync("git", ["-C", dir, "commit", "-m", "init"]);
  return dir;
}

describe("collectPerRepoDiffs parallelization & correctness", () => {
  test("collects diffs correctly for multiple repositories", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-evidence-parallel-test-"));
    try {
      const repo1Dir = join(tmp, "repo-1");
      const repo2Dir = join(tmp, "repo-2");
      const repo3Dir = join(tmp, "repo-3");

      await initRepo(repo1Dir, "file1.txt", "initial file 1\n");
      await initRepo(repo2Dir, "file2.txt", "initial file 2\n");
      await initRepo(repo3Dir, "file3.txt", "initial file 3\n");

      // Modify files to create diffs
      await writeFile(join(repo1Dir, "file1.txt"), "initial file 1\nmodified file 1\n");
      await writeFile(join(repo2Dir, "file2.txt"), "initial file 2\nmodified file 2\n");
      await writeFile(join(repo3Dir, "file3.txt"), "initial file 3\nmodified file 3\n");

      // Add untracked files
      await writeFile(join(repo1Dir, "untracked1.txt"), "untracked file 1\n");

      const input = {
        workspaceDir: tmp,
        sinceCommit: "HEAD",
        workspaceRepos: [
          { name: "repo-1", relativePath: "repo-1", writable: true },
          { name: "repo-2", relativePath: "repo-2", writable: true },
          { name: "repo-3", relativePath: "repo-3", writable: false }, // read-only repo
        ],
        repoDiffBases: {
          "repo-1": "HEAD",
          "repo-2": "HEAD",
        },
      };

      const result = await collectPerRepoDiffs(input);

      expect(result.perRepoDiff).toBe(true);
      // Only writable repos should be included
      expect(result.sections).toHaveLength(2);

      const section1 = result.sections.find((s) => s.repoName === "repo-1");
      const section2 = result.sections.find((s) => s.repoName === "repo-2");

      expect(section1).toBeDefined();
      expect(section2).toBeDefined();

      expect(section1?.diffText).toContain("+modified file 1");
      expect(section1?.diffText).toContain("untracked1.txt"); // added -N makes untracked show up as added

      expect(section2?.diffText).toContain("+modified file 2");
      expect(section2?.diffText).not.toContain("untracked");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test("collects single root repo correctly", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-evidence-single-test-"));
    try {
      await initRepo(tmp, "file.txt", "initial file\n");
      await writeFile(join(tmp, "file.txt"), "initial file\nmodified file\n");

      const input = {
        workspaceDir: tmp,
        sinceCommit: "HEAD",
        workspaceRepos: [
          { name: "single", relativePath: ".", writable: true },
        ],
      };

      const result = await collectPerRepoDiffs(input);

      expect(result.perRepoDiff).toBe(false);
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].repoName).toBe("single");
      expect(result.sections[0].diffText).toContain("+modified file");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
