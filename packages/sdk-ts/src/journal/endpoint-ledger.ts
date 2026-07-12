/**
 * Cross-run endpoint consumption ledger (WP-310).
 *
 * Quota windows (rolling-5h, weekly) outlive any single run and are shared by
 * concurrent runs on one subscription, so this record lives beside `runs/` at
 * `<dataDir>/ledger/endpoints.db` (the chain.db precedent). The per-run
 * journal stays the run's authoritative record; this ledger is a cross-run
 * index appended in the same activity that journals the step.
 *
 * Uses `node:sqlite` (pinned nodejs@22 in devbox) — no native build step.
 * Touched ONLY inside activities: the workflow sees quota state exclusively
 * as memoized activity results.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { DeclaredQuotaWindow } from "../endpoint-capability.js";

export interface ConsumptionAppend {
  readonly endpointTarget: string;
  readonly family: string;
  readonly runId: string;
  readonly stepIndex: number;
  readonly tsMs: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costUsd: number;
}

export interface LimitObservationAppend {
  readonly endpointTarget: string;
  readonly windowKind: DeclaredQuotaWindow["window"];
  readonly observedAtMs: number;
  readonly resetAtMs?: number;
  /**
   * Consumption sum inside the window at hit time — the learned capacity
   * estimate for that window (capacity is observed, never vendor-declared).
   */
  readonly consumedTokensAtHit: number;
}

export interface LedgerWindowState {
  readonly window: DeclaredQuotaWindow["window"];
  readonly windowMs: number;
  /** Sum of ledger consumption inside the current window, all runs. */
  readonly consumedTokens: number;
  /** Latest learned capacity from limit observations; undefined until a limit is hit. */
  readonly capacityTokens?: number;
  /** Latest learned reset inside the future; undefined = never observed. */
  readonly resetAtMs?: number;
}

export class EndpointLedger {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    // Concurrent runs on one subscription share this file: writers must wait
    // each other out instead of failing with SQLITE_BUSY.
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS consumption (
        endpoint_target TEXT NOT NULL,
        family TEXT NOT NULL,
        run_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        ts_ms INTEGER NOT NULL,
        tokens_in INTEGER NOT NULL,
        tokens_out INTEGER NOT NULL,
        cost_usd REAL NOT NULL,
        PRIMARY KEY (run_id, step_index)
      );
      CREATE INDEX IF NOT EXISTS consumption_target_ts
        ON consumption (endpoint_target, ts_ms);
      CREATE TABLE IF NOT EXISTS limit_observations (
        endpoint_target TEXT NOT NULL,
        window_kind TEXT NOT NULL,
        observed_at_ms INTEGER NOT NULL,
        reset_at_ms INTEGER,
        consumed_tokens_at_hit INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS limit_observations_target
        ON limit_observations (endpoint_target, window_kind, observed_at_ms);
    `);
  }

  /** Idempotent per (runId, stepIndex) — a retried activity never double-counts. */
  appendConsumption(input: ConsumptionAppend): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO consumption
           (endpoint_target, family, run_id, step_index, ts_ms, tokens_in, tokens_out, cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.endpointTarget,
        input.family,
        input.runId,
        input.stepIndex,
        input.tsMs,
        input.tokensIn,
        input.tokensOut,
        input.costUsd,
      );
  }

  appendLimitObservation(input: LimitObservationAppend): void {
    this.db
      .prepare(
        `INSERT INTO limit_observations
           (endpoint_target, window_kind, observed_at_ms, reset_at_ms, consumed_tokens_at_hit)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        input.endpointTarget,
        input.windowKind,
        input.observedAtMs,
        input.resetAtMs ?? null,
        input.consumedTokensAtHit,
      );
  }

  /**
   * Quota state for one declared window: consumption inside the trailing
   * window across ALL runs, plus the latest learned capacity/reset.
   */
  windowState(endpointTarget: string, window: DeclaredQuotaWindow, nowMs: number): LedgerWindowState {
    const consumed = this.db
      .prepare(
        `SELECT COALESCE(SUM(tokens_in + tokens_out), 0) AS tokens
           FROM consumption
          WHERE endpoint_target = ? AND ts_ms > ?`,
      )
      .get(endpointTarget, nowMs - window.durationMs) as { tokens: number };

    const observation = this.db
      .prepare(
        `SELECT reset_at_ms, consumed_tokens_at_hit
           FROM limit_observations
          WHERE endpoint_target = ? AND window_kind = ?
          ORDER BY observed_at_ms DESC LIMIT 1`,
      )
      .get(endpointTarget, window.window) as
      | { reset_at_ms: number | null; consumed_tokens_at_hit: number }
      | undefined;

    const state: LedgerWindowState = {
      window: window.window,
      windowMs: window.durationMs,
      consumedTokens: consumed.tokens,
      ...(observation !== undefined ? { capacityTokens: observation.consumed_tokens_at_hit } : {}),
      ...(observation?.reset_at_ms != null && observation.reset_at_ms > nowMs
        ? { resetAtMs: observation.reset_at_ms }
        : {}),
    };
    return state;
  }

  close(): void {
    this.db.close();
  }
}
