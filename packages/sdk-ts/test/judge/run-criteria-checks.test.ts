/**
 * WP-561 / F-237 — the check-only runner behind the baseline precheck.
 *
 * dogfood-122 paid two chain nodes to author benchmark tasks that were already
 * on HEAD: their acceptance criteria were green before step 0, so no step could
 * turn them red and the judge sealed a cosmetic diff SUCCESS. The gate that
 * prevents this needs criteria exit codes with no diff, no judge, and no LLM —
 * that is what `runCriteriaChecks` is, and these drive the real shell.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCriteriaChecks } from "../../src/judge/evidence.js";
import { evaluateBaselinePrecheck } from "../../src/util/precheck.js";
import type { AcceptanceCriterion } from "../../src/types.js";

describe("runCriteriaChecks (WP-561)", () => {
  let dir: string;

  /** A run workspace is always a git checkout — side-effect cleanup reads it. */
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

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "chikory-precheck-"));
    writeFileSync(join(dir, "landed.txt"), "the deliverable is already here\n");
    initRepo(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const criterion = (id: string, check: string): AcceptanceCriterion => ({
    id,
    description: `${id} description`,
    check,
  });

  it("reports each criterion's exit code, in order", async () => {
    const runs = await runCriteriaChecks({
      workspaceDir: dir,
      criteria: [
        criterion("AC-1", "test -f landed.txt"),
        criterion("AC-2", "test -f never-authored.txt"),
      ],
    });
    expect(runs.map((run) => [run.criterionId, run.exitCode])).toEqual([
      ["AC-1", 0],
      ["AC-2", 1],
    ]);
  });

  it("feeds evaluateBaselinePrecheck a verdict the workflow can seal on", async () => {
    // The exact dogfood-122 shape: the node's own oracle is green on entry.
    const runs = await runCriteriaChecks({
      workspaceDir: dir,
      criteria: [criterion("AC-3", "test -f landed.txt")],
    });
    const verdict = evaluateBaselinePrecheck(
      runs.map((run) => ({ id: run.criterionId, exitCode: run.exitCode })),
    );
    expect(verdict.satisfied).toBe(true);
    expect(verdict.passedIds).toEqual(["AC-3"]);
  });

  it("is NOT satisfied when any criterion is still red", async () => {
    const runs = await runCriteriaChecks({
      workspaceDir: dir,
      criteria: [
        criterion("AC-1", "test -f landed.txt"),
        criterion("AC-2", "test -f never-authored.txt"),
      ],
    });
    const verdict = evaluateBaselinePrecheck(
      runs.map((run) => ({ id: run.criterionId, exitCode: run.exitCode })),
    );
    expect(verdict.satisfied).toBe(false);
    expect(verdict.failedIds).toEqual(["AC-2"]);
  });

  it("skips description-only criteria — an unrunnable one is not a green one", async () => {
    const runs = await runCriteriaChecks({
      workspaceDir: dir,
      criteria: [
        { id: "AC-1", description: "prose only, no check" },
        criterion("AC-2", "test -f landed.txt"),
      ],
    });
    expect(runs.map((run) => run.criterionId)).toEqual(["AC-2"]);
  });

  it("an empty criteria set is never 'already satisfied'", async () => {
    const runs = await runCriteriaChecks({ workspaceDir: dir, criteria: [] });
    expect(evaluateBaselinePrecheck(runs.map((r) => ({ id: r.criterionId, exitCode: r.exitCode })))
      .satisfied).toBe(false);
  });

  it("undoes a check's own writes — a precheck must not look like executor work", async () => {
    // The gate runs BEFORE step 0, so anything a check leaves behind would be
    // attributed to the node and ride into its first diff.
    await runCriteriaChecks({
      workspaceDir: dir,
      criteria: [criterion("AC-1", "touch side-effect.txt && test -f landed.txt")],
    });
    expect(existsSync(join(dir, "side-effect.txt"))).toBe(false);
  });

  it("runs a repo-scoped check inside that repo's checkout", async () => {
    mkdirSync(join(dir, "target"), { recursive: true });
    writeFileSync(join(dir, "target", "inner.txt"), "x");
    initRepo(join(dir, "target"));
    const runs = await runCriteriaChecks({
      workspaceDir: dir,
      criteria: [{ id: "AC-1", description: "scoped", check: "test -f inner.txt", repo: "target" }],
      workspaceRepos: [{ name: "target", relativePath: "target", writable: true }],
    });
    expect(runs[0]?.exitCode).toBe(0);
  });
});
