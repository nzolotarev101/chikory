/**
 * Opening a Chikory SQLite record so a failure says WHICH file and WHY (F-235).
 *
 * `node:sqlite` reports an open failure as the bare libsqlite string — most
 * often `unable to open database file` (SQLITE_CANTOPEN), with no path, no
 * errno, and no operation. Every db path in the runner is built from
 * `DEFAULT_DATA_DIR`, a RELATIVE `.chikory`, so the file that failed depends on
 * the process's cwd and cannot be inferred from the message either.
 *
 * dogfood-122 (2026-08-01) lost a 5h39m chain to exactly that line. The crash
 * site was never identified, because the message could not distinguish the run
 * journal from the chain store from the endpoint ledger, and could not say
 * whether the cause was a full volume, a missing directory, or permissions.
 *
 * SQLITE_CANTOPEN is overwhelmingly a full disk or a vanished directory, so the
 * wrapper reports free space when it is low — the check itself must never mask
 * the original error, so any failure inside it is swallowed.
 */
import { mkdirSync, statfsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Free space below this in the reason is worth naming as a likely cause. */
const LOW_SPACE_BYTES = 2 * 1024 * 1024 * 1024;

/** ` (…MiB free…)` when the volume is nearly full, else `""`. Never throws. */
function diskHint(path: string): string {
  try {
    const stats = statfsSync(path);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    if (!Number.isFinite(freeBytes) || freeBytes >= LOW_SPACE_BYTES) return "";
    return ` — only ${Math.round(freeBytes / 1024 / 1024)} MiB free on its volume, which is the usual cause`;
  } catch {
    return "";
  }
}

/**
 * Open (creating the parent directory) the SQLite file backing `kind`, raising
 * a diagnosable error instead of a bare libsqlite string.
 *
 * `kind` is the human name of the record — "run journal", "chain store",
 * "endpoint ledger" — so a reader can tell the three apart in a log line.
 */
export function openDatabase(dbPath: string, kind: string): DatabaseSync {
  // `:memory:` and `file:` URIs are libsqlite sentinels, not filesystem paths —
  // resolving them would create a literal `./:memory:` file on disk, and every
  // in-memory journal would silently become a shared, persistent one.
  if (dbPath === ":memory:" || dbPath.startsWith("file:")) {
    try {
      return new DatabaseSync(dbPath);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`cannot open ${kind} at ${dbPath}: ${detail}`, { cause: err });
    }
  }
  const absolute = resolve(dbPath);
  try {
    mkdirSync(dirname(absolute), { recursive: true });
    return new DatabaseSync(absolute);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`cannot open ${kind} at ${absolute}${diskHint(absolute)}: ${detail}`, {
      cause: err,
    });
  }
}
