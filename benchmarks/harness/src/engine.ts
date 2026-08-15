import { readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import type { BenchmarkTask } from "./task.js";

export type NodeEngineConstraint = number | "no constraint";

export interface NodeToolchain {
  version: string;
  binDir: string;
}

export type ProvisioningDecision =
  | { type: "ambient" }
  | { type: "provision"; binDir: string }
  | { type: "unavailable"; neededVersion: number | string; available: string[]; error?: string };

export type LoadEngineSourceResult =
  | { type: "success"; content: string }
  | { type: "error"; error: string };

interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

function parseVersion(v: string): SemVer | null {
  const clean = v.trim().replace(/^v/, "");
  const match = clean.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: match[2] ? parseInt(match[2], 10) : 0,
    patch: match[3] ? parseInt(match[3], 10) : 0,
  };
}

function compareVersions(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/** One comparator inside a range — `>=24`, `<26`, `^24.1.0`, `24.x`, `*`. */
type RangeAtom = (v: SemVer) => boolean;

/**
 * Parse a single comparator. Returns null when the atom is not a form we model,
 * which is how the caller distinguishes "unparseable range" from "not satisfied".
 *
 * F-187: comparators may be joined by whitespace (AND) as well as `||` (OR), and
 * `>`/`<`/`<=`/`~` are as common in the wild as `>=`. Treating an AND-range as
 * unparseable silently resolved it to the ambient toolchain — a wrong-node run
 * that grades red indistinguishably from agent failure.
 */
function parseAtom(atom: string): RangeAtom | null {
  if (atom === "*" || atom === "x" || atom === "X") return () => true;

  const m = atom.match(/^(>=|<=|>|<|=|\^|~)?v?(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/);
  if (!m) return null;

  const [, op, majorRaw, minorRaw, patchRaw] = m;
  const major = parseInt(majorRaw, 10);
  const minorWild = minorRaw === undefined || /^[xX*]$/.test(minorRaw);
  const patchWild = patchRaw === undefined || /^[xX*]$/.test(patchRaw);
  const bound: SemVer = {
    major,
    minor: minorWild ? 0 : parseInt(minorRaw, 10),
    patch: patchWild ? 0 : parseInt(patchRaw, 10),
  };

  switch (op) {
    case ">=":
      return v => compareVersions(v, bound) >= 0;
    case ">":
      return v => compareVersions(v, bound) > 0;
    case "<=":
      return v => compareVersions(v, bound) <= 0;
    case "<":
      return v => compareVersions(v, bound) < 0;
    case "^":
      // ^24.1.0 → >=24.1.0 <25.0.0
      return v => v.major === major && compareVersions(v, bound) >= 0;
    case "~":
      // ~24.1 → >=24.1.0 <24.2.0 (or >=24.0.0 <25.0.0 when only a major is given)
      return v =>
        v.major === major &&
        (minorWild || v.minor === bound.minor) &&
        compareVersions(v, bound) >= 0;
    default:
      // Bare/`=` form. A partial version is a range over what it omits
      // (`24` → any 24.x, `24.1` → any 24.1.x); a full pin is an exact match.
      if (minorWild) return v => v.major === major;
      if (patchWild) return v => v.major === major && v.minor === bound.minor;
      return v => compareVersions(v, bound) === 0;
  }
}

/** OR-groups of AND-ed comparators. `null` = nothing in the range parsed. */
function parseRange(rangeStr: string): RangeAtom[][] | null {
  const groups = rangeStr
    // `>= 24` / `^ 24` — detach the operator from its operand before AND-splitting.
    .replace(/(>=|<=|>|<|=|\^|~)\s+/g, "$1")
    .split("||")
    .map(part => part.trim().split(/\s+/).filter(Boolean));

  const parsed: RangeAtom[][] = [];
  for (const group of groups) {
    const atoms = group.map(parseAtom);
    // An AND-group with any unmodelled comparator cannot be evaluated soundly:
    // drop the whole group rather than satisfy it on its parseable half.
    if (group.length === 0 || atoms.some(a => a === null)) continue;
    parsed.push(atoms as RangeAtom[]);
  }
  return parsed.length > 0 ? parsed : null;
}

/** True when `versionStr` satisfies every comparator of at least one OR-group. */
export function satisfiesRange(versionStr: string, rangeStr: string): boolean {
  const version = parseVersion(versionStr);
  if (!version) return false;
  const groups = parseRange(rangeStr);
  if (!groups) return false;
  return groups.some(atoms => atoms.every(atom => atom(version)));
}

/**
 * F-254 (WP-586): resolve an EXACT pinned Node version, ignoring the repo's own
 * `engines` range.
 *
 * `decideTargetNode` answers "what does this repo say it needs?" — the right
 * question for an unpinned task, the wrong one for a reproducible benchmark.
 * A range like `">=24"` silently resolves to whatever the newest local
 * toolchain is: `brownfield-002` at ref `a061eaa1` is 1128/1128 green on Node
 * 24.14.1 and SIGABRTs vitest 4.1.9 before a single test on 24.15.0. A scored
 * task must name the runtime it was scored on.
 *
 * No ambient shortcut: even when the running Node matches, the pinned toolchain
 * is put on PATH explicitly, so the graded runtime is the one on the record.
 */
export function pinnedNodeProvisioning(
  version: string,
  availableToolchains: NodeToolchain[],
): ProvisioningDecision {
  const match = availableToolchains.find((t) => t.version === version);
  if (match) return { type: "provision", binDir: match.binDir };
  return {
    type: "unavailable",
    neededVersion: version,
    available: availableToolchains.map((t) => t.version),
    error: `task pins node ${version} (node_version) and no such toolchain is installed`,
  };
}

export function decideTargetNode(
  packageJson: string | Record<string, unknown> | null | undefined,
  availableToolchains: NodeToolchain[],
  ambientVersion: string,
): ProvisioningDecision {
  if (!packageJson) {
    return { type: "ambient" };
  }
  let obj: Record<string, unknown>;
  if (typeof packageJson === "string") {
    try {
      obj = JSON.parse(packageJson);
    } catch {
      return { type: "ambient" };
    }
  } else {
    obj = packageJson;
  }

  if (!obj || typeof obj !== "object") {
    return { type: "ambient" };
  }
  const engines = obj.engines;
  if (!engines || typeof engines !== "object" || !(engines as Record<string, unknown>).node || typeof (engines as Record<string, unknown>).node !== "string") {
    return { type: "ambient" };
  }

  const constraint = ((engines as Record<string, unknown>).node as string).trim();
  if (!constraint) {
    return { type: "ambient" };
  }

  // Check if ambient satisfies the constraint
  if (satisfiesRange(ambientVersion, constraint)) {
    return { type: "ambient" };
  }

  // If ambient doesn't satisfy, find a satisfying toolchain from availableToolchains.
  const satisfyingToolchains = availableToolchains
    .filter(t => satisfiesRange(t.version, constraint))
    .sort((a, b) => {
      const av = parseVersion(a.version);
      const bv = parseVersion(b.version);
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      return compareVersions(bv, av); // newest first
    });

  if (satisfyingToolchains.length > 0) {
    return { type: "provision", binDir: satisfyingToolchains[0].binDir };
  }

  // A range we cannot model at all is treated as no constraint — never a throw,
  // never a skip. Parsed-but-unsatisfiable is the `unavailable` case below.
  if (parseRange(constraint) === null) {
    return { type: "ambient" };
  }

  return {
    type: "unavailable",
    neededVersion: constraint,
    available: availableToolchains.map(t => t.version),
  };
}

export function loadTargetEngineSource(task: BenchmarkTask, workspaceDir: string): LoadEngineSourceResult {
  const pkgPath = join(workspaceDir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const content = readFileSync(pkgPath, "utf8");
      return { type: "success", content };
    } catch (err) {
      return { type: "error", error: (err as Error).message };
    }
  }

  if (task.repo) {
    const tempDir = join(tmpdir(), `temp-git-${task.id}-${Date.now()}`);
    try {
      // First try quick clone of just package.json via filter
      execFileSync("git", ["clone", "--depth", "1", "--no-checkout", "--filter=blob:none", task.repo.url, tempDir], {
        stdio: "ignore",
        timeout: 15000,
      });
      execFileSync("git", ["-C", tempDir, "fetch", "--depth", "1", "origin", task.repo.ref], {
        stdio: "ignore",
        timeout: 15000,
      });
      // F-188: a target that simply HAS no package.json (a Python/Go/Rust repo)
      // declares no engine constraint — that is not a read failure and must not
      // shrink the corpus. Only a repo we could not READ degrades to a skip, so
      // ask the tree before treating a failed checkout as an error.
      const listed = execFileSync("git", [
        "-C",
        tempDir,
        "ls-tree",
        "--name-only",
        "FETCH_HEAD",
        "package.json"
      ], { encoding: "utf8", timeout: 15000 }).trim();
      if (!listed) {
        return { type: "success", content: "{}" };
      }
      execFileSync("git", ["-C", tempDir, "checkout", "FETCH_HEAD", "--", "package.json"], {
        stdio: "ignore",
        timeout: 15000,
      });
      const content = readFileSync(join(tempDir, "package.json"), "utf8");
      return { type: "success", content };
    } catch (err) {
      return { type: "error", error: (err as Error).message };
    } finally {
      try {
        if (existsSync(tempDir)) {
          rmSync(tempDir, { recursive: true, force: true });
        }
      } catch {
        // ignore rm error
      }
    }
  }

  return { type: "success", content: "{}" };
}

/**
 * Pure function to resolve the required node MAJOR version from package.json contents.
 * Kept for compatibility.
 */
export function resolveTargetNodeEngine(packageJson: string | Record<string, unknown>): NodeEngineConstraint {
  try {
    const obj = typeof packageJson === "string" ? JSON.parse(packageJson) : packageJson;
    if (!obj || typeof obj !== "object") {
      return "no constraint";
    }
    const engines = (obj as Record<string, unknown>).engines;
    if (!engines || typeof engines !== "object" || !(engines as Record<string, unknown>).node || typeof (engines as Record<string, unknown>).node !== "string") {
      return "no constraint";
    }

    const constraint = ((engines as Record<string, unknown>).node as string).trim();
    if (!constraint) {
      return "no constraint";
    }

    // Handle "||" e.g. "22 || 24"
    if (constraint.includes("||")) {
      const parts = constraint
        .split("||")
        .map((p: string) => {
          const subObj = { engines: { node: p.trim() } };
          return resolveTargetNodeEngine(subObj);
        })
        .filter((val: NodeEngineConstraint): val is number => typeof val === "number");
      
      if (parts.length > 0) {
        return Math.min(...parts);
      }
      return "no constraint";
    }

    // Match >=24, >=24.0.0
    const gteMatch = constraint.match(/^>=\s*(\d+)/);
    if (gteMatch) {
      return parseInt(gteMatch[1], 10);
    }

    // Match ^24.1.0
    const caretMatch = constraint.match(/^\^\s*(\d+)/);
    if (caretMatch) {
      return parseInt(caretMatch[1], 10);
    }

    // Match 24.x or 24.x.x
    const xMatch = constraint.match(/^(\d+)\.[xX]/);
    if (xMatch) {
      return parseInt(xMatch[1], 10);
    }

    // Match bare major like "24" or full version like "24.1.0"
    const bareMatch = constraint.match(/^v?(\d+)/);
    if (bareMatch) {
      return parseInt(bareMatch[1], 10);
    }

    return "no constraint";
  } catch {
    return "no constraint";
  }
}

/**
 * Pure function to plan Node provisioning based on requirements and available toolchains.
 * Kept for compatibility.
 */
export function planNodeProvisioning(
  requiredMajor: NodeEngineConstraint,
  availableToolchains: NodeToolchain[],
  ambientVersion: string,
): ProvisioningDecision {
  if (requiredMajor === "no constraint") {
    return { type: "ambient" };
  }

  // Parse ambient major version
  const ambientMatch = ambientVersion.match(/^v?(\d+)/);
  const ambientMajor = ambientMatch ? parseInt(ambientMatch[1], 10) : null;

  if (ambientMajor === requiredMajor) {
    return { type: "ambient" };
  }

  // Find a matching toolchain
  const match = availableToolchains.find((t) => {
    const m = t.version.match(/^v?(\d+)/);
    return m ? parseInt(m[1], 10) === requiredMajor : false;
  });

  if (match) {
    return { type: "provision", binDir: match.binDir };
  }

  return {
    type: "unavailable",
    neededVersion: requiredMajor as number,
    available: availableToolchains.map((t) => t.version),
  };
}

/**
 * Discover available Node toolchains in /nix/store.
 */
export function discoverNodeToolchains(): NodeToolchain[] {
  const toolchains: NodeToolchain[] = [];
  const nixStore = "/nix/store";
  if (!existsSync(nixStore)) {
    return toolchains;
  }

  try {
    const entries = readdirSync(nixStore);
    for (const entry of entries) {
      if (entry.includes("corepack") || entry.includes("npm") || entry.includes("include")) {
        continue;
      }
      const match = entry.match(/^([a-z0-9]+)-nodejs-(?:slim-)?(\d+\.\d+\.\d+)$/);
      if (match) {
        const version = match[2];
        const binDir = join(nixStore, entry, "bin");
        if (existsSync(join(binDir, "node"))) {
          toolchains.push({ version, binDir });
        }
      }
    }
  } catch {
    // Ignore errors
  }

  return toolchains;
}

/**
 * Helper to retrieve package.json contents from local workspace or remote git repository.
 * Kept for compatibility.
 */
export function getTargetPackageJson(task: BenchmarkTask, workspaceDir: string): string | null {
  const pkgPath = join(workspaceDir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      return readFileSync(pkgPath, "utf8");
    } catch {
      return null;
    }
  }

  if (task.repo) {
    const tempDir = join(workspaceDir, "..", `temp-git-${task.id}-${Date.now()}`);
    try {
      // First try quick clone of just package.json via filter
      execFileSync("git", ["clone", "--depth", "1", "--no-checkout", "--filter=blob:none", task.repo.url, tempDir], {
        stdio: "ignore",
        timeout: 15000,
      });
      execFileSync("git", ["-C", tempDir, "fetch", "--depth", "1", "origin", task.repo.ref], {
        stdio: "ignore",
        timeout: 15000,
      });
      execFileSync("git", ["-C", tempDir, "checkout", "FETCH_HEAD", "--", "package.json"], {
        stdio: "ignore",
        timeout: 15000,
      });
      const content = readFileSync(join(tempDir, "package.json"), "utf8");
      return content;
    } catch {
      return null;
    } finally {
      try {
        if (existsSync(tempDir)) {
          rmSync(tempDir, { recursive: true, force: true });
        }
      } catch {
        // ignore rm error
      }
    }
  }

  return null;
}

