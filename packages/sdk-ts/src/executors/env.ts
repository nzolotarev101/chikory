/** Provider configuration that must not leak across executor family boundaries. */
export const PROVIDER_ENV_VARS: readonly string[] = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "OPENAI_COMPAT_BASE_URL",
  "OPENAI_COMPAT_API_KEY",
];

/**
 * Return a copy of an executor environment with provider variables removed,
 * except for the explicitly retained names.
 */
export function scrubExecutorEnv(
  base: Record<string, string | undefined>,
  keep: readonly string[],
): Record<string, string | undefined> {
  const scrubbed = { ...base };
  const retained = new Set(keep);

  for (const name of PROVIDER_ENV_VARS) {
    if (!retained.has(name)) {
      delete scrubbed[name];
    }
  }

  return scrubbed;
}
