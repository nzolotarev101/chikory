import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { clearStaleIndexLock } from "../executors/workspace.js";

const execFileAsync = promisify(execFile);

export interface GitDirtyEntry {
  path: string;
  status: string;
  hash?: string;
  content?: string;
}

export type WorkspaceDirtySnapshot =
  | string
  | Record<string, string | { status: string; hash?: string; content?: string }>
  | Map<string, string | { status: string; hash?: string; content?: string }>
  | GitDirtyEntry[];

export interface CheckSideEffectCleanupPlan {
  /** Relative file paths created by checks that must be deleted. */
  toDelete: string[];
  /** Relative file paths modified or deleted by checks that must be restored. */
  toRestore: string[];
}

export interface ParsedDirtyEntry {
  status: string;
  hash?: string;
  content?: string;
}

function isCreatedStatus(status: string): boolean {
  const s = status.trim();
  return s.includes("?") || s.includes("A") || s === "N";
}

export function parseDirtySnapshot(
  snapshot: WorkspaceDirtySnapshot,
): Map<string, ParsedDirtyEntry> {
  const map = new Map<string, ParsedDirtyEntry>();

  if (typeof snapshot === "string") {
    const lines = snapshot.split(/\r?\n/);
    for (const rawLine of lines) {
      if (!rawLine || rawLine.trim() === "") continue;
      let status: string;
      let path: string;
      let hash: string | undefined;

      if (rawLine.length >= 4 && rawLine[2] === " ") {
        status = rawLine.slice(0, 2);
        const rest = rawLine.slice(3).trim();
        const lastSpace = rest.lastIndexOf(" ");
        if (lastSpace !== -1 && rest.slice(lastSpace + 1).length === 64) {
          path = rest.slice(0, lastSpace).trim();
          hash = rest.slice(lastSpace + 1);
        } else {
          path = rest;
        }
      } else {
        const trimmed = rawLine.trim();
        const firstSpace = trimmed.indexOf(" ");
        if (firstSpace !== -1) {
          status = trimmed.slice(0, firstSpace);
          path = trimmed.slice(firstSpace + 1).trim();
        } else {
          status = "M";
          path = trimmed;
        }
      }

      if (path.startsWith('"') && path.endsWith('"')) {
        path = path.slice(1, -1);
      }

      if (path.includes(" -> ")) {
        path = path.split(" -> ")[1]!;
      }

      if (path) {
        map.set(path, { status, hash });
      }
    }
  } else if (snapshot instanceof Map) {
    for (const [path, val] of snapshot.entries()) {
      if (typeof val === "string") {
        map.set(path, { status: val });
      } else if (val && typeof val === "object") {
        map.set(path, { status: val.status, hash: val.hash, content: val.content });
      }
    }
  } else if (Array.isArray(snapshot)) {
    for (const entry of snapshot) {
      if (entry && entry.path) {
        map.set(entry.path, { status: entry.status, hash: entry.hash, content: entry.content });
      }
    }
  } else if (typeof snapshot === "object" && snapshot !== null) {
    for (const [path, val] of Object.entries(snapshot)) {
      if (typeof val === "string") {
        map.set(path, { status: val });
      } else if (val && typeof val === "object") {
        map.set(path, { status: val.status, hash: val.hash, content: val.content });
      }
    }
  }

  return map;
}

/**
 * Pure decision function that takes a BEFORE and an AFTER snapshot of the workspace's dirty-file
 * state (git porcelain view, optionally with content hashes) and returns the bounded, deterministic
 * cleanup plan.
 */
export function planCheckSideEffectCleanup(
  before: WorkspaceDirtySnapshot,
  after: WorkspaceDirtySnapshot,
): CheckSideEffectCleanupPlan {
  const beforeMap = parseDirtySnapshot(before);
  const afterMap = parseDirtySnapshot(after);

  const toDeleteSet = new Set<string>();
  const toRestoreSet = new Set<string>();

  const allPaths = new Set([...beforeMap.keys(), ...afterMap.keys()]);

  for (const path of allPaths) {
    const b = beforeMap.get(path);
    const a = afterMap.get(path);

    if (b && a) {
      if (b.status !== a.status || (b.hash && a.hash && b.hash !== a.hash)) {
        toRestoreSet.add(path);
      }
      // If status and content hash are identical, executor dirtied it and check left it untouched -> yield NOTHING
    } else if (!b && a) {
      if (isCreatedStatus(a.status)) {
        toDeleteSet.add(path);
      } else {
        toRestoreSet.add(path);
      }
    } else if (b && !a) {
      toRestoreSet.add(path);
    }
  }

  return {
    toDelete: Array.from(toDeleteSet).sort(),
    toRestore: Array.from(toRestoreSet).sort(),
  };
}

async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", dir, ...args], {
    maxBuffer: 256 * 1024 * 1024,
  });
  return stdout;
}

export async function snapshotWorkspace(dir: string): Promise<Map<string, GitDirtyEntry>> {
  await clearStaleIndexLock(dir);
  const statusOutput = await git(dir, ["status", "--porcelain"]);
  const basicMap = parseDirtySnapshot(statusOutput);
  const snapshotMap = new Map<string, GitDirtyEntry>();

  for (const [relPath, entry] of basicMap.entries()) {
    const fullPath = join(dir, relPath);
    let hash: string | undefined;
    let content: string | undefined;
    try {
      const fileBuffer = await readFile(fullPath);
      hash = createHash("sha256").update(fileBuffer).digest("hex");
      content = fileBuffer.toString("utf8");
    } catch {
      // File may have been deleted or be unreadable
    }
    snapshotMap.set(relPath, { path: relPath, status: entry.status, hash, content });
  }

  return snapshotMap;
}

export async function applyCleanupPlan(
  dir: string,
  plan: CheckSideEffectCleanupPlan,
  beforeSnapshot?: WorkspaceDirtySnapshot,
): Promise<void> {
  const beforeMap = beforeSnapshot ? parseDirtySnapshot(beforeSnapshot) : undefined;

  for (const relPath of plan.toDelete) {
    const fullPath = join(dir, relPath);
    await rm(fullPath, { recursive: true, force: true });
  }

  for (const relPath of plan.toRestore) {
    const b = beforeMap?.get(relPath);
    if (b && b.content !== undefined) {
      const fullPath = join(dir, relPath);
      await writeFile(fullPath, b.content);
    } else {
      try {
        await git(dir, ["checkout", "HEAD", "--", relPath]);
      } catch {
        try {
          await git(dir, ["checkout", "--", relPath]);
        } catch {
          // Ignored if checkout fails
        }
      }
    }
  }
}
