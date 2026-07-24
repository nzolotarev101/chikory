import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { createMemoryArtifactStore } from "../../src/artifacts/index.js";
import { collectEvidence } from "../../src/judge/evidence.js";
import type { AcceptanceCriterion } from "../../src/types.js";

const execFileAsync = promisify(execFile);

async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", dir, ...args]);
  return stdout;
}

let workspace: string | undefined;

afterEach(async () => {
  if (workspace) {
    await rm(workspace, { recursive: true, force: true });
    workspace = undefined;
  }
});

describe("judge acceptance check hermeticity live e2e", () => {
  it("restores workspace to exact pre-check executor state after acceptance checks run", async () => {
    workspace = await mkdtemp(join(tmpdir(), "chikory-hermeticity-live-"));
    await execFileAsync("git", ["init", "-q", workspace]);
    await git(workspace, ["config", "user.email", "test@chikory.dev"]);
    await git(workspace, ["config", "user.name", "chikory-test"]);

    // 1. Establish baseline commit
    await writeFile(join(workspace, "existing.txt"), "Original content\n");
    await writeFile(join(workspace, "README.md"), "Baseline README\n");
    await git(workspace, ["add", "-A"]);
    await git(workspace, ["commit", "-q", "-m", "baseline"]);
    const baseCommit = (await git(workspace, ["rev-parse", "HEAD"])).trim();

    // 2. Executor makes UNCOMMITTED changes: modifies existing.txt, creates executor-new.txt
    await writeFile(join(workspace, "existing.txt"), "Original content\nExecutor change\n");
    await writeFile(join(workspace, "executor-new.txt"), "Executor new file content\n");
    await git(workspace, ["add", "-N", "."]);

    const preStatus = await git(workspace, ["status", "--porcelain"]);
    expect(preStatus).toContain("existing.txt");
    expect(preStatus).toContain("executor-new.txt");

    // 3. Acceptance check probe writes new file (probe-created.txt) and appends to existing.txt
    const criterion: AcceptanceCriterion = {
      id: "AC-R4-PROBE",
      description: "brownfield-003 R4 probe check",
      check: "echo 'Probe addition' >> existing.txt && echo 'Probe created' > probe-created.txt",
    };

    // 4. Run real judge evidence collection
    const collected = await collectEvidence({
      workspaceDir: workspace,
      store: createMemoryArtifactStore(),
      criteria: [criterion],
      sinceCommit: baseCommit,
      criteriaHistory: {},
      stepSummaries: [],
    });

    expect(collected.checkRuns[0].exitCode).toBe(0);

    // 5. Assert check's own side-effect files/changes are gone
    expect(existsSync(join(workspace, "probe-created.txt"))).toBe(false);
    const existingContent = await readFile(join(workspace, "existing.txt"), "utf8");
    expect(existingContent).toBe("Original content\nExecutor change\n");
    expect(existingContent).not.toContain("Probe addition");

    // 6. Assert executor's uncommitted changes survive untouched
    expect(existsSync(join(workspace, "executor-new.txt"))).toBe(true);
    const executorNewContent = await readFile(join(workspace, "executor-new.txt"), "utf8");
    expect(executorNewContent).toBe("Executor new file content\n");

    const postStatus = await git(workspace, ["status", "--porcelain"]);
    expect(postStatus).toBe(preStatus);
  });
});
