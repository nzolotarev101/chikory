import { describe, expect, it } from "vitest";

import {
  checkBenchFamilyDirective,
  formatResolvedFamilies,
  resolveBenchFamilies,
  resolveClassMembers,
} from "../src/family-preflight.js";

const NO_PROXY: NodeJS.ProcessEnv = {};
const WITH_PROXY: NodeJS.ProcessEnv = { OPENAI_COMPAT_BASE_URL: "http://localhost:1234" };

describe("resolveBenchFamilies", () => {
  it("defaults to the gemini-cli executor and (no proxy) an anthropic judge", () => {
    const r = resolveBenchFamilies({}, NO_PROXY);
    expect(r.executor).toEqual({ adapter: "gemini-cli", family: "gemini" });
    expect(r.judge).toEqual({ family: "anthropic" });
    expect(r.codeModel).toBeUndefined();
  });

  it("the OPENAI_COMPAT_BASE_URL codex proxy rewrites judge → openai-compat and code → default", () => {
    const r = resolveBenchFamilies({}, WITH_PROXY);
    expect(r.executor.family).toBe("gemini");
    expect(r.judge).toEqual({ family: "openai-compat" });
    expect(r.codeModel).toBe("default");
  });

  it("honors an explicit executor and passes a routing code model through", () => {
    const r = resolveBenchFamilies(
      {
        executor: { adapter: "claude-code", family: "anthropic" },
        routing: { stages: { code: { provider: "openai-compat", model: "gpt-5.6-sol xhigh" } } },
      },
      NO_PROXY,
    );
    expect(r.executor.family).toBe("anthropic");
    expect(r.codeModel).toBe("gpt-5.6-sol xhigh");
  });

  it("tolerates malformed routing shapes without throwing", () => {
    expect(resolveBenchFamilies({ routing: "nope" }, NO_PROXY).codeModel).toBeUndefined();
    expect(resolveBenchFamilies({ routing: { stages: 7 } }, NO_PROXY).codeModel).toBeUndefined();
    expect(resolveBenchFamilies({ routing: { stages: { code: {} } } }, NO_PROXY).codeModel).toBeUndefined();
  });
});

describe("checkBenchFamilyDirective", () => {
  it("the sanctioned arm (gemini executor + openai-compat judge) has no violations", () => {
    const r = resolveBenchFamilies({}, WITH_PROXY);
    expect(checkBenchFamilyDirective(r)).toEqual([]);
  });

  it("flags a non-gemini executor — the F-165 wrong-family burn", () => {
    const r = resolveBenchFamilies(
      { executor: { adapter: "claude-code", family: "anthropic" } },
      WITH_PROXY,
    );
    const codes = checkBenchFamilyDirective(r).map((v) => v.code);
    expect(codes).toContain("executor-not-gemini");
  });

  it("flags an anthropic/Claude judge (never Claude) — the no-proxy default", () => {
    const r = resolveBenchFamilies({}, NO_PROXY);
    const codes = checkBenchFamilyDirective(r).map((v) => v.code);
    expect(codes).toContain("judge-not-codex");
  });

  it("flags a judge that matches the executor family (no bias diversity)", () => {
    const r = resolveBenchFamilies(
      { executor: { adapter: "gemini-cli", family: "gemini" }, judge: { family: "gemini" } },
      NO_PROXY,
    );
    const codes = checkBenchFamilyDirective(r).map((v) => v.code);
    expect(codes).toContain("judge-not-diverse");
  });

  it("flags a foreign code-stage routing model at the gemini executor — F-170", () => {
    const r = resolveBenchFamilies(
      {
        executor: { adapter: "gemini-cli", family: "gemini" },
        judge: { family: "openai-compat" },
        routing: { stages: { code: { model: "gpt-5.6-sol xhigh" } } },
      },
      NO_PROXY,
    );
    const codes = checkBenchFamilyDirective(r).map((v) => v.code);
    expect(codes).toContain("code-routing-family-mismatch");
  });

  it("a 'default' code model is never a mismatch", () => {
    const r = resolveBenchFamilies(
      {
        executor: { adapter: "gemini-cli", family: "gemini" },
        judge: { family: "openai-compat" },
        routing: { stages: { code: { model: "default" } } },
      },
      NO_PROXY,
    );
    expect(checkBenchFamilyDirective(r)).toEqual([]);
  });
});

describe("formatResolvedFamilies", () => {
  it("renders the resolved arm, appending the code model only when present", () => {
    expect(formatResolvedFamilies(resolveBenchFamilies({}, WITH_PROXY))).toBe(
      "executor gemini-cli(gemini) · judge openai-compat · code-model default",
    );
    expect(formatResolvedFamilies(resolveBenchFamilies({}, NO_PROXY))).toBe(
      "executor gemini-cli(gemini) · judge anthropic",
    );
  });
});

/**
 * F-253 (WP-585) — the directive covers every member a wall can rotate INTO.
 *
 * Handing the bench arm declared classes makes the fallbacks part of the arm.
 * The repo's own `agent-classes.yaml` lists `sonnet-5`/`opus-5`, so wiring it
 * in unchecked would let a Gemini wall rotate the arm onto Claude — spending
 * real Anthropic budget and publishing an I-SR measured on a mixed executor.
 * That is F-165 arriving through a new door.
 */
describe("agent class members (WP-585)", () => {
  const benchClasses = {
    version: 1,
    classes: {
      "executor-default": {
        role: "executor",
        primary: { id: "gemini-3-6-flash", adapter: "gemini-cli", family: "gemini", backend: "gemini" },
        adjacent: [{ id: "gpt-5-6-terra", adapter: "codex", family: "openai", backend: "openai" }],
      },
      "judge-default": {
        role: "judge",
        primary: { id: "gpt-5-6-sol", transport: "openai-compat", backend: "openai" },
        adjacent: [{ id: "gemini-3-1-pro", transport: "openai-compat", backend: "gemini" }],
      },
    },
  };

  const withClaude = {
    version: 1,
    classes: {
      "executor-default": {
        role: "executor",
        primary: { id: "gemini-3-6-flash", adapter: "gemini-cli", family: "gemini", backend: "gemini" },
        adjacent: [
          { id: "gpt-5-6-terra", adapter: "codex", family: "openai", backend: "openai" },
          { id: "sonnet-5", adapter: "claude-code", family: "anthropic", backend: "anthropic", model: "claude-sonnet-5" },
        ],
      },
    },
  };

  const env = { OPENAI_COMPAT_BASE_URL: "http://127.0.0.1:8787" } as NodeJS.ProcessEnv;

  it("collects primary AND adjacent members from every class", () => {
    const members = resolveClassMembers(benchClasses);
    expect(members.map((m) => m.memberId)).toEqual([
      "gemini-3-6-flash",
      "gpt-5-6-terra",
      "gpt-5-6-sol",
      "gemini-3-1-pro",
    ]);
  });

  it("passes the bench class file — rotation stays inside gemini/openai", () => {
    const resolved = resolveBenchFamilies({ agentClasses: benchClasses }, env);
    expect(checkBenchFamilyDirective(resolved)).toEqual([]);
  });

  it("REFUSES a Claude fallback — a wall must not rotate the arm onto Claude", () => {
    const resolved = resolveBenchFamilies({ agentClasses: withClaude }, env);
    const violations = checkBenchFamilyDirective(resolved);
    expect(violations.map((v) => v.code)).toContain("class-member-anthropic");
    expect(violations.find((v) => v.code === "class-member-anthropic")!.message).toContain("sonnet-5");
  });

  it("reads the true vendor from `backend`, never the transport", () => {
    // `opus-5` reaches Claude over the openai-compat proxy — a transport is not
    // a vendor, so a transport-keyed check would wave this through.
    const viaProxy = {
      version: 1,
      classes: {
        "judge-default": {
          role: "judge",
          primary: { id: "gpt-5-6-sol", transport: "openai-compat", backend: "openai" },
          adjacent: [{ id: "opus-5", transport: "openai-compat", backend: "anthropic", model: "claude-opus-5" }],
        },
      },
    };
    const violations = checkBenchFamilyDirective(resolveBenchFamilies({ agentClasses: viaProxy }, env));
    expect(violations.map((v) => v.code)).toContain("class-member-anthropic");
  });

  it("changes nothing when no classes are declared", () => {
    expect(checkBenchFamilyDirective(resolveBenchFamilies({}, env))).toEqual([]);
  });
});
