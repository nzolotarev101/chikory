/**
 * Run journal (WP-121/122) — the product-facing record of a run.
 *
 * Append-only SQLite db per run (`.chikory/runs/<run-id>/journal.db`), schema
 * per journal-format.md §1: inspectable with any SQLite client, no server
 * dependency (RT-9). Temporal history handles *replay*; this journal is what
 * traces, metrics, and the benchmark dataset derive from.
 *
 * Uses `node:sqlite` (pinned nodejs@22 in devbox) — no native build step.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  ArtifactRef,
  Checkpoint,
  JournalEntry,
  JournalEntryKind,
  RunStatus,
  RunStatusReport,
  TaskSpec,
  TokenUsage,
  VerdictKind,
} from "../types.js";

/** Payloads >8KB must be stored as artifacts with refs inline (CM-3). */
export const MAX_PAYLOAD_BYTES = 8 * 1024;

export interface AppendInput {
  kind: JournalEntryKind;
  payload: unknown;
  costDeltaUsd: number;
  tokens?: TokenUsage;
  artifactRefs: ArtifactRef[];
}

export interface RunRow {
  runId: string;
  task: TaskSpec;
  startedAt: string;
  endedAt: string | null;
  status: RunStatus;
}

interface EntryRow {
  idx: number;
  ts: string;
  kind: string;
  payload_json: string;
  cost_delta_usd: number;
  tokens_in: number | null;
  tokens_out: number | null;
  artifact_refs_json: string;
}

function rowToEntry(row: EntryRow): JournalEntry {
  const entry: JournalEntry = {
    idx: row.idx,
    ts: row.ts,
    kind: row.kind as JournalEntryKind,
    payload: JSON.parse(row.payload_json),
    costDeltaUsd: row.cost_delta_usd,
    artifactRefs: JSON.parse(row.artifact_refs_json) as ArtifactRef[],
  };
  if (row.tokens_in !== null && row.tokens_out !== null) {
    entry.tokens = { input: row.tokens_in, output: row.tokens_out };
  }
  return entry;
}

/**
 * One journal = one run. All writes go through `append`/`appendOnce`
 * (journal-format.md: "writes go through one activity"); idx is strictly
 * monotonic and history is never rewritten — corrections are new entries.
 */
export class Journal {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    // WAL survives kill -9 mid-transaction (WP-123).
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS journal_entries (
        idx INTEGER PRIMARY KEY,
        ts TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        cost_delta_usd REAL NOT NULL,
        tokens_in INTEGER,
        tokens_out INTEGER,
        artifact_refs_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        task_json TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        status TEXT NOT NULL
      );
    `);
  }

  /** Idempotent — re-entry after a crash must not reset run metadata. */
  createRun(runId: string, task: TaskSpec): void {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO runs (run_id, task_json, started_at, status) VALUES (?, ?, ?, ?)",
      )
      .run(runId, JSON.stringify(task), new Date().toISOString(), "RUNNING");
  }

  getRun(): RunRow | undefined {
    const row = this.db.prepare("SELECT * FROM runs LIMIT 1").get() as
      | {
          run_id: string;
          task_json: string;
          started_at: string;
          ended_at: string | null;
          status: string;
        }
      | undefined;
    if (!row) return undefined;
    return {
      runId: row.run_id,
      task: JSON.parse(row.task_json) as TaskSpec,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      status: row.status as RunStatus,
    };
  }

  sealRun(status: RunStatus): void {
    this.db
      .prepare("UPDATE runs SET status = ?, ended_at = ?")
      .run(status, new Date().toISOString());
  }

  append(input: AppendInput): JournalEntry {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const next = this.db
        .prepare("SELECT COALESCE(MAX(idx), -1) + 1 AS idx FROM journal_entries")
        .get() as { idx: number };
      const ts = new Date().toISOString();
      this.db
        .prepare(
          `INSERT INTO journal_entries
             (idx, ts, kind, payload_json, cost_delta_usd, tokens_in, tokens_out, artifact_refs_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          next.idx,
          ts,
          input.kind,
          JSON.stringify(input.payload),
          input.costDeltaUsd,
          input.tokens?.input ?? null,
          input.tokens?.output ?? null,
          JSON.stringify(input.artifactRefs),
        );
      this.db.exec("COMMIT");
      const entry: JournalEntry = {
        idx: next.idx,
        ts,
        kind: input.kind,
        payload: input.payload,
        costDeltaUsd: input.costDeltaUsd,
        artifactRefs: input.artifactRefs,
      };
      if (input.tokens) entry.tokens = input.tokens;
      return entry;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /**
   * Idempotent append — the crash-recovery primitive (WP-123). Entries are
   * keyed by a deterministic field the workflow assigns (e.g. `stepIndex`);
   * if an entry with the same kind+key already exists, the persisted one is
   * returned and `existed` is true, so activity re-execution never produces
   * duplicate journal rows (and callers can skip duplicate LLM spend).
   */
  appendOnce(
    key: { field: string; value: number },
    input: AppendInput,
  ): { entry: JournalEntry; existed: boolean } {
    const existing = this.findByKey(input.kind, key.field, key.value);
    if (existing) return { entry: existing, existed: true };
    return { entry: this.append(input), existed: false };
  }

  findByKey(kind: JournalEntryKind, field: string, value: number): JournalEntry | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM journal_entries
         WHERE kind = ? AND json_extract(payload_json, '$.' || ?) = ?
         ORDER BY idx LIMIT 1`,
      )
      .get(kind, field, value) as EntryRow | undefined;
    return row ? rowToEntry(row) : undefined;
  }

  entries(kind?: JournalEntryKind): JournalEntry[] {
    const rows = (
      kind
        ? this.db.prepare("SELECT * FROM journal_entries WHERE kind = ? ORDER BY idx").all(kind)
        : this.db.prepare("SELECT * FROM journal_entries ORDER BY idx").all()
    ) as unknown as EntryRow[];
    return rows.map(rowToEntry);
  }

  /**
   * The idx the next append will get. Safe within a run: a run is one
   * workflow, and Temporal serializes its activities — there is no
   * concurrent writer (used to self-reference checkpoint entries, WP-122).
   */
  nextIdx(): number {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(idx), -1) + 1 AS idx FROM journal_entries")
      .get() as { idx: number };
    return row.idx;
  }

  /** journal-format.md §4: run cost == Σ costDeltaUsd (cost conservation). */
  totalCostUsd(): number {
    const row = this.db
      .prepare("SELECT COALESCE(SUM(cost_delta_usd), 0) AS total FROM journal_entries")
      .get() as { total: number };
    return row.total;
  }

  close(): void {
    this.db.close();
  }
}

interface TerminalPayload {
  status: string;
  reason?: string;
  lastCheckpoint?: string;
}

interface VerdictPayload {
  atStep: number;
  verdict: { kind: VerdictKind };
}

/**
 * RunStatusReport derived purely from the journal — the offline fallback for
 * `chikory status`/`list` when no worker is up to answer the workflow query.
 */
export function reportFromJournal(journal: Journal): RunStatusReport | undefined {
  const run = journal.getRun();
  if (!run) return undefined;

  const steps = journal.entries("step");
  const checkpoints = journal
    .entries("checkpoint")
    .map((e) => e.payload as Checkpoint);
  const verdicts = journal.entries("verdict");
  const lastVerdictEntry = verdicts[verdicts.length - 1];

  const report: RunStatusReport = {
    status: run.status,
    currentStep: steps.length,
    spentUsd: journal.totalCostUsd(),
    budgetUsd: run.task.budgetUsd,
    checkpoints,
  };
  if (lastVerdictEntry) {
    const payload = lastVerdictEntry.payload as VerdictPayload;
    report.lastVerdict = { kind: payload.verdict.kind, atStep: payload.atStep };
  }
  const terminal = journal.entries("terminal")[0];
  if (terminal) {
    const payload = terminal.payload as TerminalPayload;
    if (payload.status === "FAILED") {
      report.failure = {
        reason: payload.reason ?? "unknown",
        lastCheckpoint: payload.lastCheckpoint ?? "",
      };
    }
  }
  return report;
}
