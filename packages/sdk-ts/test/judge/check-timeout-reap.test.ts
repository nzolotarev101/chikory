import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { createMemoryArtifactStore } from "../../src/artifacts/index.js";
import { collectEvidence } from "../../src/judge/evidence.js";

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
  const dir = await mkdtemp(join(tmpdir(), "chikory-check-timeout-reap-"));
  await execFileAsync("git", ["init", "-q", dir]);
  await git(dir, ["config", "user.email", "test@chikory.dev"]);
  await git(dir, ["config", "user.name", "chikory-test"]);
  await writeFile(join(dir, "app.ts"), "export const value = 1;\n");
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-q", "-m", "base"]);
  const baseCommit = (await git(dir, ["rev-parse", "HEAD"])).trim();
  return { workspace: dir, baseCommit };
}

describe("judge check timeout reaping (WP-264)", () => {
  it(
    "a check whose grandchild holds the pipe is reaped at the cap, not at the grandchild's leisure",
    async () => {
      const created = await createWorkspace();
      workspace = created.workspace;

      const collected = await collectEvidence({
        workspaceDir: workspace,
        store: createMemoryArtifactStore(),
        criteria: [
          { id: "AC-HANG", description: "hang-grandchild", check: "sleep 60 & sleep 60" },
        ],
        sinceCommit: created.baseCommit,
        criteriaHistory: {},
        stepSummaries: [],
        checkTimeoutMs: 1000,
      });

      expect(collected.checkRuns[0].exitCode).not.toBe(0);
      expect(collected.checkRuns[0].output).toContain("[check timed out after 1000ms]");
      expect(collected.checkRuns[0].durationMs).toBeLessThan(10_000);
    },
    30_000,
  );

  it("a fast green check still passes through unchanged", async () => {
    const created = await createWorkspace();
    workspace = created.workspace;

    const collected = await collectEvidence({
      workspaceDir: workspace,
      store: createMemoryArtifactStore(),
      criteria: [{ id: "AC-OK", description: "ok", check: "echo reap-ok" }],
      sinceCommit: created.baseCommit,
      criteriaHistory: {},
      stepSummaries: [],
    });

    expect(collected.checkRuns[0].exitCode).toBe(0);
    expect(collected.checkRuns[0].output).toContain("reap-ok");
    expect(collected.checkRuns[0].output).not.toContain("check timed out");
  });
});
