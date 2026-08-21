import { posix } from "node:path";

const FROM_SOURCE_PATTERN = /\b(?:import|export)\b.*?\bfrom\s*["']([^"']+)["']/g;
const SIDE_EFFECT_IMPORT_PATTERN = /^\s*import\s*["']([^"']+)["']/g;
const REQUIRE_PATTERN = /\brequire\(\s*["']([^"']+)["']\s*\)/g;
const DYNAMIC_IMPORT_PATTERN = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

type Layer = {
  readonly label: string;
  readonly prefixes: readonly string[];
};

const LAYER_ORDER: readonly Layer[] = [
  { label: "core", prefixes: ["src/types.ts", "src/schemas.ts", "src/util/", "src/canonical-json.ts"] },
  { label: "providers", prefixes: ["src/providers/", "src/pricing.ts", "src/otel.ts"] },
  { label: "router", prefixes: ["src/router.ts"] },
  { label: "artifacts", prefixes: ["src/artifacts/"] },
  { label: "executors", prefixes: ["src/executors/"] },
  { label: "judge", prefixes: ["src/judge/"] },
  { label: "planner", prefixes: ["src/planner/"] },
  { label: "workflow", prefixes: ["src/workflow/"] },
  { label: "runner", prefixes: ["src/runner/", "src/runner.ts", "src/chain/"] },
  { label: "cli", prefixes: ["src/cli/"] },
];

function isAddedCodeLine(line: string): boolean {
  if (!line.startsWith("+") || line.startsWith("+++")) {
    return false;
  }

  const code = line.slice(1).trimStart();
  return !code.startsWith("//") && !code.startsWith("/*") && !code.startsWith("*");
}

function isPreImageCodeLine(line: string): boolean {
  if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("@@") || line.startsWith("diff ")) {
    return false;
  }
  if (!line.startsWith("-") && !line.startsWith(" ")) {
    return false;
  }

  const code = line.slice(1).trimStart();
  return !code.startsWith("//") && !code.startsWith("/*") && !code.startsWith("*");
}

function filePathFromDiffLine(line: string): string | null {
  const diffGitMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
  if (diffGitMatch !== null) {
    return normalizeProjectPath(diffGitMatch[2] ?? diffGitMatch[1] ?? "");
  }

  const newFileMatch = line.match(/^\+\+\+ (?:b\/)?(.+)$/);
  if (newFileMatch !== null && newFileMatch[1] !== "/dev/null") {
    return normalizeProjectPath(newFileMatch[1] ?? "");
  }

  const oldFileMatch = line.match(/^--- (?:a\/)?(.+)$/);
  if (oldFileMatch !== null && oldFileMatch[1] !== "/dev/null") {
    return normalizeProjectPath(oldFileMatch[1] ?? "");
  }

  return null;
}

function normalizeProjectPath(filePath: string): string {
  const withoutPrefix = filePath.replace(/^(?:a\/|b\/)/, "");
  const srcIndex = withoutPrefix.indexOf("src/");
  const projectPath = srcIndex >= 0 ? withoutPrefix.slice(srcIndex) : withoutPrefix;
  return projectPath.replace(/\.(?:c|m)?js$/, ".ts");
}

function layerIndexForPath(filePath: string): number | null {
  const normalizedPath = normalizeProjectPath(filePath);
  const index = LAYER_ORDER.findIndex((layer) =>
    layer.prefixes.some((prefix) => normalizedPath === prefix || normalizedPath.startsWith(prefix)),
  );

  return index >= 0 ? index : null;
}

function resolveImportPath(fromFilePath: string, specifier: string): string | null {
  if (specifier.startsWith(".")) {
    return normalizeProjectPath(posix.normalize(posix.join(posix.dirname(fromFilePath), specifier)));
  }

  if (specifier.startsWith("/")) {
    return normalizeProjectPath(specifier.slice(1));
  }

  if (specifier.startsWith("src/")) {
    return normalizeProjectPath(specifier);
  }

  return null;
}

function extractSpecifiers(line: string): string[] {
  const code = line.slice(1);
  return [FROM_SOURCE_PATTERN, SIDE_EFFECT_IMPORT_PATTERN, REQUIRE_PATTERN, DYNAMIC_IMPORT_PATTERN].flatMap((pattern) =>
    [...code.matchAll(pattern)].map((match) => match[1]).filter((specifier): specifier is string => specifier !== undefined),
  );
}

interface FileEdges {
  /**
   * Resolved import PATHS carrying a forbidden edge, seen on the diff's
   * pre-image side (context ` ` and removed `-` lines) for this file.
   */
  readonly preImagePaths: Set<string>;
  /** Forbidden edges the diff ADDED for this file, keyed by resolved import path. */
  readonly addedByPath: Map<string, string>;
}

/**
 * Deterministic architecture-scan primitive for judge evidence.
 * Scans unified-diff code lines, maps internal imports to declared
 * source layers, and reports forbidden lower-layer-to-higher-layer edges
 * INTRODUCED by the diff (imports not already present in the file's pre-image).
 *
 * F-431 (dogfood-164 review): the exoneration is keyed on the resolved import
 * PATH, never on the layer-pair label. Seven files under `packages/sdk-ts/src`
 * already carry a forbidden edge (12 lines; `workflow/agent-loop.ts` alone has
 * 5). Keying on the label made every one of them a blind spot — a genuinely new
 * `workflow→runner` import three lines from the existing one lands inside the
 * same hunk, so the existing line arrives as CONTEXT and silently acquits the
 * new one. Measured on a real `git diff`: label-keyed returned `[]`, path-keyed
 * returns `["workflow→runner"]`. Same hole for a diff that removes one
 * forbidden import and adds a different one of the same pair.
 */
export function scanDiffForLayeringViolations(diff: string): string[] {
  const violations = new Set<string>();
  const fileEdges = new Map<string, FileEdges>();
  let currentFilePath: string | null = null;

  for (const line of diff.split("\n")) {
    currentFilePath = filePathFromDiffLine(line) ?? currentFilePath;

    if (currentFilePath === null) {
      continue;
    }

    const fromIndex = layerIndexForPath(currentFilePath);
    if (fromIndex === null) {
      continue;
    }

    let edges = fileEdges.get(currentFilePath);
    if (edges === undefined) {
      edges = { preImagePaths: new Set<string>(), addedByPath: new Map<string, string>() };
      fileEdges.set(currentFilePath, edges);
    }

    if (isPreImageCodeLine(line)) {
      for (const specifier of extractSpecifiers(line)) {
        const importPath = resolveImportPath(currentFilePath, specifier);
        if (importPath === null) {
          continue;
        }

        const toIndex = layerIndexForPath(importPath);
        if (toIndex !== null && toIndex > fromIndex) {
          edges.preImagePaths.add(importPath);
        }
      }
    } else if (isAddedCodeLine(line)) {
      for (const specifier of extractSpecifiers(line)) {
        const importPath = resolveImportPath(currentFilePath, specifier);
        if (importPath === null) {
          continue;
        }

        const toIndex = layerIndexForPath(importPath);
        if (toIndex !== null && toIndex > fromIndex) {
          edges.addedByPath.set(importPath, `${LAYER_ORDER[fromIndex]!.label}→${LAYER_ORDER[toIndex]!.label}`);
        }
      }
    }
  }

  for (const { preImagePaths, addedByPath } of fileEdges.values()) {
    for (const [importPath, edge] of addedByPath) {
      if (!preImagePaths.has(importPath)) {
        violations.add(edge);
      }
    }
  }

  return [...violations].sort();
}
