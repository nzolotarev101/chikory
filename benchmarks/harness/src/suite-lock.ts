/**
 * One benchmark suite at a time, per results root (F-239).
 *
 * dogfood-122's chain node N-3 was asked to score five pinned brownfield tasks.
 * Its executor launched a suite, judged it stuck, and launched another — four
 * ran CONCURRENTLY against the same results root, each cloning three real OSS
 * targets and installing their node_modules. None of the four ever finished a
 * task past `brownfield-003`, and the wall-clock every one of them reported was
 * meaningless because they were competing for the same CPU, network, and disk.
 *
 * A lock file is the whole mechanism: exclusive create (`wx`) is atomic, and a
 * stale one from a killed suite is reclaimed by checking whether its recorded
 * pid is still alive. Nothing here is a security boundary — it is a guard
 * against a well-meaning agent starting the same expensive thing twice.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SUITE_LOCK_FILE = ".suite-lock.json";

export interface SuiteLockHolder {
  pid: number;
  startedAt: string;
  suite: string;
  adapter: string;
}

/** Whether a recorded pid still names a live process (F-239 staleness check). */
function pidAlive(pid: number): boolean {
  try {
    // Signal 0 performs the permission/existence check without delivering.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = alive but owned by another user; only ESRCH means gone.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export class SuiteAlreadyRunningError extends Error {
  constructor(readonly holder: SuiteLockHolder, readonly lockPath: string) {
    super(
      `another benchmark suite is already running against this results root ` +
        `(pid ${holder.pid}, suite "${holder.suite}", adapter ${holder.adapter}, started ${holder.startedAt}). ` +
        `Benchmark tasks clone and install real targets, so a second suite would compete with it for ` +
        `disk, network, and CPU, and both arms' wall-clock would be meaningless. ` +
        `Wait for it, or remove ${lockPath} if you are certain it is dead.`,
    );
    this.name = "SuiteAlreadyRunningError";
  }
}

/**
 * Claim the results root for this process. Returns a release function; throws
 * `SuiteAlreadyRunningError` when a LIVE suite already holds it.
 */
export function acquireSuiteLock(
  resultsDir: string,
  holder: Omit<SuiteLockHolder, "pid" | "startedAt">,
): () => void {
  mkdirSync(resultsDir, { recursive: true });
  const lockPath = join(resultsDir, SUITE_LOCK_FILE);
  const record: SuiteLockHolder = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    ...holder,
  };

  const write = (): void => {
    writeFileSync(lockPath, JSON.stringify(record, null, 2), { flag: "wx" });
  };

  try {
    write();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    const existing = readLock(lockPath);
    // An unreadable or corrupt lock is treated as stale: a suite that could not
    // finish writing its own lock is not one worth deferring to.
    if (existing !== undefined && pidAlive(existing.pid)) {
      throw new SuiteAlreadyRunningError(existing, lockPath);
    }
    rmSync(lockPath, { force: true });
    write();
  }

  return () => rmSync(lockPath, { force: true });
}

/** The current holder, or `undefined` when there is no readable lock. */
export function readLock(lockPath: string): SuiteLockHolder | undefined {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, "utf8")) as Partial<SuiteLockHolder>;
    if (typeof parsed.pid !== "number") return undefined;
    return {
      pid: parsed.pid,
      startedAt: parsed.startedAt ?? "unknown",
      suite: parsed.suite ?? "unknown",
      adapter: parsed.adapter ?? "unknown",
    };
  } catch {
    return undefined;
  }
}
