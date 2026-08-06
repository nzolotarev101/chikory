import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_AGENT_CLASSES,
  classMembers,
  findMember,
  type AgentClassRegistry,
} from "../../src/agents/classes.js";
import {
  AgentClassValidationError,
  loadAgentClassRegistry,
  parseAgentClassRegistry,
  resolveAgentClass,
  singletonExecutorClass,
  singletonJudgeClass,
} from "../../src/agents/registry.js";
import { lookupPricing } from "../../src/pricing.js";
import { lookupContextWindow } from "../../src/runner/context-window.js";

/** Repo root, from packages/sdk-ts/test/agents. */
const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");

const VALID = `
version: 1
classes:
  exec-a:
    role: executor
    primary: { id: m-gemini, adapter: gemini-cli, family: gemini, backend: gemini, model: gemini-3.6-flash-high }
    adjacent:
      - { id: m-codex, adapter: codex, family: openai, backend: openai, model: gpt-5.6-terra }
  judge-a:
    role: judge
    primary: { id: m-sol, transport: openai-compat, backend: openai, model: gpt-5.6-sol xhigh }
`;

function issuesOf(text: string): string[] {
  try {
    parseAgentClassRegistry(text);
  } catch (err) {
    if (err instanceof AgentClassValidationError) return err.issues;
    throw err;
  }
  throw new Error("expected the registry to be rejected, but it parsed");
}

describe("agent class registry", () => {
  it("ships defaults that are themselves valid", () => {
    // An empty overlay leaves the defaults untouched, and the load path
    // validates whatever it returns — so this asserts the defaults themselves.
    expect(() =>
      loadAgentClassRegistry({ base: DEFAULT_AGENT_CLASSES, text: "version: 1\nclasses: {}" }),
    ).not.toThrow();
    expect(loadAgentClassRegistry({ base: DEFAULT_AGENT_CLASSES, text: "version: 1\nclasses: {}" }).classes)
      .toEqual(DEFAULT_AGENT_CLASSES.classes);
  });

  /**
   * F-253 (WP-585): a registry the caller NAMED and that cannot be read is an
   * error, never a silent fallback.
   *
   * The defaults are a complete registry, so falling back looks harmless — but
   * they carry a different member list (Claude fallbacks among them). A bench
   * arm that asks for `benchmarks/agent-classes.bench.yaml` and quietly gets the
   * defaults would rotate onto vendors nobody chose, and publish a number
   * measured on them. Only the UNNAMED default path may fall back.
   */
  it("refuses a named registry it cannot read, instead of substituting the defaults", () => {
    expect(() => loadAgentClassRegistry({ path: "/nonexistent/agent-classes.yaml" })).toThrow(
      /cannot read agent class registry/,
    );
  });

  it("honours CHIKORY_AGENT_CLASSES when no path is passed", () => {
    const previous = process.env.CHIKORY_AGENT_CLASSES;
    try {
      process.env.CHIKORY_AGENT_CLASSES = "/nonexistent/from-env.yaml";
      expect(() => loadAgentClassRegistry()).toThrow(/from-env\.yaml/);
    } finally {
      if (previous === undefined) delete process.env.CHIKORY_AGENT_CLASSES;
      else process.env.CHIKORY_AGENT_CLASSES = previous;
    }
  });

  it("every default member model resolves in BOTH the price and context-window tables", () => {
    // An unpriced member costs $0 while burning real capacity, which blinds the
    // CG-2 budget gate — the whole reason the loader checks this.
    const sentinel = -1;
    for (const agentClass of Object.values(DEFAULT_AGENT_CLASSES.classes)) {
      for (const member of classMembers(agentClass)) {
        expect(lookupPricing(member.model), `price row for ${member.model}`).toBeDefined();
        expect(
          lookupContextWindow(member.model, sentinel),
          `context window row for ${member.model}`,
        ).not.toBe(sentinel);
      }
    }
  });

  it("parses the repo's own agent-classes.yaml", () => {
    const text = readFileSync(join(REPO_ROOT, "agent-classes.yaml"), "utf8");
    const registry = parseAgentClassRegistry(text);

    const executors = resolveAgentClass(registry, "executor-default", "executor");
    const judges = resolveAgentClass(registry, "judge-default", "judge");

    // The standing arming directive: Gemini executes, Codex judges. A class does
    // not change the default — it only adds somewhere to go when it is walled.
    expect(executors.primary.id).toBe("gemini-3-6-flash");
    expect(executors.primary.backend).toBe("gemini");
    expect(judges.primary.backend).toBe("openai");
    expect(executors.adjacent.length).toBeGreaterThan(0);
    expect(judges.adjacent.length).toBeGreaterThan(0);
  });

  it("resolves member lookups by id", () => {
    const registry = parseAgentClassRegistry(VALID);
    const execClass = resolveAgentClass(registry, "exec-a", "executor");
    expect(findMember(execClass, "m-codex")?.model).toBe("gpt-5.6-terra");
    expect(findMember(execClass, "nope")).toBeUndefined();
  });

  it("REPLACES a same-named default class rather than merging members into it", () => {
    const registry = parseAgentClassRegistry(`
version: 1
classes:
  executor-default:
    role: executor
    primary: { id: only-codex, adapter: codex, family: openai, backend: openai, model: gpt-5.6-terra }
`);
    const executors = resolveAgentClass(registry, "executor-default", "executor");
    // Merging would silently leak the shipped gemini/sonnet members back into a
    // class the operator deliberately trimmed to one.
    expect(classMembers(executors).map((m) => m.id)).toEqual(["only-codex"]);
    // Untouched default classes survive.
    expect(registry.classes["judge-default"]).toBeDefined();
  });

  it("rejects a member id repeated inside one class", () => {
    const issues = issuesOf(`
version: 1
classes:
  exec-a:
    role: executor
    primary: { id: dup, adapter: gemini-cli, family: gemini, backend: gemini, model: gemini-3.6-flash-high }
    adjacent:
      - { id: dup, adapter: codex, family: openai, backend: openai, model: gpt-5.6-terra }
`);
    expect(issues.join("\n")).toMatch(/member id 'dup' appears twice/);
  });

  it("rejects a member id reused across classes with a different endpoint (cooldowns are keyed by member id)", () => {
    const issues = issuesOf(`
version: 1
classes:
  exec-a:
    role: executor
    primary: { id: shared, adapter: gemini-cli, family: gemini, backend: gemini, model: gemini-3.6-flash-high }
  exec-b:
    role: executor
    primary: { id: shared, adapter: codex, family: openai, backend: openai, model: gpt-5.6-terra }
`);
    expect(issues.join("\n")).toMatch(/globally unique/);
  });

  it("allows a member id reused across classes when every declaration describes the same endpoint (F-255)", () => {
    // A bench class file mirrors a shipped default's real members under
    // bench-only class names on purpose (WP-585), so a missed load fails
    // loud instead of silently reverting to the Claude-bearing defaults.
    // That intentional redeclaration must not collide with the global
    // uniqueness check.
    const registry = parseAgentClassRegistry(`
version: 1
classes:
  exec-a:
    role: executor
    primary: { id: shared, adapter: gemini-cli, family: gemini, backend: gemini, model: gemini-3.6-flash-high }
  exec-b:
    role: executor
    primary: { id: shared, adapter: gemini-cli, family: gemini, backend: gemini, model: gemini-3.6-flash-high }
`);
    expect(resolveAgentClass(registry, "exec-a", "executor").primary.id).toBe("shared");
    expect(resolveAgentClass(registry, "exec-b", "executor").primary.id).toBe("shared");
  });

  it("rejects an adapter paired with the wrong family or backend", () => {
    const issues = issuesOf(`
version: 1
classes:
  exec-a:
    role: executor
    primary: { id: wrong, adapter: codex, family: gemini, backend: gemini, model: gpt-5.6-terra }
`);
    expect(issues.join("\n")).toMatch(/adapter 'codex' must use family 'openai'/);
    expect(issues.join("\n")).toMatch(/adapter 'codex' must use backend 'openai'/);
  });

  it("rejects an unknown adapter", () => {
    const issues = issuesOf(`
version: 1
classes:
  exec-a:
    role: executor
    primary: { id: x, adapter: not-a-cli, family: openai, backend: openai, model: gpt-5.6-terra }
`);
    expect(issues.length).toBeGreaterThan(0);
  });

  it("rejects a model with no price or context-window row", () => {
    const issues = issuesOf(`
version: 1
classes:
  exec-a:
    role: executor
    primary: { id: x, adapter: codex, family: openai, backend: openai, model: gpt-imaginary-9 }
`);
    expect(issues.join("\n")).toMatch(/no PRICE_TABLE row/);
    expect(issues.join("\n")).toMatch(/no CONTEXT_WINDOW_TABLE row/);
  });

  it("rejects unknown keys and a wrong version", () => {
    expect(() => parseAgentClassRegistry(`version: 2\nclasses: {}\n`)).toThrow(
      AgentClassValidationError,
    );
    expect(issuesOf(`${VALID}\nunexpected: true\n`).join("\n")).toMatch(/unexpected/i);
  });

  it("reports a YAML syntax error as a validation issue, not a raw throw", () => {
    expect(issuesOf("version: 1\nclasses: [oops\n").join("\n")).toMatch(/YAML parse failed/);
  });

  it("names the available classes when a reference does not resolve", () => {
    const registry = parseAgentClassRegistry(VALID);
    expect(() => resolveAgentClass(registry, "missing", "executor")).toThrow(/declared: /);
    expect(() => resolveAgentClass(registry, "judge-a", "executor")).toThrow(
      /has role 'judge', but a 'executor' class is required/,
    );
  });

  it("wraps a legacy inline declaration as a class of size one", () => {
    const executors = singletonExecutorClass({
      adapter: "gemini-cli",
      family: "gemini",
      model: "gemini-3.6-flash-high",
    });
    expect(classMembers(executors)).toHaveLength(1);
    expect(executors.primary.backend).toBe("gemini");

    const judges = singletonJudgeClass({
      transport: "openai-compat",
      backend: "openai",
      model: "gpt-5.6-sol xhigh",
    });
    expect(classMembers(judges)).toHaveLength(1);

    // An adapter the SDK does not know (a caller-registered one, e.g. the
    // "scripted" adapter the runner tests inject) must NOT throw: a legacy spec
    // has no peers to rotate to anyway, and throwing here would fail every step
    // of every run using such an adapter. It gets the `open` vendor, which never
    // collides under invariant #2.
    const custom = singletonExecutorClass({
      adapter: "scripted",
      family: "openai",
      model: "gpt-5.6-terra",
    });
    expect(custom.primary.backend).toBe("open");
    expect(custom.adjacent).toEqual([]);
  });

  it("still rejects an unknown adapter in a DECLARED class", () => {
    // Strictness belongs at the operator-authored boundary, not on a
    // synthesized single-member class.
    expect(
      issuesOf(`
version: 1
classes:
  exec-a:
    role: executor
    primary: { id: x, adapter: scripted, family: openai, backend: openai, model: gpt-5.6-terra }
`).length,
    ).toBeGreaterThan(0);
  });

  it("treats a base registry as overridable so tests need no repo file", () => {
    const base: AgentClassRegistry = { version: 1, classes: {} };
    const registry = parseAgentClassRegistry(VALID, base);
    expect(Object.keys(registry.classes).sort()).toEqual(["exec-a", "judge-a"]);
  });
});
