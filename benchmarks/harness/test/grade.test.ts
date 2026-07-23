import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { gradeTask, type JudgeFn } from "../src/grade.js";
import type { BenchmarkTask } from "../src/task.js";

function task(requirements: BenchmarkTask["requirements"]): BenchmarkTask {
  return {
    id: "greenfield-001",
    source: "authored",
    class: "greenfield",
    status: "pinned",
    goal: "g",
    requirements,
    preferences: [],
    tags: [],
    flags: {},
  };
}

describe("gradeTask", () => {
  it("runs check commands in the workspace and computes I-SR/D-SR", async () => {
    const ws = mkdtempSync(join(tmpdir(), "bench-grade-"));
    writeFileSync(join(ws, "present.txt"), "yes");
    const report = await gradeTask(
      task([
        { id: "R1", description: "file exists", prerequisites: [], grading: { kind: "check", command: "test -f present.txt" } },
        { id: "R2", description: "file absent", prerequisites: [], grading: { kind: "check", command: "test -f missing.txt" } },
        { id: "R3", description: "depends on R2", prerequisites: ["R2"], grading: { kind: "check", command: "true" } },
      ]),
      { workspaceDir: ws },
    );
    expect(report.total).toBe(3);
    // I-SR counts R1 + R3 (independently satisfied)…
    expect(report.satisfied).toBe(2);
    // …but D-SR drops R3: its prerequisite R2 failed.
    expect(report.dependencySatisfied).toBe(1);
    expect(report.grades.find((g) => g.requirementId === "R2")!.detail).toMatch(/exit 1/);
  });

  it("scrubs provider env from checks — judge/grader parity (F-163)", async () => {
    const ws = mkdtempSync(join(tmpdir(), "bench-grade-"));
    process.env.GEMINI_API_KEY = "should-not-leak";
    try {
      // Passes only if $GEMINI_API_KEY is empty in the check env, exactly as the
      // in-loop judge sees it (both scrub PROVIDER_ENV_VARS) — so a check can
      // never pass/fail on a provider var the two runners disagree about.
      const report = await gradeTask(
        task([{ id: "R1", description: "", prerequisites: [], grading: { kind: "check", command: 'test -z "$GEMINI_API_KEY"' } }]),
        { workspaceDir: ws },
      );
      expect(report.satisfied).toBe(1);
    } finally {
      delete process.env.GEMINI_API_KEY;
    }
  });

  it("gates transitively: R3←R2←R1 with R1 failed drops both dependents", async () => {
    const ws = mkdtempSync(join(tmpdir(), "bench-grade-"));
    const report = await gradeTask(
      task([
        { id: "R1", description: "", prerequisites: [], grading: { kind: "check", command: "false" } },
        { id: "R2", description: "", prerequisites: ["R1"], grading: { kind: "check", command: "true" } },
        { id: "R3", description: "", prerequisites: ["R2"], grading: { kind: "check", command: "true" } },
      ]),
      { workspaceDir: ws },
    );
    expect(report.satisfied).toBe(2);
    expect(report.dependencySatisfied).toBe(0);
  });

  it("judge-graded requirements without a judge count unsatisfied, marked skipped", async () => {
    const ws = mkdtempSync(join(tmpdir(), "bench-grade-"));
    const report = await gradeTask(
      task([{ id: "R1", description: "d", prerequisites: [], grading: { kind: "judge", criteria: "c" } }]),
      { workspaceDir: ws },
    );
    expect(report.satisfied).toBe(0);
    expect(report.grades[0]!.skipped).toBe("no-judge-configured");
  });

  it("delegates judge-graded requirements to the injected judge", async () => {
    const ws = mkdtempSync(join(tmpdir(), "bench-grade-"));
    const seen: string[] = [];
    const judge: JudgeFn = async ({ criteria }) => {
      seen.push(criteria);
      return { satisfied: criteria.includes("yes"), rationale: "because" };
    };
    const report = await gradeTask(
      task([
        { id: "R1", description: "", prerequisites: [], grading: { kind: "judge", criteria: "yes please" } },
        { id: "R2", description: "", prerequisites: [], grading: { kind: "judge", criteria: "no" } },
      ]),
      { workspaceDir: ws, judge },
    );
    expect(seen).toHaveLength(2);
    expect(report.satisfied).toBe(1);
  });

  it("kills a hung check at the timeout", async () => {
    const ws = mkdtempSync(join(tmpdir(), "bench-grade-"));
    const report = await gradeTask(
      task([{ id: "R1", description: "", prerequisites: [], grading: { kind: "check", command: "sleep 30" } }]),
      { workspaceDir: ws, timeoutMs: 200 },
    );
    expect(report.satisfied).toBe(0);
  }, 10_000);
});
