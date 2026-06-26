import { isExampleSecret } from "./secret-allowlist.js";

const AWS_ACCESS_KEY_PATTERN = /AKIA[0-9A-Z]{16}/;
const OPENAI_KEY_PATTERN = /sk-[A-Za-z0-9]{20,}/;

function getAddedDiffLines(diff: string): string[] {
  return diff.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++"));
}

/**
 * WP-215 security rubric / secret-scan judge evidence primitive.
 * Scans only added unified-diff lines, excluding +++ file headers.
 */
export function scanDiffForSecrets(diff: string): string[] {
  const labels = new Set<string>();

  for (const line of getAddedDiffLines(diff)) {
    if (AWS_ACCESS_KEY_PATTERN.test(line)) {
      labels.add("aws-access-key");
    }

    if (OPENAI_KEY_PATTERN.test(line)) {
      labels.add("openai-key");
    }
  }

  return [...labels].sort();
}

/**
 * WP-253 real-secret scan that excludes canonical example/dummy credentials
 * while preserving the WP-215 evidence scan above.
 */
export function scanDiffForRealSecrets(diff: string): string[] {
  const labels = new Set<string>();

  for (const line of getAddedDiffLines(diff)) {
    const awsAccessKeyMatch = line.match(AWS_ACCESS_KEY_PATTERN);
    if (awsAccessKeyMatch !== null && !isExampleSecret(awsAccessKeyMatch[0])) {
      labels.add("aws-access-key");
    }

    const openAiKeyMatch = line.match(OPENAI_KEY_PATTERN);
    if (openAiKeyMatch !== null && !isExampleSecret(openAiKeyMatch[0])) {
      labels.add("openai-key");
    }
  }

  return [...labels].sort();
}
