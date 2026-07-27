import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { BenchmarkTask } from "./task.js";

export type NodeEngineConstraint = number | "no constraint";

export interface NodeToolchain {
  version: string;
  binDir: string;
}

export type ProvisioningDecision =
  | { type: "ambient" }
  | { type: "provision"; binDir: string }
  | { type: "unavailable"; neededVersion: number; available: string[] };

/**
 * Pure function to resolve the required node MAJOR version from package.json contents.
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
    neededVersion: requiredMajor,
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
    try {
      // First try quick clone of just package.json via filter
      const tempDir = join(workspaceDir, "..", `temp-git-${task.id}-${Date.now()}`);
      execSync(`git clone --depth 1 --no-checkout --filter=blob:none ${JSON.stringify(task.repo.url)} ${JSON.stringify(tempDir)}`, {
        stdio: "ignore",
        timeout: 15000,
      });
      execSync(`git -C ${JSON.stringify(tempDir)} fetch --depth 1 origin ${JSON.stringify(task.repo.ref)}`, {
        stdio: "ignore",
        timeout: 15000,
      });
      execSync(`git -C ${JSON.stringify(tempDir)} checkout FETCH_HEAD -- package.json`, {
        stdio: "ignore",
        timeout: 15000,
      });
      const content = readFileSync(join(tempDir, "package.json"), "utf8");
      try {
        execSync(`rm -rf ${JSON.stringify(tempDir)}`, { stdio: "ignore" });
      } catch {
        // ignore rm error
      }
      return content;
    } catch {
      return null;
    }
  }

  return null;
}
