const AWS_ACCESS_KEY_PATTERN = /AKIA[0-9A-Z]{16}/;
const OPENAI_KEY_PATTERN = /sk-[A-Za-z0-9]{20,}/;

/**
 * WP-215 security rubric / secret-scan judge evidence primitive.
 * Scans only added unified-diff lines, excluding +++ file headers.
 */
export function scanDiffForSecrets(diff: string): string[] {
  const labels = new Set<string>();

  for (const line of diff.split("\n")) {
    if (!line.startsWith("+") || line.startsWith("+++")) {
      continue;
    }

    if (AWS_ACCESS_KEY_PATTERN.test(line)) {
      labels.add("aws-access-key");
    }

    if (OPENAI_KEY_PATTERN.test(line)) {
      labels.add("openai-key");
    }
  }

  return [...labels].sort();
}
