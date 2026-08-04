/**
 * F-253 (WP-585) — the directive check, run against the REAL class files.
 *
 * The unit tests above use hand-built fixtures. This one asserts the verdict on
 * the files a launch actually passes, so the two cannot drift: the repo's own
 * `agent-classes.yaml` must be REFUSED for a benchmark arm (it lists Claude
 * fallbacks a wall could rotate onto), and the bench file must be ACCEPTED.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { checkBenchFamilyDirective, resolveBenchFamilies } from "../src/family-preflight.js";
import { pickClassRefs } from "../src/main.js";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const ENV = { OPENAI_COMPAT_BASE_URL: "http://127.0.0.1:8787" } as NodeJS.ProcessEnv;

function verdictFor(relPath: string) {
  const registry = parseYaml(readFileSync(join(REPO_ROOT, relPath), "utf8"));
  return {
    registry,
    violations: checkBenchFamilyDirective(resolveBenchFamilies({ agentClasses: registry }, ENV)),
  };
}

describe("real agent class files", () => {
  it("REFUSES the repo's own agent-classes.yaml for a bench arm (Claude fallbacks)", () => {
    const { violations } = verdictFor("agent-classes.yaml");
    expect(violations.map((v) => v.code)).toContain("class-member-anthropic");
  });

  it("ACCEPTS benchmarks/agent-classes.bench.yaml", () => {
    const { violations } = verdictFor("benchmarks/agent-classes.bench.yaml");
    expect(violations).toEqual([]);
  });

  it("the bench file resolves to exactly one executor class and one judge class", () => {
    const { registry } = verdictFor("benchmarks/agent-classes.bench.yaml");
    expect(pickClassRefs(registry)).toEqual({
      executor: "executor-bench",
      judge: "judge-bench",
    });
  });

  it("bench class ids differ from the shipped defaults, so a missed load fails loudly", () => {
    const { registry } = verdictFor("benchmarks/agent-classes.bench.yaml");
    const ids = Object.keys((registry as { classes: object }).classes);
    expect(ids).not.toContain("executor-default");
    expect(ids).not.toContain("judge-default");
  });
});
