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

function filePathFromDiffLine(line: string): string | null {
  const diffGitMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
  if (diffGitMatch !== null) {
    return normalizeProjectPath(diffGitMatch[2] ?? diffGitMatch[1] ?? "");
  }

  const newFileMatch = line.match(/^\+\+\+ (?:b\/)?(.+)$/);
  if (newFileMatch !== null && newFileMatch[1] !== "/dev/null") {
    return normalizeProjectPath(newFileMatch[1] ?? "");
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

/**
 * Deterministic architecture-scan primitive for judge evidence.
 * Scans only added unified-diff code lines, maps internal imports to declared
 * source layers, and reports forbidden lower-layer-to-higher-layer edges.
 */
export function scanDiffForLayeringViolations(diff: string): string[] {
  const violations = new Set<string>();
  let currentFilePath: string | null = null;

  for (const line of diff.split("\n")) {
    currentFilePath = filePathFromDiffLine(line) ?? currentFilePath;

    if (currentFilePath === null || !isAddedCodeLine(line)) {
      continue;
    }

    const fromIndex = layerIndexForPath(currentFilePath);
    if (fromIndex === null) {
      continue;
    }

    for (const specifier of extractSpecifiers(line)) {
      const importPath = resolveImportPath(currentFilePath, specifier);
      if (importPath === null) {
        continue;
      }

      const toIndex = layerIndexForPath(importPath);
      if (toIndex !== null && toIndex > fromIndex) {
        violations.add(`${LAYER_ORDER[fromIndex]!.label}→${LAYER_ORDER[toIndex]!.label}`);
      }
    }
  }

  return [...violations].sort();
}
