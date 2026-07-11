/**
 * WP-005: task.yaml parsing + the §9 validation rules, driven by the
 * fixtures in fixtures/taskspec/. Each validation rule has a failing fixture.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { TaskSpecSchema } from "../src/schemas.js";
import { DEFAULT_CADENCE, DEFAULT_MAX_STEPS, parseTaskSpec, TaskSpecValidationError } from "../src/taskspec.js";

const fixturesDir = join(__dirname, "..", "..", "..", "fixtures", "taskspec");
const read = (name: string) => readFileSync(join(fixturesDir, name), "utf8");

// Providers configured in the test environment; openai-compat deliberately absent.
const env = {
  ANTHROPIC_API_KEY: "test-key",
  OPENAI_API_KEY: "test-key",
  GEMINI_API_KEY: "test-key",
};

/** Expected error fragment per invalid fixture — one per §9 validation rule. */
const invalidExpectations: Record<string, string> = {
  "invalid-same-family.yaml": "must differ from executor.family",
  "invalid-zero-budget.yaml": "budget_usd",
  "invalid-no-repos.yaml": "repos",
  "invalid-no-writable-repo.yaml": "writable",
  "invalid-zero-cadence.yaml": "cadence",
  "invalid-empty-criteria.yaml": "acceptance_criteria",
  "invalid-duplicate-criterion-ids.yaml": "duplicate id 'AC-1'",
  "invalid-missing-provider-env.yaml": "missing env var OPENAI_COMPAT_BASE_URL",
  "invalid-unknown-key.yaml": "max_stepz",
};

describe("parseTaskSpec", () => {
  it("parses the full documented example and satisfies the frozen contract", () => {
    const spec = parseTaskSpec(read("valid-full.yaml"), { env });
    expect(TaskSpecSchema.safeParse(spec).success).toBe(true);
    expect(spec.name).toBe("memory-pointer-store");
    expect(spec.judge.family).toBe("gemini");
    expect(spec.judge.maxCostShare).toBe(0.25);
    expect(spec.maxSteps).toBe(60);
    expect(spec.routing.failover?.judge?.[0]).toEqual({ provider: "openai", model: "gpt-5.2" });
    expect(spec.acceptanceCriteria.map((c) => c.id)).toEqual(["AC-1", "AC-2", "AC-3"]);
  });

  it("parses the optional chain decomposition floor min_nodes (WP-509/F-88)", () => {
    expect(parseTaskSpec(read("valid-minimal.yaml"), { env }).minNodes).toBeUndefined();

    const withFloor = parseTaskSpec(`${read("valid-minimal.yaml")}\nmin_nodes: 4\n`, { env });
    expect(TaskSpecSchema.safeParse(withFloor).success).toBe(true);
    expect(withFloor.minNodes).toBe(4);
  });

  it("maps optional bounded work-unit chunks from YAML to camel-case policy input", () => {
    const spec = parseTaskSpec(
      `${read("valid-minimal.yaml")}
bounded_work_unit:
  min_durable_steps: 3
  directive: Continue one bounded increment.
  work_chunks:
    - name: parser
      directive: Implement only the parser increment.
    - name: cli
      directive: Wire only the CLI increment.
`,
      { env },
    );

    expect(TaskSpecSchema.safeParse(spec).success).toBe(true);
    expect(spec.boundedWorkUnit).toEqual({
      minDurableSteps: 3,
      directive: "Continue one bounded increment.",
      workChunks: [
        { name: "parser", directive: "Implement only the parser increment." },
        { name: "cli", directive: "Wire only the CLI increment." },
      ],
    });
  });

  it("maps optional unattended escalation policy from YAML to camel-case policy input", () => {
    const spec = parseTaskSpec(
      `${read("valid-minimal.yaml")}
unattended:
  escalation: seal_resumable_failed
`,
      { env },
    );

    expect(TaskSpecSchema.safeParse(spec).success).toBe(true);
    expect(spec.unattended).toEqual({ escalation: "seal_resumable_failed" });
  });

  it("maps optional soak policy from YAML to camel-case policy input", () => {
    const spec = parseTaskSpec(
      `${read("valid-minimal.yaml")}
soak:
  sleep_ms: 250
  max_reentries: 3
  max_total_sleep_ms: 1000
`,
      { env },
    );

    expect(TaskSpecSchema.safeParse(spec).success).toBe(true);
    expect(spec.soak).toEqual({ sleepMs: 250, maxReentries: 3, maxTotalSleepMs: 1000 });
  });

  it("applies defaults when optional fields are omitted (minimal spec)", () => {
    const spec = parseTaskSpec(read("valid-minimal.yaml"), { env });
    expect(TaskSpecSchema.safeParse(spec).success).toBe(true);
    expect(spec.judge.cadence).toBe(DEFAULT_CADENCE);
    expect(spec.judge.scoringMethod).toBe("pointwise");
    expect(spec.maxSteps).toBe(DEFAULT_MAX_STEPS);
    // routing falls back to defaultPolicy(executor.family) with the declared judge family
    expect(spec.routing.stages.code.provider).toBe("anthropic");
    expect(spec.routing.stages.judge.provider).toBe("gemini");
  });

  it("allows same-family judge only with explicit opt-in, and warns loudly", () => {
    const warn = vi.fn();
    const spec = parseTaskSpec(read("valid-same-family-optin.yaml"), { env, warn });
    expect(spec.judge.allowSameFamily).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/bias mitigation is reduced/i);
  });

  it("does not warn when families differ", () => {
    const warn = vi.fn();
    parseTaskSpec(read("valid-minimal.yaml"), { env, warn });
    expect(warn).not.toHaveBeenCalled();
  });

  it("rejects a same-family routed judge even when judge.family claims diversity", () => {
    const yaml = `name: routed-judge-same-family
goal: Catch paper-only family diversity.
repos:
  - url: .
    writable: true
acceptance_criteria:
  - id: AC-1
    description: Something checkable
budget_usd: 5
executor:
  adapter: codex
  family: openai
judge:
  family: gemini
routing:
  stages:
    plan: { provider: openai, model: gpt-5.2-mini }
    code: { provider: openai, model: gpt-5.2 }
    review: { provider: openai, model: gpt-5.2 }
    judge: { provider: openai, model: gpt-5.2 }
`;

    expect(() => parseTaskSpec(yaml, { env })).toThrow(TaskSpecValidationError);
    try {
      parseTaskSpec(yaml, { env });
    } catch (err) {
      expect((err as Error).message).toContain(
        "judge.family 'openai' must differ from executor.family 'openai'",
      );
    }
  });

  it("rejects a same-family judge when executor.family claims diversity but adapter capability is OpenAI", () => {
    const yaml = `name: executor-label-stale
goal: Catch stale executor family labels.
repos:
  - url: .
    writable: true
acceptance_criteria:
  - id: AC-1
    description: Something checkable
budget_usd: 5
executor:
  adapter: codex
  family: gemini
judge:
  family: openai
routing:
  stages:
    plan: { provider: gemini, model: gemini-2.5-flash }
    code: { provider: gemini, model: gemini-2.5-pro }
    review: { provider: gemini, model: gemini-2.5-pro }
    judge: { provider: openai, model: gpt-5.2 }
`;

    expect(() => parseTaskSpec(yaml, { env })).toThrow(TaskSpecValidationError);
    try {
      parseTaskSpec(yaml, { env });
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain("judge.family 'openai' must differ from executor.family 'openai'");
      expect(message).toContain("executor.adapter 'codex' must use executor.family 'openai'");
    }
  });

  it("rejects malformed YAML with a parse error", () => {
    expect(() => parseTaskSpec("{ not: [valid", { env })).toThrow(TaskSpecValidationError);
  });

  describe.each(Object.entries(invalidExpectations))("%s", (file, fragment) => {
    it(`fails validation mentioning '${fragment}'`, () => {
      expect(() => parseTaskSpec(read(file), { env })).toThrow(TaskSpecValidationError);
      try {
        parseTaskSpec(read(file), { env });
      } catch (err) {
        expect((err as Error).message).toContain(fragment);
      }
    });
  });

  it("covers every invalid fixture on disk", () => {
    const onDisk = readdirSync(fixturesDir).filter((f) => f.startsWith("invalid-"));
    expect(new Set(onDisk)).toEqual(new Set(Object.keys(invalidExpectations)));
  });
});
