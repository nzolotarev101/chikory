/**
 * WP-623 / F-349 & WP-625 / F-357 — a judge-executed acceptance check must answer for the delivery,
 * and for nothing else.
 *
 * dogfood-142 sealed FAILED on a correct delivery because AC-1's transient generated
 * test file was compiled by AC-2's whole-package typecheck running concurrently in the
 * same workspace. dogfood-143 fixed it by serializing both call sites and cleaning each
 * check's side effects before the next one starts — and shipped no test (F-356), so a
 * refactor back to `Promise.all` would land green.
 *
 * WP-625 extends check isolation to untracked and gitignored paths (.gitignore). An ignored write
 * is a side effect like any other and must not be observable by a sibling check or survive the batch,
 * while pre-existing ignored files (like dependencies or caches) remain untouched byte-identical.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMemoryArtifactStore } from "../../src/artifacts/index.js";
import { collectEvidence, runCriteriaChecks, type CheckRun } from "../../src/judge/evidence.js";
import type { AcceptanceCriterion } from "../../src/types.js";

const MARK = "sibling-scratch.tmp";
const LEAK = "dist/leak.js";
const KEEP = "dist/keep.js";
const NM_KEEP = "node_modules/pre-existing.txt";
const KEEP_BYTES = "pre-existing ignored content, must survive the batch";

/** The interfering pair from F-349: one check holds a scratch file, the other fails if it sees one. */
const WRITER: AcceptanceCriterion = {
  id: "writer",
  description: "writes a transient scratch file, then removes it",
  check: `sh -c "printf x > ${MARK}; sleep 1; rm -f ${MARK}"`,
};
const OBSERVER: AcceptanceCriterion = {
  id: "observer",
  description: "must never observe a sibling check writing into the tree",
  check: `sh -c "sleep 0.4; test ! -e ${MARK}"`,
};
const IGNORED_WRITER: AcceptanceCriterion = {
  id: "ignored-writer",
  description: "leaves an artifact under an ignored path",
  check: `sh -c "mkdir -p dist; printf leak > ${LEAK}"`,
};
const IGNORED_OBSERVER: AcceptanceCriterion = {
  id: "ignored-observer",
  description: "must never observe a sibling artifact, ignored or not",
  check: `sh -c "test ! -e ${LEAK}"`,
};
const HONEST_FAILURE: AcceptanceCriterion = {
  id: "honest-failure",
  description: "a check that is genuinely wrong still fails, with its own exit code",
  check: "sh -c \"exit 3\"",
};
const SLOW = (id: string): AcceptanceCriterion => ({
  id,
  description: "exceeds the per-check cap",
  check: "sleep 30",
});

const byId = (runs: CheckRun[], id: string): CheckRun => {
  const hit = runs.find((r) => r.criterionId === id);
  expect(hit, `no CheckRun for ${id}`).toBeDefined();
  return hit!;
};

describe("a judge-executed check is isolated from its siblings (WP-623 / F-349)", () => {
  let dir: string;

  const git = (args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "chikory-check-isolation-"));
    writeFileSync(join(dir, "landed.txt"), "the delivery under grade\n");
    git(["init", "-q"]);
    git(["config", "user.email", "test@chikory.local"]);
    git(["config", "user.name", "test"]);
    git(["add", "-A"]);
    git(["commit", "-qm", "base"]);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("runCriteriaChecks: the pair does not interfere, in either declaration order", async () => {
    for (const criteria of [
      [WRITER, OBSERVER, HONEST_FAILURE],
      [OBSERVER, WRITER, HONEST_FAILURE],
    ]) {
      const runs = await runCriteriaChecks({ workspaceDir: dir, criteria });
      expect(byId(runs, "writer").exitCode).toBe(0);
      expect(byId(runs, "observer").exitCode, byId(runs, "observer").output).toBe(0);
      // Isolation must not become leniency: the honest failure keeps ITS exit code.
      expect(byId(runs, "honest-failure").exitCode).toBe(3);
    }
  }, 120_000);

  it("collectEvidence: the same pair does not interfere on the judge path", async () => {
    const base = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    const collected = await collectEvidence({
      workspaceDir: dir,
      store: createMemoryArtifactStore(),
      criteria: [WRITER, OBSERVER, HONEST_FAILURE],
      sinceCommit: base,
      criteriaHistory: {},
      stepSummaries: [],
    });
    expect(byId(collected.checkRuns, "writer").exitCode).toBe(0);
    expect(
      byId(collected.checkRuns, "observer").exitCode,
      byId(collected.checkRuns, "observer").output,
    ).toBe(0);
    expect(byId(collected.checkRuns, "honest-failure").exitCode).toBe(3);
  }, 120_000);

  it("the cap stays per-check, and the batch stays bounded", async () => {
    const started = Date.now();
    const runs = await runCriteriaChecks({
      workspaceDir: dir,
      criteria: [SLOW("slow-a"), SLOW("slow-b")],
      checkTimeoutMs: 2000,
    });
    const elapsed = Date.now() - started;
    for (const id of ["slow-a", "slow-b"]) {
      const run = byId(runs, id);
      expect(run.infraFailed, `${id} must be killed at the cap`).toBe(true);
      expect(run.exitCode).not.toBe(0);
    }
    // Serial is fine (2 x 2 s); a multiple of the budget, or no kill at all, is not.
    expect(elapsed, `batch took ${elapsed}ms`).toBeLessThan(15_000);
  }, 120_000);

  it("the workspace is left byte-clean after the batch", async () => {
    await runCriteriaChecks({
      workspaceDir: dir,
      criteria: [WRITER, OBSERVER, HONEST_FAILURE],
    });
    expect(existsSync(join(dir, MARK))).toBe(false);
    const status = execFileSync("git", ["-C", dir, "status", "--porcelain"], {
      encoding: "utf8",
    });
    expect(status.trim()).toBe("");
  }, 120_000);
});

describe("check isolation covers writes git does not track (.gitignore / WP-625 / F-357)", () => {
  let dir: string;

  const git = (args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "chikory-ignored-isolation-"));
    writeFileSync(join(dir, ".gitignore"), "dist/\nnode_modules/\n");
    writeFileSync(join(dir, "landed.txt"), "the delivery under grade\n");
    git(["init", "-q"]);
    git(["config", "user.email", "test@chikory.local"]);
    git(["config", "user.name", "test"]);
    git(["add", "-A"]);
    git(["commit", "-qm", "base"]);
    // Pre-existing IGNORED content: a build output and a dependency tree. Neither is the
    // check batch business, and neither may be removed or rewritten by it.
    mkdirSync(join(dir, "dist"), { recursive: true });
    mkdirSync(join(dir, "node_modules"), { recursive: true });
    writeFileSync(join(dir, KEEP), KEEP_BYTES);
    writeFileSync(join(dir, NM_KEEP), KEEP_BYTES);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const assertPreExistingSurvived = () => {
    for (const rel of [KEEP, NM_KEEP]) {
      expect(existsSync(join(dir, rel)), `${rel} was destroyed by the cleanup`).toBe(true);
      expect(readFileSync(join(dir, rel), "utf8"), `${rel} was rewritten`).toBe(KEEP_BYTES);
    }
  };

  it("runCriteriaChecks: an ignored write is invisible to a sibling, in either order", async () => {
    for (const criteria of [
      [IGNORED_WRITER, IGNORED_OBSERVER, HONEST_FAILURE],
      [IGNORED_OBSERVER, IGNORED_WRITER, HONEST_FAILURE],
    ]) {
      const runs = await runCriteriaChecks({ workspaceDir: dir, criteria });
      expect(byId(runs, "ignored-writer").exitCode).toBe(0);
      const obs = byId(runs, "ignored-observer");
      expect(obs.exitCode, obs.output).toBe(0);
      // trap D: isolation must not become leniency.
      expect(byId(runs, "honest-failure").exitCode).toBe(3);
      // the leak does not outlive the batch, and the pre-existing tree is intact.
      expect(existsSync(join(dir, LEAK)), "the ignored leak survived the batch").toBe(false);
      assertPreExistingSurvived();
    }
  }, 240_000);

  it("collectEvidence: the same pair does not interfere on the judge path", async () => {
    const base = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    const collected = await collectEvidence({
      workspaceDir: dir,
      store: createMemoryArtifactStore(),
      criteria: [IGNORED_WRITER, IGNORED_OBSERVER, HONEST_FAILURE],
      sinceCommit: base,
      criteriaHistory: {},
      stepSummaries: [],
    });
    const obs = byId(collected.checkRuns, "ignored-observer");
    expect(obs.exitCode, obs.output).toBe(0);
    expect(byId(collected.checkRuns, "honest-failure").exitCode).toBe(3);
    expect(existsSync(join(dir, LEAK))).toBe(false);
    assertPreExistingSurvived();
  }, 240_000);

  it("the sweep stays cheap with a bulky ignored tree present (trap A)", async () => {
    const pkg = join(dir, "node_modules", "bulky");
    mkdirSync(pkg, { recursive: true });
    const payload = "x".repeat(4096);
    for (let i = 0; i < 1500; i += 1) {
      writeFileSync(join(pkg, `m${i}.js`), payload);
    }
    const started = Date.now();
    const runs = await runCriteriaChecks({
      workspaceDir: dir,
      criteria: [IGNORED_WRITER, IGNORED_OBSERVER, HONEST_FAILURE],
    });
    const elapsed = Date.now() - started;
    expect(byId(runs, "ignored-observer").exitCode).toBe(0);
    expect(elapsed, `batch of 3 trivial checks took ${elapsed}ms`).toBeLessThan(30_000);
    expect(existsSync(join(pkg, "m0.js")), "the bulky tree was deleted").toBe(true);
    assertPreExistingSurvived();
  }, 240_000);
});
