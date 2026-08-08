import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import { describe, expect, it } from "vitest";
import { runProbe, runProbeSweep } from "../src/probe.js";

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
      expect(outLogs.some((l) => l.includes("brownfield-902: failed"))).toBe(true);

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
});

