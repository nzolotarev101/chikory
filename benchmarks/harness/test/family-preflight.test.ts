import { describe, expect, it } from "vitest";

import {
  checkBenchFamilyDirective,
  formatResolvedFamilies,
  resolveBenchFamilies,
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
