import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { runCriteriaChecks } from "../../src/judge/evidence.js";

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

async function createWorkspace(): Promise<{ workspace: string; baseCommit: string }> {
  const dir = await mkdtemp(join(tmpdir(), "chikory-evidence-perf-"));
  await execFileAsync("git", ["init", "-q", dir]);
  await git(dir, ["config", "user.email", "test@chikory.dev"]);
  await git(dir, ["config", "user.name", "chikory-test"]);
  await writeFile(join(dir, "app.ts"), "export const value = 1;\n");
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-q", "-m", "base"]);
  const baseCommit = (await git(dir, ["rev-parse", "HEAD"])).trim();
  return { workspace: dir, baseCommit };
}

describe("runCriteriaChecks performance benchmark", () => {
  it("measures baseline parallelized run speed", async () => {
    const created = await createWorkspace();
    workspace = created.workspace;

    const startTime = Date.now();
    const runs = await runCriteriaChecks({
      workspaceDir: workspace,
      criteria: [
        { id: "AC-1", description: "check 1", check: "sleep 1" },
        { id: "AC-2", description: "check 2", check: "sleep 1" },
        { id: "AC-3", description: "check 3", check: "sleep 1" },
      ],
    });
    const elapsed = Date.now() - startTime;

    console.log(`[BENCHMARK] Elapsed time: ${elapsed}ms`);
    expect(runs.length).toBe(3);
    expect(runs.every((r) => r.exitCode === 0)).toBe(true);

    // In parallel, it should take < 2000ms (typically around 1000-1200ms).
    expect(elapsed).toBeLessThan(2000);
  }, 10_000);
});
