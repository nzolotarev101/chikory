import { posix } from "node:path";

import type { Plan, PlanNode } from "../types.js";

function normalizeWritePath(path: string): string {
  const normalized = posix.normalize(path.replaceAll("\\", "/"));
  if (
    path.length === 0 ||
    normalized === "." ||
    normalized.startsWith("/") ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new Error(`invalid plan write path: ${path}`);
  }
  return normalized;
}

function reaches(nodes: Map<string, PlanNode>, from: string, target: string): boolean {
  const seen = new Set<string>();
  const pending = [from];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dependency of nodes.get(id)?.dependsOn ?? []) pending.push(dependency);
  }
  return false;
}

function pathsConflict(left: string, right: string): boolean {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

/**
 * WP-242 conflict prevention: normalize exact path ownership and serialize
 * unordered writers in stable plan order before the plan meta-judge sees the
 * topology. Existing dependency order is never reversed.
 */
export function serializeWriteConflicts(
  plan: Plan,
  options: { requireWriteSets?: boolean } = {},
): Plan {
  const nodes = plan.nodes.map((node) => {
    if (options.requireWriteSets && (node.writeSet === undefined || node.writeSet.length === 0)) {
      throw new Error(`plan node ${node.id} must declare a non-empty writeSet`);
    }
    const writeSet = [...new Set((node.writeSet ?? []).map(normalizeWritePath))].sort();
    return { ...node, ...(node.writeSet !== undefined ? { writeSet } : {}) };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));

  for (let laterIndex = 1; laterIndex < nodes.length; laterIndex++) {
    const later = nodes[laterIndex]!;
    for (let earlierIndex = 0; earlierIndex < laterIndex; earlierIndex++) {
      const earlier = nodes[earlierIndex]!;
      const overlap =
        earlier.writeSet?.some((left) =>
          later.writeSet?.some((right) => pathsConflict(left, right)),
        ) ?? false;
      if (!overlap || reaches(byId, later.id, earlier.id) || reaches(byId, earlier.id, later.id)) {
        continue;
      }
      later.dependsOn = [...later.dependsOn, earlier.id];
    }
  }

  return { ...plan, nodes };
}

/**
 * WP-510/F-89: a loose "prove it with a test" AC forces the executor to write
 * test files whose exact paths the planner's src-only writeSet cannot predict
 * (file layout is the executor's — F-82/F-83). Admit the test tree at the
 * runtime boundary so a complete, all-green delivery is not false-FAILED. This
 * relaxes only the runtime check; planning-time conflict serialization
 * (`serializeWriteConflicts`) still runs on the declared writeSet unchanged.
 */
function isTestPath(path: string): boolean {
  const segments = path.split("/");
  if (segments.some((segment) => segment === "test" || segment === "tests")) return true;
  const base = segments[segments.length - 1] ?? "";
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(base);
}

/** Repo-relative POSIX dirname ("" for a top-level file). */
function parentDir(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

/**
 * Actual node output must stay inside the planner-declared write boundary.
 *
 * WP-510/F-89 (dogfood-079 extension): a LOOSE goal delegates file LAYOUT to the
 * executor (F-82/F-83), so the planner's exact-path writeSet routinely guesses a
 * filename the executor doesn't use (planner declared `src/memory/core.ts`, the
 * executor created `src/memory/tiered-memory.ts`). Admit a NEWLY-CREATED file
 * that shares a directory with a declared writeSet entry — the executor may name
 * its own new files inside the area the node already owns — while a MODIFIED
 * undeclared file (a rogue edit to an existing out-of-scope file) is still
 * FAILED. `addedPaths` = the git `--diff-filter=A` set; when empty (non-chain /
 * legacy callers) the gate keeps the exact-match + test-tree behaviour.
 */
export function undeclaredWritePaths(
  node: PlanNode,
  changedPaths: string[],
  addedPaths: Iterable<string> = [],
): string[] {
  const declared = (node.writeSet ?? []).map(normalizeWritePath);
  const declaredSet = new Set(declared);
  const declaredDirs = new Set(declared.map(parentDir).filter((dir) => dir.length > 0));
  const added = new Set([...addedPaths].map(normalizeWritePath));
  return changedPaths
    .map(normalizeWritePath)
    .filter(
      (path) =>
        !declaredSet.has(path) &&
        !isTestPath(path) &&
        !(added.has(path) && declaredDirs.has(parentDir(path))),
    );
}
