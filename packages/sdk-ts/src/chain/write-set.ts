import { posix } from "node:path";

import type { Plan, PlanNode } from "../types.js";
// F-218: the four admission rules live in `write-boundary.ts`, which the
// executor prompt also reads, so the boundary the executor is SHOWN and the
// boundary that KILLS it are one definition. That module imports nothing —
// `agent-loop.ts` reaches it, and the workflow sandbox has no node builtins.
import { isBarrelPath, isTestPath, parentDirOf } from "./write-boundary.js";

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
 * Actual node output must stay inside the planner-declared write boundary.
 *
 * WP-510/F-89: exact-path writeSet enforcement is fundamentally incompatible with
 * a LOOSE chain, which delegates file LAYOUT to the executor (F-82/F-83). Three
 * ways it false-FAILS a correct, judge-PROCEEDed delivery, all seen on
 * dogfood-078/079:
 *   1. the AC forces test files the src-only writeSet can't name;
 *   2. the executor creates its own filename (`src/memory/tiered-memory.ts`) where
 *      the planner guessed `src/memory/core.ts`;
 *   3. a downstream node must MODIFY the file an upstream node created under that
 *      executor-chosen name;
 *   4. every node adds its export to the shared package barrel (`src/index.ts`),
 *      which the planner assigns to only one node's writeSet.
 * So the runtime boundary is DIRECTORY-SCOPED: a changed path is admitted when it
 * (a) matches a declared path exactly, (b) is a test artifact, (c) is a barrel
 * `index.*`, or (d) sits in a directory a declared entry already owns — added or
 * modified. A write to a directory NO declared entry owns (e.g. an out-of-scope
 * `src/runner/…` edit) is still FAILED, and planning-time conflict serialization
 * (`serializeWriteConflicts`) is unchanged. For the linear LOOSE chains this
 * targets there are no parallel writers, so directory scope loses no real
 * conflict-safety; the judge remains the semantic backstop.
 */
export function undeclaredWritePaths(node: PlanNode, changedPaths: string[]): string[] {
  const declared = (node.writeSet ?? []).map(normalizeWritePath);
  const declaredSet = new Set(declared);
  const declaredDirs = new Set(declared.map(parentDirOf).filter((dir) => dir.length > 0));
  return changedPaths
    .map(normalizeWritePath)
    .filter(
      (path) =>
        !declaredSet.has(path) &&
        !isTestPath(path) &&
        !isBarrelPath(path) &&
        !declaredDirs.has(parentDirOf(path)),
    );
}

/**
 * Directories the toolchain owns. A gitignored path under one of these is the
 * output of a build, install or cache step rather than the node's own work.
 *
 * F-401 (dogfood-158): the first cut of this exemption listed `node_modules`
 * alone, which is only the family the acceptance checks happened to drive. A
 * real dogfood workspace also carries `packages/sdk-ts/dist` (604 files),
 * `.venv` (1,906), `benchmarks/harness/dist` (64) and `.devbox` (31) — measured
 * in `.chikory/runs/run-f3d47cf8-6d56-4c7b-85d1-fcfe185badef/workspace` — none
 * of which appear in any writeSet. A boundary that fails every node that built
 * the package or touched the Python venv is worse than the hole it closes.
 *
 * Deliberately NOT here: `benchmarks/results` and `benchmarks/runs`, the
 * families dogfood-123 escaped 2.1 GiB into. Those are run output, not
 * toolchain output, and stay inside the boundary.
 */
const TOOLCHAIN_PATH_SEGMENTS: ReadonlySet<string> = new Set([
  // JS/TS dependency install + build output
  "node_modules",
  ".pnp",
  "dist",
  "build",
  // Python virtualenvs, bytecode and caches
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  "htmlcov",
  // toolchain / runtime scratch
  ".devbox",
  ".temporal",
  ".chikory",
  // test + coverage output
  "coverage",
  "test-results",
]);

/** File suffixes the toolchain writes anywhere in the tree. */
const TOOLCHAIN_FILE_SUFFIXES: readonly string[] = [
  ".tsbuildinfo",
  ".js.map",
  ".d.ts.map",
  ".pyc",
  ".pyo",
];

/**
 * Dependency-install, build and cache artifacts are toolchain output rather
 * than the node's own work, and are exempt from write boundary failure when
 * git ignores them unless explicitly declared.
 *
 * Matching is per path SEGMENT, never substring: `src/node_modules.ts` and
 * `src/not_node_modules/file.ts` are the node's own work.
 */
export function isToolchainPath(path: string): boolean {
  const segments = path.split("/");
  if (segments.some((segment) => TOOLCHAIN_PATH_SEGMENTS.has(segment))) return true;
  const file = segments[segments.length - 1] ?? "";
  return TOOLCHAIN_FILE_SUFFIXES.some((suffix) => file.endsWith(suffix));
}

/**
 * Format a list of undeclared paths for failure reason reporting, bounding
 * the output so thousands of files in an ignored directory do not produce
 * a multi-kilobyte reason string while still naming offending paths/directories.
 */
export function formatUndeclaredPaths(
  paths: readonly string[],
  maxListed = 10,
  maxChars = 1_500,
): string {
  if (paths.length === 0) return "";
  const listed: string[] = [];
  let currentLen = 0;
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i]!;
    if (
      listed.length >= maxListed ||
      currentLen + p.length + (listed.length > 0 ? 2 : 0) > maxChars
    ) {
      const remaining = paths.length - i;
      return `${listed.join(", ")}, ... (+${remaining} more)`;
    }
    listed.push(p);
    currentLen += p.length + (listed.length > 1 ? 2 : 0);
  }
  return listed.join(", ");
}

