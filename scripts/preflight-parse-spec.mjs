#!/usr/bin/env node
/**
 * F-435 (dogfood-164 review) — run the REAL `parseTaskSpec` at $0, in preflight.
 *
 * The launcher's other guards read the spec with awk/grep. That is fine for the
 * routed-provider KEY contract (step 1c-ter, F-179), which is a short fixed list —
 * but it cannot reimplement the zod schema, so the most basic way a spec is broken
 * was never checked before spending. dogfood-165 was written with `escalation:` at
 * the root and no `judge:` block, passed `CHIKORY_PREFLIGHT_ONLY=1` green, and died
 * in `chikory run` AFTER the SDK rebuild, an ephemeral Temporal server and the
 * cli-judge-proxy were all up:
 *
 *     chikory: Invalid task spec:
 *       - judge: Required
 *       - (root): Unrecognized key(s) in object: 'escalation'
 *
 * Same refusal, same messages, now at $0. This subsumes the schema half of what
 * 1c-ter approximates; 1c-ter still owns the API-key half because its message names
 * the CLI-OAuth alternative.
 *
 * Two things this deliberately neutralises so it reports only real spec defects:
 *   - OPENAI_COMPAT_BASE_URL: THIS launcher exports it at step 4, after preflight.
 *     `parseTaskSpec` would otherwise refuse every keyless-judge spec we write.
 *   - a missing `dist/`: the preflight runs BEFORE the rebuild by design, so a cold
 *     tree has nothing to import. Warn and skip rather than fail — same convention
 *     as the WP-257 literal lint, which step 2b re-runs authoritatively post-build.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const specPath = process.argv[2];

if (specPath === undefined || specPath === "") {
  console.error("usage: preflight-parse-spec.mjs <spec.yaml>");
  process.exit(2);
}

const dist = join(repoRoot, "packages/sdk-ts/dist/index.js");
if (!existsSync(dist)) {
  console.log("ℹ️  spec schema: SKIPPED — packages/sdk-ts/dist not built yet (step 2 rebuilds it).");
  process.exit(0);
}

// The launcher owns this one (step 4). Without it every keyless-judge spec would
// read as "routed but not configured" — an artifact of preflight ordering, not a defect.
process.env.OPENAI_COMPAT_BASE_URL ??= "http://127.0.0.1:8787/v1";

let parseTaskSpec;
try {
  ({ parseTaskSpec } = await import(pathToFileURL(dist).href));
} catch (err) {
  console.log(`ℹ️  spec schema: SKIPPED — could not load the built SDK (${err?.message ?? err}).`);
  process.exit(0);
}

let spec;
try {
  spec = parseTaskSpec(readFileSync(specPath, "utf8"));
} catch (err) {
  console.error("⛔ REFUSING LAUNCH (F-435): the spec does not parse. `chikory run` would refuse");
  console.error("   it too — this stops it at $0, before the rebuild, Temporal and the proxy.");
  console.error("");
  console.error(String(err?.message ?? err));
  process.exit(4);
}

console.log(
  `🟢 spec schema: parses — executor ${spec.executor.adapter}(${spec.executor.family}) · ` +
    `judge ${spec.judge.family} cadence ${spec.judge.cadence} · ` +
    `unattended ${spec.unattended?.escalation ?? "await_approval (default)"}`,
);
