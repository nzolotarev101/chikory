/**
 * Chain journal (WP-219, ADR-005 D4) — the durable, chain-level record that
 * spans runs. A chain is decomposed once into a `Plan`; each node runs as an
 * ordinary TaskSpec run with its own per-run `Journal`, while this store holds
 * the chain-scope facts: the plan, the plan meta-judge verdict, and the
 * `node_started` / `node_sealed` events the chain executor (S3-wiring) emits.
 *
 * Mirrors the per-run `Journal` pattern (D4: "chain-level record … mirrors the
 * per-run SQLite journal pattern"): append-only SQLite, inspectable with any
 * client, no server dependency. The pure `advanceChain` / `deriveChainStatus`
 * reducer derives chain status; this store is the durable substrate it folds
 * over. `chainRecordFrom` reconstructs the frozen `ChainRecord` from the
 * entries so a chain is itself resumable and traceable (D4).
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  ChainNodeHandoff,
  ChainRecord,
  ChainStatus,
  NodeOutcome,
  Plan,
  PlanVerdict,
} from "../types.js";

/** Chain-scope JIF kinds this store accepts (subset of `JournalEntryKind`). */
export type ChainEntryKind =
  | "plan"
  | "plan_verdict"
  | "node_started"
  | "node_sealed"
  | "terminal";

export interface ChainEntry {
  idx: number;
  ts: string;
  kind: ChainEntryKind;
  payload: unknown;
}

/** `node_started` payload: the chain dispatched a node → child run. */
export interface NodeStartedPayload {
  nodeId: string;
  childRunId: string;
}

/** `node_sealed` payload: a node's child run reached a terminal outcome. */
export interface NodeSealedPayload {
  nodeId: string;
  outcome: NodeOutcome;
  handoff?: ChainNodeHandoff;
}

interface ChainEntryRow {
  idx: number;
  ts: string;
  kind: string;
  payload_json: string;
}

interface ChainRow {
  plan_json: string;
  status: string;
}

function rowToEntry(row: ChainEntryRow): ChainEntry {
  return {
    idx: row.idx,
    ts: row.ts,
    kind: row.kind as ChainEntryKind,
    payload: JSON.parse(row.payload_json),
  };
}

/**
 * One store = one chain. Writes go through `append` (and the idempotent
 * `appendOnce` keyed by nodeId, the crash-recovery primitive — a re-executed
 * chain activity must never double-journal a node event).
 */
export class ChainJournal {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chain_entries (
        idx INTEGER PRIMARY KEY,
        ts TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chains (
        chain_id TEXT PRIMARY KEY,
        plan_json TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        status TEXT NOT NULL
      );
    `);
  }

  /** Idempotent — re-entry after a crash must not reset chain metadata. */
  createChain(chainId: string, plan: Plan): void {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO chains (chain_id, plan_json, started_at, status) VALUES (?, ?, ?, ?)",
      )
      .run(chainId, JSON.stringify(plan), new Date().toISOString(), "RUNNING");
  }

  getChain(): ChainRow | undefined {
    const row = this.db.prepare("SELECT plan_json, status FROM chains LIMIT 1").get() as
      | ChainRow
      | undefined;
    return row;
  }

  setStatus(status: ChainStatus, ended = false): void {
    this.db
      .prepare(`UPDATE chains SET status = ?${ended ? ", ended_at = ?" : ""}`)
      .run(...(ended ? [status, new Date().toISOString()] : [status]));
  }

  append(kind: ChainEntryKind, payload: unknown): ChainEntry {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const next = this.db
        .prepare("SELECT COALESCE(MAX(idx), -1) + 1 AS idx FROM chain_entries")
        .get() as { idx: number };
      const ts = new Date().toISOString();
      this.db
        .prepare("INSERT INTO chain_entries (idx, ts, kind, payload_json) VALUES (?, ?, ?, ?)")
        .run(next.idx, ts, kind, JSON.stringify(payload));
      this.db.exec("COMMIT");
      return { idx: next.idx, ts, kind, payload };
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /**
   * Idempotent append keyed by a payload field (e.g. `nodeId`) — the
   * crash-recovery primitive (mirrors `Journal.appendOnce`). A re-executed
   * chain activity finds the persisted entry and returns it instead of
   * writing a duplicate.
   */
  appendOnce(
    kind: ChainEntryKind,
    key: { field: string; value: string },
    payload: unknown,
  ): { entry: ChainEntry; existed: boolean } {
    const existing = this.findByKey(kind, key.field, key.value);
    if (existing) return { entry: existing, existed: true };
    return { entry: this.append(kind, payload), existed: false };
  }

  findByKey(kind: ChainEntryKind, field: string, value: string): ChainEntry | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM chain_entries
         WHERE kind = ? AND json_extract(payload_json, '$.' || ?) = ?
         ORDER BY idx LIMIT 1`,
      )
      .get(kind, field, value) as ChainEntryRow | undefined;
    return row ? rowToEntry(row) : undefined;
  }

  entries(kind?: ChainEntryKind): ChainEntry[] {
    const rows = (
      kind
        ? this.db.prepare("SELECT * FROM chain_entries WHERE kind = ? ORDER BY idx").all(kind)
        : this.db.prepare("SELECT * FROM chain_entries ORDER BY idx").all()
    ) as unknown as ChainEntryRow[];
    return rows.map(rowToEntry);
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Reconstruct the frozen `ChainRecord` (ADR-005 D4) purely from a chain
 * journal — the offline view of chain state, and the value the pure
 * `deriveChainStatus` reducer can be re-run over. `nodeRuns` comes from
 * `node_started` (node → child run id), `nodeOutcomes` from `node_sealed`;
 * the latest `plan_verdict` is the chain's plan verdict. `status` is the
 * persisted chain status (set by the orchestrator, the reducer's output).
 */
export function chainRecordFrom(journal: ChainJournal): ChainRecord | undefined {
  const chain = journal.getChain();
  if (!chain) return undefined;
  const plan = JSON.parse(chain.plan_json) as Plan;

  const nodeRuns: Record<string, string> = {};
  for (const e of journal.entries("node_started")) {
    const p = e.payload as NodeStartedPayload;
    nodeRuns[p.nodeId] = p.childRunId;
  }

  const nodeOutcomes: Record<string, NodeOutcome> = {};
  const nodeHandoffs: Record<string, ChainNodeHandoff> = {};
  for (const e of journal.entries("node_sealed")) {
    const p = e.payload as NodeSealedPayload;
    nodeOutcomes[p.nodeId] = p.outcome;
    if (p.handoff !== undefined) nodeHandoffs[p.nodeId] = p.handoff;
  }

  const verdicts = journal.entries("plan_verdict");
  const lastVerdict = verdicts[verdicts.length - 1]?.payload as PlanVerdict | undefined;

  const record: ChainRecord = {
    planId: plan.id,
    plan,
    nodeRuns,
    nodeOutcomes,
    ...(Object.keys(nodeHandoffs).length > 0 ? { nodeHandoffs } : {}),
    status: chain.status as ChainStatus,
  };
  if (lastVerdict) record.planVerdict = lastVerdict;
  return record;
}
