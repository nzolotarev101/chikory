/**
 * Types for the judge proxy shim (`scripts/cli-judge-proxy.mjs`), which is
 * plain JS run by node but whose pure helpers are unit-tested from here.
 * Declared locally rather than converted to TS: the file must stay directly
 * runnable as `node scripts/cli-judge-proxy.mjs` with no build step.
 */
declare module "*/cli-judge-proxy.mjs" {
  export function mapAgyModel(model: string): string;
  export function dispatchFor(model: string, fallbackBackend: string): string;
  export function retryAfterSeconds(message: string): number | undefined;
  export function splitCodexModel(model: string): { model: string; effort?: string };
  export const server: unknown;
}
