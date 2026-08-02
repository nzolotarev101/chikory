import { describe, expect, it, vi } from "vitest";

import { DEFAULT_AGENT_CLASSES } from "../../src/agents/classes.js";
import { parseTaskSpec, TaskSpecValidationError } from "../../src/taskspec.js";

const ENV = { OPENAI_COMPAT_BASE_URL: "http://127.0.0.1:8787" };

const HEAD = `
name: t
goal: do a thing
repos:
  - { url: /tmp/repo, writable: true }
acceptance_criteria:
  - { id: AC-1, description: it works, check: "true" }
budget_usd: 5
`;

function parse(body: string, opts: { warn?: (m: string) => void } = {}) {
  return parseTaskSpec(HEAD + body, {
    env: ENV,
    registry: DEFAULT_AGENT_CLASSES,
    warn: opts.warn ?? (() => {}),
  });
}

function issues(body: string): string[] {
  try {
    parse(body);
  } catch (err) {
    if (err instanceof TaskSpecValidationError) return err.issues;
    throw err;
  }
  throw new Error("expected the spec to be rejected, but it parsed");
}

describe("agent_classes in a task spec (WP-566)", () => {
  it("fills the executor, judge and routing from the class primaries", () => {
    const spec = parse(`
agent_classes:
  executor: executor-default
  judge: judge-default
judge:
  cadence: 1
`);

    expect(spec.executor).toEqual({ adapter: "gemini-cli", family: "gemini" });
    expect(spec.agentClasses).toEqual({
      executor: "executor-default",
      judge: "judge-default",
    });
    expect(spec.judge.family).toBe("openai-compat");
    expect(spec.judge.model).toBe("gpt-5.6-sol xhigh");
    expect(spec.judge.cadence).toBe(1);

    // Routing must FOLLOW the members, else a rotation moves the agent but not
    // its routing and the judge stage stays pinned to the walled model.
    expect(spec.routing.stages.code).toEqual({
      provider: "gemini",
      model: "gemini-3.6-flash-high",
    });
    for (const stage of ["plan", "review", "judge"] as const) {
      expect(spec.routing.stages[stage]).toEqual({
        provider: "openai-compat",
        model: "gpt-5.6-sol xhigh",
      });
    }
  });

  it("refuses a spec that declares BOTH agent_classes and routing", () => {
    const text = issues(`
agent_classes: { executor: executor-default, judge: judge-default }
judge: { cadence: 1 }
routing:
  stages:
    plan:   { provider: openai-compat, model: gpt-5.6-sol xhigh }
    code:   { provider: openai-compat, model: default }
    review: { provider: openai-compat, model: gpt-5.6-sol xhigh }
    judge:  { provider: openai-compat, model: gpt-5.6-sol xhigh }
`).join("\n");
    // Silently ignoring the hand-written routing would leave the judge pinned
    // to a model the scheduler may have rotated away from.
    expect(text).toMatch(/DERIVED from the agent class members/);
  });

  it("still requires an executor when no class names one", () => {
    expect(issues(`judge: { family: openai-compat, model: gpt-5.6-sol xhigh }`).join("\n")).toMatch(
      /declare an `executor:` block or name an `agent_classes.executor`/,
    );
  });

  it("names the available classes when the reference is wrong", () => {
    expect(
      issues(`
agent_classes: { executor: nope }
judge: { family: openai-compat, model: gpt-5.6-sol xhigh }
`).join("\n"),
    ).toMatch(/agent_classes\.executor:[\s\S]*declared: /);
  });

  it("rejects a class reference used in the wrong role", () => {
    expect(
      issues(`
agent_classes: { executor: judge-default }
judge: { family: openai-compat, model: gpt-5.6-sol xhigh }
`).join("\n"),
    ).toMatch(/has role 'judge', but a 'executor' class is required/);
  });

  it("leaves a legacy spec with no classes completely alone", () => {
    // Shaped like the dogfood specs on disk: routing pinned by hand.
    const spec = parse(`
executor: { adapter: gemini-cli, family: gemini }
judge: { family: openai-compat, model: gpt-5.6-sol xhigh, cadence: 2 }
routing:
  stages:
    plan:   { provider: openai-compat, model: gpt-5.6-sol xhigh }
    code:   { provider: openai-compat, model: default }
    review: { provider: openai-compat, model: gpt-5.6-sol xhigh }
    judge:  { provider: openai-compat, model: gpt-5.6-sol xhigh }
`);
    expect(spec.agentClasses).toBeUndefined();
    expect(spec.executor).toEqual({ adapter: "gemini-cli", family: "gemini" });
    expect(spec.routing.stages.code.model).toBe("default");
  });

  it("class-derived routing needs no executor-provider API key", () => {
    // `defaultPolicy` points plan/review at the EXECUTOR's provider, so a
    // keyless CLI executor with no explicit routing is refused for a
    // GEMINI_API_KEY the architecture never holds (the F-178 shape). Deriving
    // routing from the members puts those stages on the judge transport
    // instead, so the class form does not hit it.
    const spec = parse(`
agent_classes: { executor: executor-default, judge: judge-default }
judge: { cadence: 1 }
`);
    expect(spec.routing.stages.plan.provider).toBe("openai-compat");
  });
});

describe("invariant #2 on the true vendor (WP-569)", () => {
  it("REJECTS a codex executor judged by a GPT model behind openai-compat", () => {
    // This is the hole: `openai` vs `openai-compat` are different LLMProviders,
    // so every pre-WP-569 check passed while both sides were GPT-5.6.
    const text = issues(`
executor: { adapter: codex, family: openai }
judge: { family: openai-compat, model: gpt-5.6-sol xhigh }
routing:
  stages:
    plan:   { provider: openai-compat, model: gpt-5.6-sol xhigh }
    code:   { provider: openai, model: gpt-5.6-terra }
    review: { provider: openai-compat, model: gpt-5.6-sol xhigh }
    judge:  { provider: openai-compat, model: gpt-5.6-sol xhigh }
`).join("\n");
    expect(text).toMatch(/both resolve to the 'openai' vendor/);
    expect(text).toMatch(/transport is not a vendor/);
  });

  it("catches it through the ADAPTER when the code stage model is not vendor-bearing", () => {
    // `model: default` names no vendor, so the adapter is the only evidence.
    const text = issues(`
executor: { adapter: claude-code, family: anthropic }
judge: { family: openai-compat, model: claude-opus-5 }
routing:
  stages:
    plan:   { provider: openai-compat, model: claude-opus-5 }
    code:   { provider: openai-compat, model: default }
    review: { provider: openai-compat, model: claude-opus-5 }
    judge:  { provider: openai-compat, model: claude-opus-5 }
`).join("\n");
    expect(text).toMatch(/both resolve to the 'anthropic' vendor/);
  });

  it("allows the collision under the explicit opt-in, warning once", () => {
    const warn = vi.fn();
    const spec = parse(
      `
executor: { adapter: codex, family: openai }
judge: { family: openai-compat, model: gpt-5.6-sol xhigh, allow_same_family: true }
routing:
  stages:
    plan:   { provider: openai-compat, model: gpt-5.6-sol xhigh }
    code:   { provider: openai, model: gpt-5.6-terra }
    review: { provider: openai-compat, model: gpt-5.6-sol xhigh }
    judge:  { provider: openai-compat, model: gpt-5.6-sol xhigh }
`,
      { warn },
    );
    expect(spec.judge.allowSameFamily).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatch(/same VENDOR as the executor \('openai'\)/);
  });

  it("accepts the shipped default pair — Gemini executes, an OpenAI model judges", () => {
    const warn = vi.fn();
    const spec = parse(
      `
agent_classes: { executor: executor-default, judge: judge-default }
judge: { cadence: 1 }
`,
      { warn },
    );
    expect(spec.executor.adapter).toBe("gemini-cli");
    expect(warn).not.toHaveBeenCalled();
  });
});
