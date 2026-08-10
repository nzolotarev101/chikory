import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import { describe, expect, it } from "vitest";
import { findRepoRoot, resolvePatchPath, runProbe, runProbeSweep } from "../src/probe.js";

/**
 * WP-593 task discrimination probe. The probe answers one question mechanically:
 * does this task's requirement check FAIL at the pinned base and PASS at the real
 * upstream fix? A task that fails that test scores free for every arm and inflates
 * both benchmark intervals instead of separating them.
 */

/** Two-commit fixture repo: `value.txt` goes BROKEN → FIXED. */
function makeFixture(): { root: string; origin: string; base: string; fix: string } {
  const root = mkdtempSync(join(tmpdir(), "probe-unit-"));
  const origin = join(root, "origin");
  mkdirSync(origin, { recursive: true });
  const git = (...args: string[]): string =>
    execFileSync("git", ["-C", origin, ...args], { stdio: "pipe" }).toString().trim();
  const write = (name: string, body: string): void => writeFileSync(join(origin, name), body);

  execFileSync("git", ["init", "-q", "-b", "main", origin], { stdio: "pipe" });
  git("config", "user.email", "probe@chikory.local");
  git("config", "user.name", "probe");
  write("README.md", "fixture\n");
  write("value.txt", "BROKEN\n");
  write("verify.sh", 'echo "Tests  3 passed (3)"\nexit 0\n');
  write("verify-red.sh", 'echo "Tests  1 failed | 2 passed (3)"\nexit 1\n');
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  const base = git("rev-parse", "HEAD");
  write("value.txt", "FIXED\n");
  git("add", "-A");
  git("commit", "-q", "-m", "fix");
  const fix = git("rev-parse", "HEAD");
  return { root, origin, base, fix };
}

function writeTask(
  root: string,
  name: string,
  origin: string,
  base: string,
  fix: string,
  verify: string,
  requirements: string,
): string {
  const path = join(root, `${name}.yaml`);
  writeFileSync(
    path,
    `id: brownfield-900\nclass: brownfield\nstatus: pinned\nrepo:\n` +
      `  url: ${JSON.stringify(origin)}\n  ref: ${base}\n  fix_ref: ${fix}\n` +
      `base_verification_command: sh ${verify}\nhorizon: 1h\ngoal: |\n  probe fixture\n` +
      `requirements:\n${requirements}`,
  );
  return path;
}

const MIXED_REQS =
  "  - id: R1\n    description: discriminating\n    check: grep -q FIXED value.txt\n" +
  "  - id: R2\n    description: green everywhere\n    check: grep -q fixture README.md\n" +
  "  - id: R3\n    description: never satisfiable\n    check: grep -q NEVER value.txt\n";

describe("runProbe", () => {
  it("classifies each requirement from the (base, fix) exit pair and gates the exit code", async () => {
    const { root, origin, base, fix } = makeFixture();
    try {
      const task = writeTask(root, "mixed", origin, base, fix, "verify.sh", MIXED_REQS);
      const { result, code } = await runProbe({ taskPath: task, outDir: join(root, "out") });

      expect(code).not.toBe(0);
      expect(result.verdict).toBe("not-discriminating");
      expect(result.baseRef).toBe(base);
      expect(result.fixRef).toBe(fix);
      expect(result.baseVerification.green).toBe(true);
      expect(result.fixVerification.green).toBe(true);

      const by = Object.fromEntries(result.requirements.map((r) => [r.id, r]));
      expect(by["R1"]).toMatchObject({ base: "red", fix: "green", classification: "discriminating" });
      expect(by["R2"]!.classification).toBe("non-discriminating");
      expect(by["R3"]!.classification).toBe("unsatisfiable");
      for (const req of result.requirements) expect(req.reason.length).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  it("exits 0 and publishes both workspaces distinctly when every requirement discriminates", async () => {
    const { root, origin, base, fix } = makeFixture();
    try {
      const task = writeTask(
        root,
        "clean",
        origin,
        base,
        fix,
        "verify.sh",
        "  - id: R1\n    description: discriminating\n    check: grep -q FIXED value.txt\n",
      );
      const outDir = join(root, "out");
      const { result, code } = await runProbe({ taskPath: task, outDir });

      expect(code).toBe(0);
      expect(result.verdict).toBe("discriminating");
      expect(result.taskId).toBe("brownfield-900");

      // F-270: the two refs are materialized into SEPARATE workspaces, and
      // probe.json must SAY so. `ensureGitWorkspace` puts a `.git` inside each
      // one, so publishing the workspace itself collapsed both to "." — the
      // report claimed one shared workspace while the probe used two.
      expect(result.baseWorkspace).not.toBe(result.fixWorkspace);
      expect(result.baseWorkspace.endsWith("base-workspace")).toBe(true);
      expect(result.fixWorkspace.endsWith("fix-workspace")).toBe(true);

      const written = JSON.parse(readFileSync(join(outDir, "probe.json"), "utf8")) as unknown as {
        baseWorkspace: string;
        fixWorkspace: string;
      };
      expect(written.baseWorkspace).toBe(result.baseWorkspace);
      expect(written.fixWorkspace).toBe(result.fixWorkspace);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  it("publishes workspaces relative to the enclosing repo when the out dir is inside one", async () => {
    const { root, origin, base, fix } = makeFixture();
    try {
      // The operator's normal case: --out lands under a checked-out repo. The
      // published paths must resolve from that repo root, not carry host paths.
      const repo = join(root, "operator-repo");
      mkdirSync(join(repo, ".git"), { recursive: true });
      const outDir = join(repo, "benchmarks", "probe-out");
      const task = writeTask(
        root,
        "in-repo",
        origin,
        base,
        fix,
        "verify.sh",
        "  - id: R1\n    description: discriminating\n    check: grep -q FIXED value.txt\n",
      );
      const { result } = await runProbe({ taskPath: task, outDir });

      expect(isAbsolute(result.baseWorkspace)).toBe(false);
      expect(result.baseWorkspace).toBe(join("benchmarks", "probe-out", "base-workspace"));
      expect(result.fixWorkspace).toBe(join("benchmarks", "probe-out", "fix-workspace"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  it("refuses to call anything discriminating when the base suite is red", async () => {
    const { root, origin, base, fix } = makeFixture();
    try {
      const task = writeTask(root, "redbase", origin, base, fix, "verify-red.sh", MIXED_REQS);
      const { result, code } = await runProbe({ taskPath: task, outDir: join(root, "out") });

      // A red environment fails EVERY check. Reading that as discrimination is
      // F-255/F-258 again (WP-587: base verification measured the agent's output).
      expect(code).not.toBe(0);
      expect(result.verdict).toBe("inconclusive");
      expect(result.baseVerification.green).toBe(false);
      expect(result.requirements.map((r) => r.classification)).toEqual([
        "inconclusive",
        "inconclusive",
        "inconclusive",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  it("names repo.fix_ref when the task has not declared one", async () => {
    const { root, origin, base } = makeFixture();
    try {
      const path = join(root, "nofix.yaml");
      writeFileSync(
        path,
        `id: brownfield-902\nclass: brownfield\nstatus: pinned\nrepo:\n` +
          `  url: ${JSON.stringify(origin)}\n  ref: ${base}\n` +
          `base_verification_command: sh verify.sh\nhorizon: 1h\ngoal: |\n  x\n` +
          `requirements:\n  - id: R1\n    description: d\n    check: "true"\n`,
      );
      await expect(runProbe({ taskPath: path, outDir: join(root, "out") })).rejects.toThrow(
        /fix_ref/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("runProbeSweep", () => {
  it("probes tasks durably, skips settled tasks at same ref pair, re-probes moved refs, and continues past bad tasks", async () => {
    const { root, origin, base, fix } = makeFixture();
    try {
      const tasksDir = join(root, "tasks");
      mkdirSync(tasksDir, { recursive: true });

      const reqClean = "  - id: R1\n    description: discriminating\n    check: grep -q FIXED value.txt\n";
      const reqMixed =
        "  - id: R1\n    description: discriminating\n    check: grep -q FIXED value.txt\n" +
        "  - id: R2\n    description: free\n    check: grep -q value value.txt\n";

      writeTask(tasksDir, "brownfield-900", origin, base, fix, "verify.sh", reqClean);
      // Write brownfield-901 with explicit id: brownfield-901
      writeFileSync(
        join(tasksDir, "brownfield-901.yaml"),
        `id: brownfield-901\nclass: brownfield\nstatus: pinned\nrepo:\n` +
          `  url: ${JSON.stringify(origin)}\n  ref: ${base}\n  fix_ref: ${fix}\n` +
          `base_verification_command: sh verify.sh\nhorizon: 1h\ngoal: |\n  probe fixture\n` +
          `requirements:\n${reqMixed}`,
      );
      // Bad task (missing fix_ref)
      writeFileSync(
        join(tasksDir, "brownfield-902.yaml"),
        `id: brownfield-902\nclass: brownfield\nstatus: pinned\nrepo:\n` +
          `  url: ${JSON.stringify(origin)}\n  ref: ${base}\n` +
          `base_verification_command: sh verify.sh\nhorizon: 1h\ngoal: |\n  x\n` +
          `requirements:\n  - id: R1\n    description: d\n    check: "true"\n`,
      );

      const recordFile = join(root, "ledger.json");
      const outLogs: string[] = [];
      const io = { out: (line: string) => outLogs.push(line), err: console.error };

      // First sweep: 900 (discriminating), 901 (not-discriminating), 902 (failed). Total exit code 1.
      const code1 = await runProbeSweep({ tasksDir, recordFile, outDir: join(root, "out1") }, io);
      expect(code1).toBe(1);

      const ledger1 = JSON.parse(readFileSync(recordFile, "utf8")) as Record<string, { baseRef: string; fixRef: string; verdict: string; probedAt: string }>;
      expect(ledger1["brownfield-900"]?.verdict).toBe("discriminating");
      expect(ledger1["brownfield-901"]?.verdict).toBe("not-discriminating");
      expect(ledger1["brownfield-902"]).toBeUndefined();

      const probedAt900 = ledger1["brownfield-900"]!.probedAt;

      // Second sweep: 900 and 901 should be skipped (probedAt unchanged), 902 fails.
      outLogs.length = 0;
      const code2 = await runProbeSweep({ tasksDir, recordFile, outDir: join(root, "out2") }, io);
      expect(code2).toBe(1);

      const ledger2 = JSON.parse(readFileSync(recordFile, "utf8")) as Record<string, { probedAt: string }>;
      expect(ledger2["brownfield-900"]!.probedAt).toBe(probedAt900);
      expect(outLogs.some((l) => l.includes("brownfield-900: skipped"))).toBe(true);
      expect(outLogs.some((l) => l.includes("brownfield-901: skipped"))).toBe(true);
      expect(outLogs.some((l) => l.includes("brownfield-902: unprobeable"))).toBe(true);

      // Solo sweep with only clean task: should exit 0
      const soloDir = join(root, "solo");
      mkdirSync(soloDir, { recursive: true });
      writeTask(soloDir, "brownfield-900", origin, base, fix, "verify.sh", reqClean);
      const soloRecord = join(root, "solo-ledger.json");

      const codeSolo = await runProbeSweep({ tasksDir: soloDir, recordFile: soloRecord, outDir: join(root, "out-solo") });
      expect(codeSolo).toBe(0);

      // F-280: the moved-ref case the title claims. A THIRD commit becomes the
      // new fix_ref; proof taken at the old pair is stale and must be replaced.
      const git = (...args: string[]): string =>
        execFileSync("git", ["-C", origin, ...args], { stdio: "pipe" }).toString().trim();
      writeFileSync(join(origin, "extra.txt"), "second fix\n");
      git("add", "-A");
      git("commit", "-q", "-m", "fix2");
      const fix2 = git("rev-parse", "HEAD");

      writeTask(soloDir, "brownfield-900", origin, base, fix2, "verify.sh", reqClean);
      const soloBefore = (
        JSON.parse(readFileSync(soloRecord, "utf8")) as Record<string, { probedAt: string }>
      )["brownfield-900"]!.probedAt;

      const codeMoved = await runProbeSweep(
        { tasksDir: soloDir, recordFile: soloRecord, outDir: join(root, "out-moved") },
        io,
      );
      expect(codeMoved).toBe(0);
      const moved = (
        JSON.parse(readFileSync(soloRecord, "utf8")) as Record<
          string,
          { fixRef: string; probedAt: string; verdict: string }
        >
      )["brownfield-900"]!;
      expect(moved.fixRef).toBe(fix2);
      expect(moved.verdict).toBe("discriminating");
      expect(moved.probedAt).not.toBe(soloBefore);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  it("gives every task its own output dir even when --out is omitted (F-277)", async () => {
    const { root, origin, base, fix } = makeFixture();
    try {
      const tasksDir = join(root, "tasks");
      mkdirSync(tasksDir, { recursive: true });
      const reqClean = "  - id: R1\n    description: discriminating\n    check: grep -q FIXED value.txt\n";
      const task = (id: string): void =>
        writeFileSync(
          join(tasksDir, `${id}.yaml`),
          `id: ${id}\nclass: brownfield\nstatus: pinned\nrepo:\n` +
            `  url: ${JSON.stringify(origin)}\n  ref: ${base}\n  fix_ref: ${fix}\n` +
            `base_verification_command: sh verify.sh\nhorizon: 1h\ngoal: |\n  probe fixture\n` +
            `requirements:\n${reqClean}`,
        );
      task("brownfield-900");
      task("brownfield-901");

      const recordFile = join(root, "ledger.json");
      const code = await runProbeSweep({ tasksDir, recordFile }, { out: () => {}, err: () => {} });
      expect(code).toBe(0);

      // Sharing one dir would leave a single probe.json (the last task's) and one
      // base workspace re-pointed across repos, with the previous target's
      // untracked build output still sitting in it.
      const probeOut = join(tasksDir, "probe-output");
      for (const id of ["brownfield-900", "brownfield-901"]) {
        const own = JSON.parse(readFileSync(join(probeOut, id, "probe.json"), "utf8")) as {
          taskId: string;
        };
        expect(own.taskId).toBe(id);
      }
      expect(existsSync(join(probeOut, "probe.json"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  it("enforces repo-relative patch paths within repo root and rejects absolute/escaping paths", () => {
    const repoRoot = findRepoRoot(import.meta.dirname);
    const resolved = resolvePatchPath("benchmarks/tasks/patches/fix.patch");
    expect(resolved).toBe(join(repoRoot, "benchmarks/tasks/patches/fix.patch"));

    // F-288: the test NAME said "rejects absolute" while the assertion accepted
    // it — step 6 rewrote the assertion to match AC-1's fixture instead of the
    // goal. The name was right.
    expect(() => resolvePatchPath("/tmp/absolute.patch")).toThrow(/relative path/);
    expect(() => resolvePatchPath("../../outside.patch")).toThrow(/escapes repository root/);
  });

  it("AC-1: handles gold patch tasks durably, fails loud on bad patches, re-probes on patch edits, and refuses dual sources", async () => {
    const { root, origin, base, fix } = makeFixture();
    try {
      const patchesDir = join(root, "patches");
      mkdirSync(patchesDir, { recursive: true });

      // Generate a patch file from base to fix
      const patchText = execFileSync("git", ["-C", origin, "diff", base, fix], { stdio: "pipe" }).toString();
      const patchPath = join(patchesDir, "fix.patch");
      writeFileSync(patchPath, patchText);

      const tasksDir = join(root, "tasks");
      mkdirSync(tasksDir, { recursive: true });

      const reqClean = "  - id: R1\n    description: discriminating\n    check: grep -q FIXED value.txt\n";

      // Task 900: fix_ref task (unregressed)
      writeFileSync(
        join(tasksDir, "brownfield-900.yaml"),
        `id: brownfield-900\nclass: brownfield\nstatus: pinned\nrepo:\n` +
          `  url: ${JSON.stringify(origin)}\n  ref: ${base}\n  fix_ref: ${fix}\n` +
          `base_verification_command: sh verify.sh\nhorizon: 1h\ngoal: |\n  probe fixture\n` +
          `requirements:\n${reqClean}`,
      );

      // Task 901: fix_patch task (gold patch)
      const relPatchPath = join("patches", "fix.patch");
      writeFileSync(
        join(tasksDir, "brownfield-901.yaml"),
        `id: brownfield-901\nclass: brownfield\nstatus: pinned\nrepo:\n` +
          `  url: ${JSON.stringify(origin)}\n  ref: ${base}\n  fix_patch: ${JSON.stringify(relPatchPath)}\n` +
          `base_verification_command: sh verify.sh\nhorizon: 1h\ngoal: |\n  probe fixture\n` +
          `requirements:\n${reqClean}`,
      );

      // Task 902: unprobeable (neither fix source - Trap A)
      writeFileSync(
        join(tasksDir, "brownfield-902.yaml"),
        `id: brownfield-902\nclass: brownfield\nstatus: pinned\nrepo:\n` +
          `  url: ${JSON.stringify(origin)}\n  ref: ${base}\n` +
          `base_verification_command: sh verify.sh\nhorizon: 1h\ngoal: |\n  x\n` +
          `requirements:\n  - id: R1\n    description: d\n    check: "true"\n`,
      );

      const recordFile = join(root, "ledger.json");
      const outLogs: string[] = [];
      const io = { out: (line: string) => outLogs.push(line), err: console.error };

      // Sweep 1: 900 (discriminating), 901 (discriminating), 902 (unprobeable)
      await runProbeSweep({ tasksDir, recordFile, outDir: join(root, "out1") }, io);

      const ledger1 = JSON.parse(readFileSync(recordFile, "utf8")) as Record<
        string,
        { baseRef: string; fixRef: string; verdict: string; probedAt: string }
      >;
      expect(ledger1["brownfield-900"]?.verdict).toBe("discriminating");
      expect(ledger1["brownfield-900"]?.fixRef).toBe(fix);

      expect(ledger1["brownfield-901"]?.verdict).toBe("discriminating");
      expect(ledger1["brownfield-901"]?.fixRef).toBeTruthy();
      expect(ledger1["brownfield-901"]?.fixRef).not.toBe(fix);

      // Trap A: task with neither source is unprobeable and NOT in ledger
      expect(ledger1["brownfield-902"]).toBeUndefined();
      expect(outLogs.some((l) => l.includes("brownfield-902: unprobeable"))).toBe(true);

      const probedAt901 = ledger1["brownfield-901"]!.probedAt;

      // Sweep 2: unchanged patch -> 900 and 901 skipped
      outLogs.length = 0;
      await runProbeSweep({ tasksDir, recordFile, outDir: join(root, "out2") }, io);

      const ledger2 = JSON.parse(readFileSync(recordFile, "utf8")) as Record<
        string,
        { probedAt: string }
      >;
      expect(ledger2["brownfield-901"]!.probedAt).toBe(probedAt901);
      expect(outLogs.some((l) => l.includes("brownfield-901: skipped"))).toBe(true);

      // Trap C: 1-byte edit to patch forces re-probe and REPLACES entry
      writeFileSync(patchPath, patchText + "\n");
      outLogs.length = 0;
      await runProbeSweep({ tasksDir, recordFile, outDir: join(root, "out3") }, io);

      const ledger3 = JSON.parse(readFileSync(recordFile, "utf8")) as Record<
        string,
        { fixRef: string; probedAt: string; verdict: string }
      >;
      expect(ledger3["brownfield-901"]!.verdict).toBe("discriminating");
      expect(ledger3["brownfield-901"]!.probedAt).not.toBe(probedAt901);
      expect(ledger3["brownfield-901"]!.fixRef).not.toBe(ledger1["brownfield-901"]!.fixRef);
      expect(outLogs.some((l) => l.includes("brownfield-901: probed"))).toBe(true);

      // Trap B: patch that does not apply is a loud error naming patch path and task, writing nothing
      const badPatchTaskPath = join(tasksDir, "brownfield-903.yaml");
      const badPatchRelPath = join("patches", "invalid.patch");
      writeFileSync(join(patchesDir, "invalid.patch"), "this is not a valid git diff\n");
      writeFileSync(
        badPatchTaskPath,
        `id: brownfield-903\nclass: brownfield\nstatus: pinned\nrepo:\n` +
          `  url: ${JSON.stringify(origin)}\n  ref: ${base}\n  fix_patch: ${JSON.stringify(badPatchRelPath)}\n` +
          `base_verification_command: sh verify.sh\nhorizon: 1h\ngoal: |\n  probe fixture\n` +
          `requirements:\n${reqClean}`,
      );

      await expect(runProbe({ taskPath: badPatchTaskPath, outDir: join(root, "out-bad") })).rejects.toThrow(
        /brownfield-903.*invalid\.patch|invalid\.patch.*brownfield-903/,
      );

      const ledgerAfterBad = JSON.parse(readFileSync(recordFile, "utf8")) as Record<string, unknown>;
      expect(ledgerAfterBad["brownfield-903"]).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  describe("the evidence a sweep writes must be COMMITTABLE (F-293)", () => {
    // dogfood-130 shipped `benchmarks/results/.gitignore` with `*` plus a bare
    // `!**/probe.json`. Git never descends into an ignored DIRECTORY, so the
    // negation was inert and `git add` refused every per-task probe.json — the
    // run's own AC passed only because the executor had force-added them inside
    // its workspace, where a tracked file bypasses the rules entirely. Evidence a
    // fresh clone cannot reproduce is not durable evidence.
    const repoRoot = findRepoRoot(import.meta.dirname);

    /** `git check-ignore` exits 0 when the path is ignored, 1 when it is not. */
    function ignored(relPath: string): boolean {
      try {
        execFileSync("git", ["-C", repoRoot, "check-ignore", "--no-index", "-q", "--", relPath], {
          stdio: "ignore",
        });
        return true;
      } catch {
        return false;
      }
    }

    it("re-includes the ledger and the per-task probe.json the sweep commits", () => {
      expect(ignored("benchmarks/results/discrimination.json")).toBe(false);
      for (const id of ["brownfield-002", "brownfield-003", "brownfield-004", "brownfield-005"]) {
        expect(ignored(`benchmarks/results/${id}/probe.json`)).toBe(false);
      }
    });

    it("still excludes the raw sweep artifacts beside it", () => {
      // The re-inclusion must stay depth-1. A recursive `!*/` also re-exposes the
      // nested suite `workspace/` git repos, which `git add -A` then stages as
      // orphan mode-160000 gitlinks — the defect that killed run-838ae110.
      expect(ignored("benchmarks/results/brownfield-002/base-workspace/probe.json")).toBe(true);
      expect(ignored("benchmarks/results/brownfield-002/adapter.log")).toBe(true);
      expect(ignored("benchmarks/results/p3-rung-4/chikory/20260803-131837-chikory/summary.json")).toBe(true);
    });
  });
});

