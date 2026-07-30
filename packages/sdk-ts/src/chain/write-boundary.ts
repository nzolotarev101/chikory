/**
 * The chain write boundary, stated in ONE place for both sides of it (F-218).
 *
 * `write-set.ts` ENFORCES the boundary when a node seals; `executors/prompt.ts`
 * SHOWS it to the executor before the work. Until WP-545 only the first half
 * existed: `chainLink.writeSet` was read at exactly one line in the whole
 * runtime — the seal check — so dogfood-120's node `N-2` was told to "record
 * reproducible evidence", had `benchmarks/reports/p3-rung-4/brownfield-004.md`
 * in its declared set, could not see it, wrote
 * `docs/reports/brownfield-004-evidence.md`, and was discarded with a judge form
 * that marked every criterion and all six rubric items PASS.
 *
 * This module holds the four admission rules and the prompt text derived from
 * them, so the sentence the executor reads cannot drift from the check that
 * kills it. It deliberately imports NOTHING — no `node:path`, no types — because
 * the Temporal workflow bundle (`agent-loop.ts`) reaches it, and the workflow
 * sandbox has no node builtins.
 */

/**
 * The `ContextBundle.notes` key the boundary rides into the step prompt on
 * (CM-2: structured notes survive compaction verbatim, so the boundary cannot
 * decay out of context on a long node). Using `notes` keeps `ContextBundle`
 * unchanged — no frozen-contract edit for a prompt improvement.
 */
export const WRITE_BOUNDARY_NOTE = "chain.write_boundary";

/** Repo-relative POSIX dirname ("" for a top-level file). */
export function parentDirOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

/**
 * WP-510/F-89: a loose "prove it with a test" AC forces the executor to write
 * test files whose exact paths the planner's src-only writeSet cannot predict
 * (file layout is the executor's — F-82/F-83).
 */
export function isTestPath(path: string): boolean {
  const segments = path.split("/");
  if (segments.some((segment) => segment === "test" || segment === "tests")) return true;
  const base = segments[segments.length - 1] ?? "";
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(base);
}

/**
 * WP-510/F-89: a barrel (`index.ts`) is a re-export aggregator every loose node
 * that adds a primitive must append to, while the planner assigns that one file
 * to a single node's writeSet.
 */
export function isBarrelPath(path: string): boolean {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return /^index\.[cm]?[jt]sx?$/.test(base);
}

/**
 * The boundary as the executor must read it, before the work.
 *
 * Input is a plan node's declared `writeSet`, already normalized by
 * `serializeWriteConflicts` at plan time; this only de-duplicates and orders it
 * for a stable prompt. Returns "" for an empty set — the caller then omits the
 * note entirely rather than promising a boundary that is not enforced.
 */
export function renderWriteBoundary(writeSet: readonly string[]): string {
  const declared = [...new Set(writeSet)].sort();
  if (declared.length === 0) return "";
  const dirs = [...new Set(declared.map(parentDirOf).filter((dir) => dir.length > 0))].sort();
  return [
    "This node's plan declares the files it may write. When the node seals, ANY changed path " +
      "outside that boundary FAILS the whole node and throws its work away — a passing judge " +
      "verdict does not save it.",
    "Declared paths:",
    ...declared.map((path) => `  - ${path}`),
    "Also admitted: any file directly inside a declared directory " +
      `(${dirs.length > 0 ? dirs.join(", ") : "none"}), any test file (in a \`test\`/\`tests\` ` +
      "directory, or named `*.test.*` / `*.spec.*`), and a barrel `index.*`.",
    "Everything else is outside. The notes, evidence, provenance records and reports the goal " +
      "asks you to produce belong at a declared path — never at a path you invent elsewhere in " +
      "the repo. If the work genuinely needs a path no rule above admits, say so in your step " +
      "summary instead of writing it.",
  ].join("\n");
}
