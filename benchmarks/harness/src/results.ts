/**
 * Results artifacts (WP-301) — benchmark.md: "results as artifacts"; every
 * published number links to its raw trace. One dir per suite run:
 * `benchmarks/results/<stamp>-<adapter>/` with a per-task JSON + summary.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { AdapterResult } from "./adapter.js";
import type { TaskGradeReport } from "./grade.js";

export interface TaskResult {
  taskId: string;
  source: string;
  class: string;
  adapter: string;
  startedAt: string;
  endedAt: string;
  run: AdapterResult;
  grading: TaskGradeReport;
}

export interface SuiteSummary {
  suite: string;
  adapter: string;
  startedAt: string;
  endedAt: string;
  tasks: number;
  requirementsTotal: number;
  requirementsSatisfied: number;
  /** Independent satisfaction rate (DevAI I-SR), 0..1. */
  iSr: number;
  /** Dependency-adjusted satisfaction rate (DevAI D-SR), 0..1. */
  dSr: number;
  perTask: {
    taskId: string;
    satisfied: number;
    dependencySatisfied: number;
    total: number;
    exitCode: number | null;
    wallClockMs: number;
  }[];
}

export function suiteOutDirName(adapter: string, now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  return `${stamp}-${adapter}`;
}

export function summarize(
  suite: string,
  adapter: string,
  startedAt: string,
  endedAt: string,
  results: TaskResult[],
): SuiteSummary {
  const requirementsTotal = results.reduce((s, r) => s + r.grading.total, 0);
  const requirementsSatisfied = results.reduce((s, r) => s + r.grading.satisfied, 0);
  const dependencySatisfied = results.reduce((s, r) => s + r.grading.dependencySatisfied, 0);
  return {
    suite,
    adapter,
    startedAt,
    endedAt,
    tasks: results.length,
    requirementsTotal,
    requirementsSatisfied,
    iSr: requirementsTotal > 0 ? requirementsSatisfied / requirementsTotal : 0,
    dSr: requirementsTotal > 0 ? dependencySatisfied / requirementsTotal : 0,
    perTask: results.map((r) => ({
      taskId: r.taskId,
      satisfied: r.grading.satisfied,
      dependencySatisfied: r.grading.dependencySatisfied,
      total: r.grading.total,
      exitCode: r.run.exitCode,
      wallClockMs: r.run.wallClockMs,
    })),
  };
}

export function writeTaskResult(outDir: string, result: TaskResult): string {
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, `${sanitizeFileName(result.taskId)}.json`);
  writeFileSync(path, JSON.stringify(result, null, 2));
  return path;
}

export function writeSuiteSummary(outDir: string, summary: SuiteSummary): string {
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, "summary.json");
  writeFileSync(path, JSON.stringify(summary, null, 2));
  return path;
}

/** DevAI task names are filename-safe already; sanitize defensively anyway. */
export function sanitizeFileName(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]+/g, "_");
}
