/**
 * F-239 — one benchmark suite at a time, per results root.
 *
 * dogfood-122's chain node launched FOUR concurrent suites against the same
 * results root, each cloning three real OSS targets and installing their
 * node_modules. None finished a task past `brownfield-003`, and each reported a
 * wall-clock measured while competing with the other three.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  acquireSuiteLock,
  readLock,
  SUITE_LOCK_FILE,
  SuiteAlreadyRunningError,
} from "../src/suite-lock.js";

describe("acquireSuiteLock (F-239)", () => {
  let dir: string;
  const holder = { suite: "benchmarks/tasks", adapter: "chikory" };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "chikory-suite-lock-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const lockPath = (): string => join(dir, SUITE_LOCK_FILE);

  it("claims the results root and records who holds it", () => {
    const release = acquireSuiteLock(dir, holder);
    const held = readLock(lockPath());
    expect(held).toMatchObject({ pid: process.pid, suite: "benchmarks/tasks", adapter: "chikory" });
    release();
    expect(existsSync(lockPath())).toBe(false);
  });

  it("refuses a second suite while the first is LIVE", () => {
    const release = acquireSuiteLock(dir, holder);
    try {
      expect(() => acquireSuiteLock(dir, { suite: "other", adapter: "command" })).toThrow(
        SuiteAlreadyRunningError,
      );
    } finally {
      release();
    }
  });

  it("names the live holder so the operator can find it", () => {
    const release = acquireSuiteLock(dir, holder);
    try {
      acquireSuiteLock(dir, { suite: "other", adapter: "command" });
      expect.unreachable("the second acquire must throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SuiteAlreadyRunningError);
      expect((err as Error).message).toContain(`pid ${process.pid}`);
      expect((err as Error).message).toContain("benchmarks/tasks");
    } finally {
      release();
    }
  });

  it("reclaims a lock whose owner is DEAD — a killed suite must not wedge the root", () => {
    // pid 2^31-1 is beyond the pid_max of any platform this runs on, so it can
    // never name a live process.
    writeFileSync(
      lockPath(),
      JSON.stringify({ pid: 2147483647, startedAt: "2026-01-01T00:00:00Z", suite: "dead", adapter: "chikory" }),
    );
    const release = acquireSuiteLock(dir, holder);
    expect(readLock(lockPath())?.pid).toBe(process.pid);
    release();
  });

  it("reclaims a CORRUPT lock — a half-written one is not worth deferring to", () => {
    writeFileSync(lockPath(), "{ this is not json");
    const release = acquireSuiteLock(dir, holder);
    expect(readLock(lockPath())?.pid).toBe(process.pid);
    release();
  });

  it("releases on the way out even when the suite threw", () => {
    const release = acquireSuiteLock(dir, holder);
    try {
      throw new Error("suite blew up");
    } catch {
      release();
    }
    // The root is immediately claimable again.
    acquireSuiteLock(dir, holder)();
  });

  it("locks are per results root, so two arms can hold their own", () => {
    const other = mkdtempSync(join(tmpdir(), "chikory-suite-lock-b-"));
    try {
      const a = acquireSuiteLock(dir, holder);
      const b = acquireSuiteLock(other, { suite: "s", adapter: "command" });
      a();
      b();
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("creates the results root when it does not exist yet", () => {
    const fresh = join(dir, "p3-rung-4", "chikory");
    acquireSuiteLock(fresh, holder)();
    expect(existsSync(fresh)).toBe(true);
  });

  it("writes a lock a human can read", () => {
    const release = acquireSuiteLock(dir, holder);
    expect(readFileSync(lockPath(), "utf8")).toContain('"suite": "benchmarks/tasks"');
    release();
  });
});
