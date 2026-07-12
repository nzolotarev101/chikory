import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildDatasetRecord,
  DATASET_RECORD_VERSION,
  deriveRecoveryPaths,
  exportDataset,
} from "../../src/dataset/export.js";
import { Journal } from "../../src/journal/journal.js";
import { journalPath } from "../../src/runner/paths.js";
import type { TaskSpec } from "../../src/types.js";

const TASK = { name: "t", goal: "g", budgetUsd: 10 } as unknown as TaskSpec;

function seedRun(
  dataDir: string,
  runId: string,
  script: (j: Journal) => void,
): void {
  const journal = new Journal(journalPath(dataDir, runId));
  journal.createRun(runId, TASK);
  script(journal);
  journal.close();
}

function verdict(journal: Journal, atStep: number, kind: string, cost = 0.1): void {
  journal.append({
    kind: "verdict",
    payload: { atStep, verdict: { kind } },
    costDeltaUsd: cost,
    artifactRefs: [],
  });
}

function step(journal: Journal, stepIndex: number): void {
  journal.append({
    kind: "step",
    payload: { stepIndex, summary: `step ${stepIndex}` },
    costDeltaUsd: 0.5,
    tokens: { input: 100, output: 50 },
    artifactRefs: [],
  });
}

describe("deriveRecoveryPaths", () => {
  it("pairs a ROLLBACK with the next PASS and measures steps to recover", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ds-"));
    seedRun(dataDir, "run-a", (j) => {
      step(j, 1);
      verdict(j, 1, "PROCEED");
      step(j, 2);
      verdict(j, 2, "ROLLBACK");
      step(j, 3);
      step(j, 4);
      verdict(j, 4, "PROCEED");
      j.sealRun("SUCCESS");
    });
    const journal = new Journal(journalPath(dataDir, "run-a"));
    const paths = deriveRecoveryPaths(journal.entries(), "SUCCESS");
    journal.close();
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatchObject({ rollbackAtStep: 2, recovered: true, stepsToRecover: 2 });
  });

  it("a rollback with no later PASS in a FAILED run is unrecovered", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ds-"));
    seedRun(dataDir, "run-b", (j) => {
      step(j, 1);
      verdict(j, 1, "ROLLBACK");
      j.sealRun("FAILED");
    });
    const journal = new Journal(journalPath(dataDir, "run-b"));
    const paths = deriveRecoveryPaths(journal.entries(), "FAILED");
    journal.close();
    expect(paths).toEqual([
      { rollbackAtStep: 1, verdictIdx: 1, recovered: false },
    ]);
  });
});

describe("buildDatasetRecord", () => {
  it("captures the JIF interchange shape plus derived recoveries", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ds-"));
    seedRun(dataDir, "run-c", (j) => {
      step(j, 1);
      verdict(j, 1, "ROLLBACK");
      step(j, 2);
      verdict(j, 2, "PROCEED");
      j.sealRun("SUCCESS");
    });
    const journal = new Journal(journalPath(dataDir, "run-c"));
    const record = buildDatasetRecord(journal, () => new Date("2026-07-11T00:00:00Z"))!;
    journal.close();
    expect(record.version).toBe(DATASET_RECORD_VERSION);
    expect(record.capturedAt).toBe("2026-07-11T00:00:00.000Z");
    expect(record.run).toMatchObject({ runId: "run-c", status: "SUCCESS", task: TASK });
    expect(record.totals.steps).toBe(2);
    expect(record.totals.rollbacks).toBe(1);
    expect(record.recoveries).toHaveLength(1);
    expect(record.entries).toHaveLength(4);
  });
});

describe("exportDataset", () => {
  it("writes one record per run plus index.json; totals conserved", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ds-"));
    seedRun(dataDir, "run-1", (j) => {
      step(j, 1);
      verdict(j, 1, "PROCEED");
      j.sealRun("SUCCESS");
    });
    seedRun(dataDir, "run-2", (j) => {
      step(j, 1);
      verdict(j, 1, "ROLLBACK");
      j.sealRun("FAILED");
    });
    const outDir = join(dataDir, "dataset");
    const summary = exportDataset(dataDir, outDir);
    expect(summary.exported.map((r) => r.runId)).toEqual(["run-1", "run-2"]);
    expect(summary.secretFlagged).toEqual([]);

    const index = JSON.parse(readFileSync(join(outDir, "index.json"), "utf8"));
    expect(index.runs).toHaveLength(2);
    const rec1 = JSON.parse(readFileSync(join(outDir, "run-1.json"), "utf8"));
    // cost conservation: record total == Σ entry cost deltas
    const sum = rec1.entries.reduce((s: number, e: { costDeltaUsd: number }) => s + e.costDeltaUsd, 0);
    expect(rec1.totals.costUsd).toBeCloseTo(sum);
  });

  it("skips (never writes) a record containing a real-secret-shaped string", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ds-"));
    seedRun(dataDir, "run-leaky", (j) => {
      j.append({
        kind: "step",
        payload: { stepIndex: 1, summary: "oops AKIA" + "QWERTYUIOPASDFGH" },
        costDeltaUsd: 0,
        artifactRefs: [],
      });
      j.sealRun("SUCCESS");
    });
    const outDir = join(dataDir, "dataset");
    const summary = exportDataset(dataDir, outDir);
    expect(summary.exported).toEqual([]);
    expect(summary.secretFlagged).toEqual([
      { runId: "run-leaky", labels: ["aws-access-key"] },
    ]);
    expect(existsSync(join(outDir, "run-leaky.json"))).toBe(false);
    // index still written, listing zero runs
    expect(JSON.parse(readFileSync(join(outDir, "index.json"), "utf8")).runs).toEqual([]);
  });

  it("empty data dir exports an empty index without error", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ds-"));
    const summary = exportDataset(dataDir, join(dataDir, "dataset"));
    expect(summary.exported).toEqual([]);
    expect(summary.skipped).toEqual([]);
  });
});
