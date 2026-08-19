import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  createMemoryArtifactStore,
  createRunnerActivities,
  Journal,
  journalPath,
  workspaceDir,
  type AdapterRegistry,
  type TaskSpec,
} from "../../src/index.js";

const exec = promisify(execFile);
const git = async (cwd: string, args: string[]): Promise<string> =>
  (await exec("git", args, { cwd })).stdout.trim();

interface WorkspaceFixture {
  runId: string;
  writeSet: string[];
  extraWrites: Array<{ path: string; content?: string }>;
  gitignoreContent?: string;
  forceAddPaths?: string[];
}

describe("publishChainHandoff write boundary enforcement (WP-589)", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()!();
    }
  });

  async function createFixture(fixture: WorkspaceFixture): Promise<{ dataDir: string }> {
    const dataDir = await mkdtemp(join(tmpdir(), "handoff-wb-"));
    cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
    const ws = workspaceDir(dataDir, fixture.runId);
    await mkdir(ws, { recursive: true });
    await git(ws, ["init", "-b", "main"]);
    await git(ws, ["config", "user.email", "test@test.local"]);
    await git(ws, ["config", "user.name", "test"]);
    await mkdir(join(ws, "src"), { recursive: true });
    await writeFile(join(ws, "src/a.ts"), "export const a = 1;\n");
    await writeFile(
      join(ws, ".gitignore"),
      fixture.gitignoreContent ?? "results/\nnode_modules/\n",
    );
    await git(ws, ["add", "-A"]);
    await git(ws, ["commit", "-m", "base"]);
    await git(ws, ["tag", "chikory-base"]);
    await git(ws, ["checkout", "-b", `chikory/run-${fixture.runId}`]);

    await writeFile(join(ws, "src/a.ts"), "export const a = 2;\n");
    for (const write of fixture.extraWrites) {
      const fullPath = join(ws, write.path);
      await mkdir(join(fullPath, ".."), { recursive: true });
      await writeFile(fullPath, write.content ?? "test data\n");
    }
    for (const forcePath of fixture.forceAddPaths ?? []) {
      await git(ws, ["add", "-f", forcePath]);
    }
    await git(ws, ["add", "-A"]);
    await git(ws, ["commit", "-m", "node step work"]);

    const spec = {
      name: "handoff-boundary-test",
      goal: "verify boundary enforcement",
      acceptanceCriteria: [{ id: "AC-1", description: "done" }],
      budgetUsd: 5,
      repos: [{ url: ws, writable: true }],
      chainLink: {
        planId: "p-test",
        nodeId: "N-1",
        chainId: "c-test",
        writeSet: fixture.writeSet,
      },
    } as unknown as TaskSpec;

    const journal = new Journal(journalPath(dataDir, fixture.runId));
    journal.createRun(fixture.runId, spec);
    journal.close();

    return { dataDir };
  }

  it("fails when an undeclared gitignored write is present and names the path", async () => {
    const { dataDir } = await createFixture({
      runId: "run-undeclared-ignored",
      writeSet: ["src/a.ts"],
      extraWrites: [{ path: "results/big.txt", content: "data" }],
    });
    const activities = createRunnerActivities({
      dataDir,
      adapters: {} as AdapterRegistry,
      handoffStore: createMemoryArtifactStore(),
    });

    const result = await activities.publishChainHandoff({ runId: "run-undeclared-ignored" });
    expect(result.status).toBe("FAILED");
    if (result.status === "FAILED") {
      expect(result.reason).toContain("results/big.txt");
    }
  });

  it("succeeds when the gitignored path is declared in writeSet and preserves tracked changedPaths", async () => {
    const { dataDir } = await createFixture({
      runId: "run-declared-ignored",
      writeSet: ["src/a.ts", "results/big.txt"],
      extraWrites: [{ path: "results/big.txt", content: "data" }],
    });
    const activities = createRunnerActivities({
      dataDir,
      adapters: {} as AdapterRegistry,
      handoffStore: createMemoryArtifactStore(),
    });

    const result = await activities.publishChainHandoff({ runId: "run-declared-ignored" });
    expect(result.status).toBe("SUCCESS");
    if (result.status === "SUCCESS") {
      expect(result.handoff.repos[0]?.changedPaths).toEqual(["src/a.ts"]);
    }
  });

  it("succeeds when undeclared writes are inside node_modules (toolchain exemption)", async () => {
    const { dataDir } = await createFixture({
      runId: "run-exempt-node-modules",
      writeSet: ["src/a.ts"],
      extraWrites: [{ path: "node_modules/pkg/lib/util.js", content: "export {};" }],
    });
    const activities = createRunnerActivities({
      dataDir,
      adapters: {} as AdapterRegistry,
      handoffStore: createMemoryArtifactStore(),
    });

    const result = await activities.publishChainHandoff({ runId: "run-exempt-node-modules" });
    expect(result.status).toBe("SUCCESS");
    if (result.status === "SUCCESS") {
      expect(result.handoff.repos[0]?.changedPaths).toEqual(["src/a.ts"]);
    }
  });

  it("fails when an undeclared tracked write is present", async () => {
    const { dataDir } = await createFixture({
      runId: "run-undeclared-tracked",
      writeSet: ["src/a.ts"],
      extraWrites: [{ path: "docs/notes.md", content: "extra doc" }],
    });
    const activities = createRunnerActivities({
      dataDir,
      adapters: {} as AdapterRegistry,
      handoffStore: createMemoryArtifactStore(),
    });

    const result = await activities.publishChainHandoff({ runId: "run-undeclared-tracked" });
    expect(result.status).toBe("FAILED");
    if (result.status === "FAILED") {
      expect(result.reason).toContain("docs/notes.md");
    }
  });

  it("bounds failure reason under 2000 characters and names the directory when 400 files are in an ignored directory", async () => {
    const extraWrites = Array.from({ length: 400 }, (_, i) => ({
      path: `results/f${i}.txt`,
      content: "x".repeat(64),
    }));
    const { dataDir } = await createFixture({
      runId: "run-400-ignored",
      writeSet: ["src/a.ts"],
      extraWrites,
    });
    const activities = createRunnerActivities({
      dataDir,
      adapters: {} as AdapterRegistry,
      handoffStore: createMemoryArtifactStore(),
    });

    const start = Date.now();
    const result = await activities.publishChainHandoff({ runId: "run-400-ignored" });
    const elapsed = Date.now() - start;

    expect(result.status).toBe("FAILED");
    if (result.status === "FAILED") {
      expect(result.reason).toContain("results");
      expect(result.reason.length).toBeLessThanOrEqual(2000);
    }
    expect(elapsed).toBeLessThan(60_000);
  });

  it("succeeds when 300 files are written inside node_modules", async () => {
    const extraWrites = Array.from({ length: 300 }, (_, i) => ({
      path: `node_modules/pkg/f${i}.txt`,
      content: "x".repeat(64),
    }));
    const { dataDir } = await createFixture({
      runId: "run-300-exempt",
      writeSet: ["src/a.ts"],
      extraWrites,
    });
    const activities = createRunnerActivities({
      dataDir,
      adapters: {} as AdapterRegistry,
      handoffStore: createMemoryArtifactStore(),
    });

    const result = await activities.publishChainHandoff({ runId: "run-300-exempt" });
    expect(result.status).toBe("SUCCESS");
  });

  it("admits gitignored files in a declared directory under directory-scoped admission", async () => {
    // Declared writeSet contains results/placeholder.txt, owning the results/ dir
    const { dataDir } = await createFixture({
      runId: "run-declared-dir-ignored",
      writeSet: ["src/a.ts", "results/placeholder.txt"],
      extraWrites: [{ path: "results/big.txt", content: "data" }],
    });
    const activities = createRunnerActivities({
      dataDir,
      adapters: {} as AdapterRegistry,
      handoffStore: createMemoryArtifactStore(),
    });

    const result = await activities.publishChainHandoff({ runId: "run-declared-dir-ignored" });
    expect(result.status).toBe("SUCCESS");
  });

  it("fails when an undeclared tracked write is inside node_modules", async () => {
    const { dataDir } = await createFixture({
      runId: "run-tracked-node-modules",
      writeSet: ["src/a.ts"],
      extraWrites: [{ path: "node_modules/pkg/lib.js", content: "export const x = 1;" }],
      forceAddPaths: ["node_modules/pkg/lib.js"],
    });
    const activities = createRunnerActivities({
      dataDir,
      adapters: {} as AdapterRegistry,
      handoffStore: createMemoryArtifactStore(),
    });

    const result = await activities.publishChainHandoff({ runId: "run-tracked-node-modules" });
    expect(result.status).toBe("FAILED");
    if (result.status === "FAILED") {
      expect(result.reason).toContain("node_modules/pkg/lib.js");
    }
  });

  it("fails when an undeclared untracked non-ignored write is inside node_modules", async () => {
    const { dataDir } = await createFixture({
      runId: "run-untracked-non-ignored-node-modules",
      writeSet: ["src/a.ts"],
      gitignoreContent: "results/\n", // node_modules not in .gitignore
      extraWrites: [{ path: "node_modules/pkg/lib.js", content: "export const x = 1;" }],
    });
    const activities = createRunnerActivities({
      dataDir,
      adapters: {} as AdapterRegistry,
      handoffStore: createMemoryArtifactStore(),
    });

    const result = await activities.publishChainHandoff({
      runId: "run-untracked-non-ignored-node-modules",
    });
    expect(result.status).toBe("FAILED");
    if (result.status === "FAILED") {
      expect(result.reason).toContain("node_modules/pkg/lib.js");
    }
  });
  // F-401 (dogfood-158 review): the shipped exemption listed `node_modules` alone —
  // the only family AC-1 drove. These are the ignore families a REAL chikory
  // workspace actually accumulates, measured in
  // `.chikory/runs/run-f3d47cf8-6d56-4c7b-85d1-fcfe185badef/workspace`:
  // packages/sdk-ts/dist (604 files), .venv (1,906), benchmarks/harness/dist (64),
  // .devbox (31). Each one of them sealed FAILED before this fix.
  const REAL_GITIGNORE = [
    "node_modules/",
    "dist/",
    "build/",
    ".venv/",
    "__pycache__/",
    ".pytest_cache/",
    ".ruff_cache/",
    ".devbox/",
    ".temporal/",
    ".chikory/",
    "coverage/",
    "test-results/",
    "*.tsbuildinfo",
    "benchmarks/runs/",
    "benchmarks/results/",
  ].join("\n");

  const TOOLCHAIN_FAMILIES: Array<[string, string]> = [
    ["dependency install", "node_modules/pkg/lib/util.js"],
    ["tsc build output", "packages/sdk-ts/dist/chain/write-set.js"],
    ["nested build output", "benchmarks/harness/dist/index.js"],
    ["python virtualenv", ".venv/lib/python3.11/site-packages/pkg/mod.py"],
    ["python bytecode cache", "packages/sdk-py/__pycache__/runner.cpython-311.pyc"],
    ["ruff cache", ".ruff_cache/0.4.0/12345"],
    ["devbox activation", ".devbox/gen/scripts/run.sh"],
    ["chikory run data", ".chikory/runs/run-x/journal.db"],
    ["vitest coverage", "coverage/index.html"],
    ["incremental build stamp", "packages/sdk-ts/tsconfig.tsbuildinfo"],
  ];

  it.each(TOOLCHAIN_FAMILIES)(
    "seals when the only undeclared ignored write is %s output (F-401)",
    async (label, path) => {
      const runId = `run-toolchain-${label.replace(/[^a-z]+/gi, "-")}`;
      const { dataDir } = await createFixture({
        runId,
        writeSet: ["src/a.ts"],
        gitignoreContent: REAL_GITIGNORE,
        extraWrites: [{ path, content: "toolchain output\n" }],
      });
      const activities = createRunnerActivities({
        dataDir,
        adapters: {} as AdapterRegistry,
        handoffStore: createMemoryArtifactStore(),
      });

      const result = await activities.publishChainHandoff({ runId });
      expect(
        result.status,
        `${label} (${path}) is the toolchain's own output — a boundary that fails every node ` +
          `that built the package or touched the venv is worse than the hole it closes: ` +
          JSON.stringify(result).slice(0, 300),
      ).toBe("SUCCESS");
      if (result.status === "SUCCESS") {
        expect(result.handoff.repos[0]?.changedPaths).toEqual(["src/a.ts"]);
      }
    },
  );

  it.each([
    ["benchmark run output (the dogfood-123 escape)", "benchmarks/results/p3/arm/summary.json"],
    ["benchmark workspace clone", "benchmarks/runs/2026/workspace/big.bin"],
    ["a file merely NAMED like build output", "lib/dist.ts"],
    ["a directory merely CONTAINING a toolchain name", "lib/not_node_modules/file.ts"],
  ])("still fails on an undeclared ignored %s (F-401 must not over-exempt)", async (_label, path) => {
    const runId = `run-nonexempt-${path.replace(/[^a-z]+/gi, "-")}`;
    const { dataDir } = await createFixture({
      runId,
      writeSet: ["src/a.ts"],
      gitignoreContent: `${REAL_GITIGNORE}\nlib/\n`,
      extraWrites: [{ path, content: "escaped data\n" }],
    });
    const activities = createRunnerActivities({
      dataDir,
      adapters: {} as AdapterRegistry,
      handoffStore: createMemoryArtifactStore(),
    });

    const result = await activities.publishChainHandoff({ runId });
    expect(result.status).toBe("FAILED");
    if (result.status === "FAILED") {
      expect(result.reason).toContain(path);
    }
  });
});
