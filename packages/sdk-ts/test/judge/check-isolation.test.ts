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

describe("check isolation covers modify and delete of ignored files (WP-628 / F-360)", () => {
  let dir: string;

  const git = (args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "chikory-ignored-mod-del-"));
    writeFileSync(join(dir, ".gitignore"), "dist/\ncache/\nnode_modules/\n");
    writeFileSync(join(dir, "landed.txt"), "delivery under test\n");
    git(["init", "-q"]);
    git(["config", "user.email", "test@chikory.local"]);
    git(["config", "user.name", "test"]);
    git(["add", "-A"]);
    git(["commit", "-qm", "base"]);

    mkdirSync(join(dir, "dist"), { recursive: true });
    mkdirSync(join(dir, "cache"), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("runCriteriaChecks: modify, delete, and create are all isolated in one batch", async () => {
    const origModify = "ORIGINAL-MODIFY-CONTENT";
    const origDelete = "ORIGINAL-DELETE-CONTENT";
    const origUntouched = "ORIGINAL-UNTOUCHED-CONTENT";

    writeFileSync(join(dir, "dist/modify-target.js"), origModify);
    writeFileSync(join(dir, "dist/delete-target.js"), origDelete);
    writeFileSync(join(dir, "dist/untouched.js"), origUntouched);

    const criteria: AcceptanceCriterion[] = [
      {
        id: "vandal",
        description: "overwrites, deletes, and creates ignored files",
        check: "printf CORRUPTED > dist/modify-target.js && rm -f dist/delete-target.js && printf LEAK > dist/created.js",
      },
      {
        id: "oracle",
        description: "verifies previous check mutations are undone",
        check: [
          `if [ "$(cat dist/modify-target.js)" != "${origModify}" ]; then exit 1; fi`,
          `if [ ! -f dist/delete-target.js ] || [ "$(cat dist/delete-target.js)" != "${origDelete}" ]; then exit 1; fi`,
          "if [ -f dist/created.js ]; then exit 1; fi",
          `if [ "$(cat dist/untouched.js)" != "${origUntouched}" ]; then exit 1; fi`,
          "exit 0",
        ].join("\n"),
      },
      HONEST_FAILURE,
    ];

    const runs = await runCriteriaChecks({ workspaceDir: dir, criteria });
    expect(byId(runs, "vandal").exitCode).toBe(0);
    expect(byId(runs, "oracle").exitCode, byId(runs, "oracle").output).toBe(0);
    expect(byId(runs, "honest-failure").exitCode).toBe(3);

    // After the batch, workspace is restored
    expect(readFileSync(join(dir, "dist/modify-target.js"), "utf8")).toBe(origModify);
    expect(readFileSync(join(dir, "dist/delete-target.js"), "utf8")).toBe(origDelete);
    expect(readFileSync(join(dir, "dist/untouched.js"), "utf8")).toBe(origUntouched);
    expect(existsSync(join(dir, "dist/created.js"))).toBe(false);
  }, 120_000);

  it("runCriteriaChecks: nested directory deletion and restoration (un-named family)", async () => {
    const deepDir = join(dir, "cache", "nested", "deep", "sub");
    mkdirSync(deepDir, { recursive: true });
    const contentA = "nested file A content";
    const contentB = "nested file B content";
    writeFileSync(join(deepDir, "fileA.json"), contentA);
    writeFileSync(join(deepDir, "fileB.json"), contentB);

    const criteria: AcceptanceCriterion[] = [
      {
        id: "destroy-dir",
        description: "deletes entire nested cache directory",
        check: "rm -rf cache/nested",
      },
      {
        id: "verify-dir-restored",
        description: "verifies nested files and directories are restored",
        check: [
          `if [ ! -f cache/nested/deep/sub/fileA.json ] || [ "$(cat cache/nested/deep/sub/fileA.json)" != "${contentA}" ]; then exit 1; fi`,
          `if [ ! -f cache/nested/deep/sub/fileB.json ] || [ "$(cat cache/nested/deep/sub/fileB.json)" != "${contentB}" ]; then exit 1; fi`,
          "exit 0",
        ].join("\n"),
      },
    ];

    const runs = await runCriteriaChecks({ workspaceDir: dir, criteria });
    expect(byId(runs, "destroy-dir").exitCode).toBe(0);
    expect(byId(runs, "verify-dir-restored").exitCode, byId(runs, "verify-dir-restored").output).toBe(0);

    expect(readFileSync(join(deepDir, "fileA.json"), "utf8")).toBe(contentA);
    expect(readFileSync(join(deepDir, "fileB.json"), "utf8")).toBe(contentB);
  }, 120_000);

  it("runCriteriaChecks: multi-check sequential mutation across siblings (un-named family)", async () => {
    const origA = "ALPHA-ORIG";
    const origB = "BETA-ORIG";
    writeFileSync(join(dir, "dist/fA.txt"), origA);
    writeFileSync(join(dir, "dist/fB.txt"), origB);

    const criteria: AcceptanceCriterion[] = [
      {
        id: "step-1",
        description: "modifies fA",
        check: "printf MUTATED-A > dist/fA.txt",
      },
      {
        id: "step-2",
        description: "checks fA is clean, then modifies fB",
        check: [
          `if [ "$(cat dist/fA.txt)" != "${origA}" ]; then exit 1; fi`,
          "printf MUTATED-B > dist/fB.txt",
        ].join("\n"),
      },
      {
        id: "step-3",
        description: "checks fB is clean, then deletes fA and creates fC",
        check: [
          `if [ "$(cat dist/fB.txt)" != "${origB}" ]; then exit 1; fi`,
          "rm -f dist/fA.txt && printf CREATED-C > dist/fC.txt",
        ].join("\n"),
      },
      {
        id: "step-4",
        description: "checks all files are in original baseline state",
        check: [
          `if [ "$(cat dist/fA.txt)" != "${origA}" ]; then exit 1; fi`,
          `if [ "$(cat dist/fB.txt)" != "${origB}" ]; then exit 1; fi`,
          "if [ -f dist/fC.txt ]; then exit 1; fi",
          "exit 0",
        ].join("\n"),
      },
    ];

    const runs = await runCriteriaChecks({ workspaceDir: dir, criteria });
    for (const c of criteria) {
      expect(byId(runs, c.id).exitCode, byId(runs, c.id).output).toBe(0);
    }

    expect(readFileSync(join(dir, "dist/fA.txt"), "utf8")).toBe(origA);
    expect(readFileSync(join(dir, "dist/fB.txt"), "utf8")).toBe(origB);
    expect(existsSync(join(dir, "dist/fC.txt"))).toBe(false);
  }, 120_000);

  it("runCriteriaChecks: zero-byte truncation and empty-file overwrite (un-named family)", async () => {
    const fullContent = "full content that will be truncated";
    writeFileSync(join(dir, "dist/full-init.txt"), fullContent);
    writeFileSync(join(dir, "dist/empty-init.txt"), "");

    const criteria: AcceptanceCriterion[] = [
      {
        id: "mutate-lengths",
        description: "truncates full file and populates empty file",
        check: ": > dist/full-init.txt && printf POPULATED > dist/empty-init.txt",
      },
      {
        id: "verify-lengths-restored",
        description: "verifies original byte lengths are restored",
        check: [
          `if [ "$(cat dist/full-init.txt)" != "${fullContent}" ]; then exit 1; fi`,
          'if [ -s dist/empty-init.txt ]; then exit 1; fi',
          "exit 0",
        ].join("\n"),
      },
    ];

    const runs = await runCriteriaChecks({ workspaceDir: dir, criteria });
    expect(byId(runs, "mutate-lengths").exitCode).toBe(0);
    expect(byId(runs, "verify-lengths-restored").exitCode, byId(runs, "verify-lengths-restored").output).toBe(0);

    expect(readFileSync(join(dir, "dist/full-init.txt"), "utf8")).toBe(fullContent);
    expect(readFileSync(join(dir, "dist/empty-init.txt"), "utf8")).toBe("");
  }, 120_000);

  it("collectEvidence: ignored modify and delete on the judge path", async () => {
    const origModify = "ORIGINAL-FOR-COLLECT-EVIDENCE";
    const origDelete = "DELETE-FOR-COLLECT-EVIDENCE";
    writeFileSync(join(dir, "dist/mod.txt"), origModify);
    writeFileSync(join(dir, "dist/del.txt"), origDelete);

    const base = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();

    const criteria: AcceptanceCriterion[] = [
      {
        id: "check-mod-del",
        description: "modifies and deletes ignored files",
        check: "printf CORRUPTED > dist/mod.txt && rm -f dist/del.txt",
      },
      {
        id: "check-verify",
        description: "verifies workspace was restored on judge path",
        check: [
          `if [ "$(cat dist/mod.txt)" != "${origModify}" ]; then exit 1; fi`,
          `if [ ! -f dist/del.txt ] || [ "$(cat dist/del.txt)" != "${origDelete}" ]; then exit 1; fi`,
          "exit 0",
        ].join("\n"),
      },
    ];

    const collected = await collectEvidence({
      workspaceDir: dir,
      store: createMemoryArtifactStore(),
      criteria,
      sinceCommit: base,
      criteriaHistory: {},
      stepSummaries: [],
    });

    expect(byId(collected.checkRuns, "check-mod-del").exitCode).toBe(0);
    expect(byId(collected.checkRuns, "check-verify").exitCode).toBe(0);

    expect(readFileSync(join(dir, "dist/mod.txt"), "utf8")).toBe(origModify);
    expect(readFileSync(join(dir, "dist/del.txt"), "utf8")).toBe(origDelete);
  }, 120_000);

  it("runCriteriaChecks: preserves and restores non-UTF8 binary ignored files (un-named family)", async () => {
    // Non-UTF8 invalid byte sequence that would be mangled by utf-8 string conversion
    const binaryBytes1 = Buffer.from([0xff, 0xfe, 0x80, 0x00, 0x12, 0x34, 0x88, 0x99, 0xaa, 0xbb]);
    const binaryBytes2 = Buffer.from([0x00, 0xff, 0xc0, 0xdf, 0xee, 0xdd, 0xcc, 0xbb, 0xaa, 0x01]);
    const binPath1 = join(dir, "dist/binary1.bin");
    const binPath2 = join(dir, "dist/binary2.bin");
    writeFileSync(binPath1, binaryBytes1);
    writeFileSync(binPath2, binaryBytes2);

    const criteria: AcceptanceCriterion[] = [
      {
        id: "corrupt-binaries",
        description: "overwrites binary1 and deletes binary2",
        check: "printf 'corrupted data' > dist/binary1.bin && rm -f dist/binary2.bin",
      },
      {
        id: "verify-binaries",
        description: "verifies binary files are present",
        check: "test -f dist/binary1.bin && test -f dist/binary2.bin",
      },
    ];

    const runs = await runCriteriaChecks({ workspaceDir: dir, criteria });
    expect(byId(runs, "corrupt-binaries").exitCode).toBe(0);
    expect(byId(runs, "verify-binaries").exitCode).toBe(0);

    // Assert exact byte identity after restoration
    const restored1 = readFileSync(binPath1);
    const restored2 = readFileSync(binPath2);
    expect(Buffer.compare(restored1, binaryBytes1)).toBe(0);
    expect(Buffer.compare(restored2, binaryBytes2)).toBe(0);
  }, 120_000);

  it("runCriteriaChecks: reports unpreserved ignored file corruption in CheckRun output", async () => {
    // Write a file that exceeds the per-file preservation budget (e.g. > 64 KiB)
    const largeIgnoredPath = join(dir, "dist/large-budget-exceeded.bin");
    const largePayload = Buffer.alloc(128 * 1024, 0x42); // 128 KiB
    writeFileSync(largeIgnoredPath, largePayload);

    const criteria: AcceptanceCriterion[] = [
      {
        id: "mutate-large-ignored",
        description: "modifies an unpreserved large ignored file",
        check: "printf 'overwritten' > dist/large-budget-exceeded.bin",
      },
      {
        id: "check-next",
        description: "subsequent check",
        check: "exit 0",
      },
    ];

    const runs = await runCriteriaChecks({ workspaceDir: dir, criteria });
    const mutateRun = byId(runs, "mutate-large-ignored");
    expect(mutateRun.exitCode).toBe(0);
    expect(mutateRun.output).toContain("[check-isolation] Warning:");
    expect(mutateRun.output).toContain("large-budget-exceeded.bin");
  }, 120_000);
});


/**
 * dogfood-159 review — the two defects the run's own ACs could not see, because both fixtures put
 * every ignored file in one flat directory with no competition for the preservation budget.
 */
describe("the preservation budget must reach the paths a check actually corrupts (F-404/F-405)", () => {
  let dir: string;

  const git = (args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "chikory-budget-order-"));
    writeFileSync(join(dir, ".gitignore"), "node_modules/\npackages/\n");
    writeFileSync(join(dir, "landed.txt"), "delivery under test\n");
    git(["init", "-q"]);
    git(["config", "user.email", "test@chikory.local"]);
    git(["config", "user.name", "test"]);
    git(["add", "-A"]);
    git(["commit", "-qm", "base"]);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("isolates a project-owned artifact a root-level dependency store would have crowded out", async () => {
    // A root `node_modules/` big enough to exhaust the whole budget on its own, and one
    // project-owned cache file that sorts AFTER it lexically — exactly the shape measured in
    // .chikory/runs/run-71087607-.../workspace, where node_modules/.pnpm took 9,459 of the
    // 9,467 preserved paths and packages/sdk-ts/node_modules/.vite/.../results.json got none.
    // 512 x 64 KiB exactly exhausts DEFAULT_MAX_TOTAL_IGNORED_PRESERVE_BYTES (32 MiB).
    mkdirSync(join(dir, "node_modules/dep"), { recursive: true });
    const filler = "d".repeat(64 * 1024);
    for (let i = 0; i < 512; i += 1) {
      writeFileSync(join(dir, `node_modules/dep/m${i}.js`), filler);
    }
    const CACHE = "packages/sdk-ts/node_modules/.vite/vitest/results.json";
    const ORIGINAL = '{"results":"ORIGINAL"}';
    mkdirSync(join(dir, "packages/sdk-ts/node_modules/.vite/vitest"), { recursive: true });
    writeFileSync(join(dir, CACHE), ORIGINAL);

    const criteria: AcceptanceCriterion[] = [
      {
        id: "vandal",
        description: "a check overwrites the project's own tool cache",
        check: `printf CORRUPTED > ${CACHE}`,
      },
      {
        id: "oracle",
        description: "the next check must be graded against the original bytes",
        check: [
          `GOT=$(cat ${CACHE})`,
          `if [ "$GOT" != '${ORIGINAL}' ]; then echo "NOT ISOLATED: [$GOT]"; exit 1; fi`,
          "exit 0",
        ].join("\n"),
      },
    ];

    const runs = await runCriteriaChecks({ workspaceDir: dir, criteria });

    expect(byId(runs, "oracle").exitCode, byId(runs, "oracle").output).toBe(0);
    expect(readFileSync(join(dir, CACHE), "utf8")).toBe(ORIGINAL);
  }, 120_000);

  it("reports an unrepairable corruption once, on the check that caused it", async () => {
    const BIG = "node_modules/oversized.bin";
    mkdirSync(join(dir, "node_modules"), { recursive: true });
    writeFileSync(join(dir, BIG), Buffer.alloc(128 * 1024, 0x42)); // over the 64 KiB per-file cap

    const criteria: AcceptanceCriterion[] = [
      { id: "vandal", description: "corrupts an unpreservable file", check: `printf X > ${BIG}` },
      { id: "innocent-1", description: "touches nothing", check: "exit 0" },
      { id: "innocent-2", description: "touches nothing", check: "exit 0" },
    ];

    const runs = await runCriteriaChecks({ workspaceDir: dir, criteria });

    expect(byId(runs, "vandal").output).toContain("oversized.bin");
    for (const id of ["innocent-1", "innocent-2"]) {
      expect(
        byId(runs, id).output,
        `${id} touched nothing and must not be told it modified or deleted a file`,
      ).not.toContain("[check-isolation] Warning:");
    }
  }, 120_000);
});
