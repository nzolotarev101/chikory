/**
 * Sandbox-escape detection (F-192, dogfood-115 `run-c19147fe`).
 *
 * The run workspace is a clone of a LOCAL source repo and lives inside it, so
 * an executor running under `--dangerously-skip-permissions` can read `origin`
 * out of `.git/config` and edit the source checkout instead of the sandbox.
 * When it does, the workspace diff is 0 bytes and the step used to read
 * SUCCESS — indistinguishable from "the executor did nothing", while the real
 * delivery sat unversioned in the operator's checkout.
 *
 * The conformance suite's case (3) covers "never writes outside workspaceDir"
 * for an adapter that behaves; these cover what the HARNESS does when one
 * does not.
 */
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { createLocalArtifactStore } from "../../src/artifacts/index.js";
import { runCliStep } from "../../src/executors/step.js";
import { sourceRepoDirtyPaths } from "../../src/executors/workspace.js";
import type { ArtifactStore, StepInput } from "../../src/types.js";

const execFileAsync = promisify(execFile);

interface CloneFixture {
  sourceDir: string;
  workspaceDir: string;
  store: ArtifactStore;
}

/** A source repo with a committed file, plus a clone of it (origin = source). */
async function makeClone(): Promise<CloneFixture> {
  const parentDir = await mkdtemp(join(tmpdir(), "chikory-escape-"));
  const sourceDir = join(parentDir, "source");
  const workspaceDir = join(parentDir, "ws");
  await mkdir(sourceDir);
  await mkdir(join(parentDir, "artifacts"));
  const g = (dir: string, args: string[]) => execFileAsync("git", ["-C", dir, ...args]);
  await g(sourceDir, ["init", "-q"]);
  await g(sourceDir, ["config", "user.email", "escape@chikory.dev"]);
  await g(sourceDir, ["config", "user.name", "chikory-escape"]);
  await writeFile(join(sourceDir, "app.ts"), "export const answer = 41;\n");
  await g(sourceDir, ["add", "-A"]);
  await g(sourceDir, ["commit", "-q", "-m", "base"]);
  await execFileAsync("git", ["clone", "-q", sourceDir, workspaceDir]);
  await g(workspaceDir, ["config", "user.email", "escape@chikory.dev"]);
  await g(workspaceDir, ["config", "user.name", "chikory-escape"]);
  return {
    sourceDir,
    workspaceDir,
    store: createLocalArtifactStore(join(parentDir, "artifacts")),
  };
}

function stepInput(fx: CloneFixture): StepInput {
  return {
    workspaceDir: fx.workspaceDir,
    instruction: "edit app.ts",
    context: {
      goal: "Bump the answer.",
      acceptanceCriteria: [{ id: "AC-1", description: "answer is 42" }],
      planItem: "edit app.ts",
      notes: {},
      recentSteps: [],
      injections: [],
      memoryRefs: [],
    },
    limits: { maxSeconds: 30, maxCostUsd: 1 },
  };
}

/** Run `sh -c <script>`; the parser always reports a clean, successful turn. */
function runScript(fx: CloneFixture, script: string) {
  return runCliStep({
    adapterName: "fake-escaper",
    store: fx.store,
    input: stepInput(fx),
    bin: "sh",
    args: ["-c", script],
    parse: (stdout) => ({
      ok: true,
      summary: stdout.trim() || "done",
      toolCalls: 0,
      tokens: { input: 10, output: 10 },
      costUsd: 0,
      costEstimated: true,
    }),
  });
}

describe("sourceRepoDirtyPaths (F-192)", () => {
  it("reports the source repo's dirty paths through the clone's origin", async () => {
    const fx = await makeClone();
    expect([...((await sourceRepoDirtyPaths(fx.workspaceDir)) ?? [])]).toEqual([]);
    await writeFile(join(fx.sourceDir, "app.ts"), "export const answer = 42;\n");
    expect([...((await sourceRepoDirtyPaths(fx.workspaceDir)) ?? [])]).toEqual(["app.ts"]);
  });

  it("returns null when there is no local origin to compare (detector disarmed)", async () => {
    const fx = await makeClone();
    await execFileAsync("git", ["-C", fx.workspaceDir, "remote", "remove", "origin"]);
    expect(await sourceRepoDirtyPaths(fx.workspaceDir)).toBeNull();
  });
});

describe("runCliStep escape guard (F-192)", () => {
  it("FAILs a step whose diff is empty while the source repo gained edits", async () => {
    const fx = await makeClone();
    const record = await runScript(
      fx,
      `printf 'export const answer = 42;\n' > ${JSON.stringify(join(fx.sourceDir, "app.ts"))}`,
    );
    expect(record.status).toBe("FAILED");
    expect(record.failure?.reason).toContain("OUTSIDE its workspace");
    expect(record.failure?.reason).toContain("app.ts");
    // Retriable: the next attempt restarts from a clean checkpoint.
    expect(record.failure?.retriable).toBe(true);
  });

  it("still SUCCEEDs when the work lands in the workspace, source repo untouched", async () => {
    const fx = await makeClone();
    const record = await runScript(
      fx,
      `printf 'export const answer = 42;\n' > ${JSON.stringify(join(fx.workspaceDir, "app.ts"))}`,
    );
    expect(record.status).toBe("SUCCESS");
    expect(record.diffRef.bytes).toBeGreaterThan(0);
  });

  it("does not fire on a source repo that was ALREADY dirty before the step", async () => {
    const fx = await makeClone();
    // Operator had uncommitted work when the run launched — not an escape.
    await writeFile(join(fx.sourceDir, "app.ts"), "export const answer = 41; // wip\n");
    const record = await runScript(fx, "echo 'nothing to do'");
    expect(record.status).toBe("SUCCESS");
    expect(record.failure).toBeUndefined();
  });

  it("does not fire when the step legitimately produced no diff at all", async () => {
    const fx = await makeClone();
    const record = await runScript(fx, "echo 'verified, no changes needed'");
    expect(record.status).toBe("SUCCESS");
    expect(record.diffRef.bytes).toBe(0);
  });
});
