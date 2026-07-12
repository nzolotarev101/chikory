/**
 * Trace-dataset capture pipeline (WP-306) — the "deeper moat"
 * (docs/components/benchmark.md): normalize finished runs' journals into
 * dataset records of how agents actually fail and recover.
 *
 * Posture (benchmark.md): **opt-in and local-first** — export happens only via
 * the explicit `chikory dataset export` command, output stays on disk, nothing
 * is ever uploaded. Schema = the JIF journal interchange shape (`traceJson`)
 * plus derived recovery paths. Records containing real-secret-shaped strings
 * are skipped and reported, never written (no key material leaves a journal).
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Journal, runTotals, type RunRow, type RunTotals } from "../journal/journal.js";
import { scanTextForRealSecrets } from "../judge/scan-secrets.js";
import { journalPath } from "../runner/paths.js";
import type { JournalEntry, VerdictKind } from "../types.js";

export const DATASET_RECORD_VERSION = 1;

/** One judge-triggered rollback and whether/how the run recovered from it. */
export interface RecoveryPath {
  /** Step the ROLLBACK verdict fired at. */
  rollbackAtStep: number;
  /** Journal idx of the ROLLBACK verdict entry (links back to the raw trace). */
  verdictIdx: number;
  /** A later PROCEED verdict or a SUCCESS seal followed the rollback. */
  recovered: boolean;
  /** Steps between the rollback and the next PROCEED verdict, when one exists. */
  stepsToRecover?: number;
}

export interface DatasetRecord {
  version: typeof DATASET_RECORD_VERSION;
  capturedAt: string;
  run: {
    runId: string;
    status: RunRow["status"];
    startedAt: string;
    endedAt: string | null;
    task: RunRow["task"];
  };
  totals: RunTotals;
  recoveries: RecoveryPath[];
  entries: JournalEntry[];
}

interface VerdictPayload {
  atStep: number;
  verdict: { kind: VerdictKind };
}

/** Derive rollback→recovery arcs from the verdict stream. */
export function deriveRecoveryPaths(entries: JournalEntry[], runStatus: string): RecoveryPath[] {
  const verdicts = entries
    .filter((e) => e.kind === "verdict")
    .map((e) => ({ idx: e.idx, payload: e.payload as VerdictPayload }));
  const paths: RecoveryPath[] = [];
  for (let i = 0; i < verdicts.length; i++) {
    const v = verdicts[i]!;
    if (v.payload.verdict.kind !== "ROLLBACK") continue;
    const laterProceed = verdicts
      .slice(i + 1)
      .find((later) => later.payload.verdict.kind === "PROCEED");
    const path: RecoveryPath = {
      rollbackAtStep: v.payload.atStep,
      verdictIdx: v.idx,
      recovered: laterProceed !== undefined || runStatus === "SUCCESS",
    };
    if (laterProceed !== undefined) {
      path.stepsToRecover = laterProceed.payload.atStep - v.payload.atStep;
    }
    paths.push(path);
  }
  return paths;
}

/** One run's journal → one dataset record; undefined when the journal has no run row. */
export function buildDatasetRecord(journal: Journal, now: () => Date = () => new Date()): DatasetRecord | undefined {
  const run = journal.getRun();
  if (!run) return undefined;
  const entries = journal.entries();
  return {
    version: DATASET_RECORD_VERSION,
    capturedAt: now().toISOString(),
    run: {
      runId: run.runId,
      status: run.status,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      task: run.task,
    },
    totals: runTotals(journal),
    recoveries: deriveRecoveryPaths(entries, run.status),
    entries,
  };
}

export interface DatasetIndexRow {
  runId: string;
  status: string;
  steps: number;
  rollbacks: number;
  recoveries: number;
  recovered: number;
  costUsd: number;
  file: string;
}

export interface ExportDatasetSummary {
  outDir: string;
  exported: DatasetIndexRow[];
  /** Runs skipped because the serialized record matched a real-secret pattern. */
  secretFlagged: { runId: string; labels: string[] }[];
  /** Run dirs without a readable run row (crashed before createRun). */
  skipped: string[];
}

/**
 * Export every run journal under `<dataDir>/runs/` into `<outDir>`:
 * one `<runId>.json` record per run + an `index.json` of summary rows.
 */
export function exportDataset(
  dataDir: string,
  outDir: string,
  now: () => Date = () => new Date(),
): ExportDatasetSummary {
  const runsDir = join(dataDir, "runs");
  const summary: ExportDatasetSummary = { outDir, exported: [], secretFlagged: [], skipped: [] };
  const runIds = existsSync(runsDir) ? readdirSync(runsDir).sort() : [];
  mkdirSync(outDir, { recursive: true });

  for (const runId of runIds) {
    const path = journalPath(dataDir, runId);
    if (!existsSync(path)) {
      summary.skipped.push(runId);
      continue;
    }
    const journal = new Journal(path);
    try {
      const record = buildDatasetRecord(journal, now);
      if (!record) {
        summary.skipped.push(runId);
        continue;
      }
      const serialized = JSON.stringify(record, null, 2);
      const labels = scanTextForRealSecrets(serialized);
      if (labels.length > 0) {
        summary.secretFlagged.push({ runId, labels });
        continue;
      }
      const file = `${runId}.json`;
      writeFileSync(join(outDir, file), serialized);
      summary.exported.push({
        runId,
        status: record.run.status,
        steps: record.totals.steps,
        rollbacks: record.totals.rollbacks,
        recoveries: record.recoveries.length,
        recovered: record.recoveries.filter((r) => r.recovered).length,
        costUsd: record.totals.costUsd,
        file,
      });
    } finally {
      journal.close();
    }
  }

  writeFileSync(
    join(outDir, "index.json"),
    JSON.stringify(
      { version: DATASET_RECORD_VERSION, exportedAt: now().toISOString(), runs: summary.exported },
      null,
      2,
    ),
  );
  return summary;
}
