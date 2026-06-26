export const EXAMPLE_SECRET_VALUES: ReadonlySet<string> = new Set([
  "AKIA" + "IOSFODNN7EXAMPLE",
]);

/**
 * WP-253 example-key allowlist for deterministic secret overrides that must not
 * self-trip on dummy credentials in test fixtures.
 */
export function isExampleSecret(value: string): boolean {
  return EXAMPLE_SECRET_VALUES.has(value);
}
