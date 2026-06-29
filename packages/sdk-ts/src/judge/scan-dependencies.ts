const FROM_SOURCE_PATTERN = /\bfrom\s*["']([^"']+)["']/g;
const SIDE_EFFECT_IMPORT_PATTERN = /\bimport\s*["']([^"']+)["']/g;
const REQUIRE_PATTERN = /\brequire\(\s*["']([^"']+)["']\s*\)/g;

function getAddedDiffLines(diff: string): string[] {
  return diff.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++"));
}

function normalizeExternalPackageName(specifier: string): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("node:")) {
    return null;
  }

  const segments = specifier.split("/");
  if (specifier.startsWith("@")) {
    return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : specifier;
  }

  return segments[0] ?? specifier;
}

function extractSpecifiers(line: string): string[] {
  return [FROM_SOURCE_PATTERN, SIDE_EFFECT_IMPORT_PATTERN, REQUIRE_PATTERN].flatMap((pattern) =>
    [...line.matchAll(pattern)].map((match) => match[1]),
  );
}

/**
 * WP-215 security/architecture rubric dependency-scan judge evidence primitive.
 * Scans only added unified-diff lines, excluding +++ file headers.
 */
export function scanDiffForNewDependencies(diff: string): string[] {
  const packageNames = new Set<string>();

  for (const line of getAddedDiffLines(diff)) {
    for (const specifier of extractSpecifiers(line)) {
      const packageName = normalizeExternalPackageName(specifier);
      if (packageName !== null) {
        packageNames.add(packageName);
      }
    }
  }

  return [...packageNames].sort();
}
