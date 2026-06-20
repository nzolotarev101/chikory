/**
 * `chikory chain` host-side decompose→gate (WP-219 S3-wiring launch path,
 * ADR-005 §S3). Unit-tests `planAndGateChain` over an injected stage-aware fake
 * `Router` (no Temporal): a PROCEED verdict yields the gated plan; a failed
 * decomposition, a non-PROCEED meta-judge verdict, and a same-family plan-judge
 * config error each stop the chain as a value (invariant #4 / #2).
 *
 * The durable half (`chainLoop` over the gated plan) is integration-tested in
 * `test/chain/chain-loop.test.ts`; the full launch path is exercised live by
 * the dogfood-041 campaign (the real end-to-end proof — real integration over a
 * mocked wire, per the project's test discipline).
 */
import { describe, expect, it } from "vitest";

import { planAndGateChain } from "../../src/cli/chain.js";
import type { LLMCallResult, Router, RouterError, TaskSpec } from "../../src/types.js";

const SPEC: TaskSpec = {
  name: "ship-the-widget",
  goal: "Ship the widget end to end",
  repos: [{ url: "/tmp/src", writable: true }],
  acceptanceCriteria: [{ id: "AC-1", description: "the widget ships" }],
  budgetUsd: 30,
  executor: { adapter: "codex", family: "openai" },
  judge: { family: "openai-compat", cadence: 1 },
  routing: {
    stages: {
      plan: { provider: "openai", model: "gpt-test" },
      code: { provider: "openai", model: "gpt-test" },
      review: { provider: "openai", model: "gpt-test" },
      judge: { provider: "openai-compat", model: "gemini-test" },
    },
  },
};

const THREE_NODES = {
  nodes: [
    { id: "N-1", goal: "slice one", acceptanceCriteria: [{ id: "AC-1", description: "one" }], dependsOn: [], budgetUsd: 10 },
    { id: "N-2", goal: "slice two", acceptanceCriteria: [{ id: "AC-1", description: "two" }], dependsOn: ["N-1"], budgetUsd: 10 },
    { id: "N-3", goal: "slice three", acceptanceCriteria: [{ id: "AC-1", description: "three" }], dependsOn: ["N-2"], budgetUsd: 10 },
  ],
};

function ok(content: string, provider: LLMCallResult["provider"]): LLMCallResult {
  return { status: "SUCCESS", content, provider, model: "m", tokens: { input: 100, output: 20 }, costUsd: 0.05 };
}

function fail(reason: string): RouterError {
  return { status: "FAILED", reason, retriable: false, attempts: 3 };
}

/** Stage-aware fake: `plan` calls get the planner reply, `judge` the verdict. */
function stagedRouter(planReply: LLMCallResult | RouterError, judgeReply: LLMCallResult | RouterError): Router {
  return {
    async complete(req) {
      return req.stage === "plan" ? planReply : judgeReply;
    },
  };
}

const ids = { newPlanId: () => "plan-xyz", now: () => "2026-06-20T00:00:00.000Z" };

describe("planAndGateChain", () => {
  it("returns the gated plan when the meta-judge PROCEEDs", async () => {
    const router = stagedRouter(
      ok(JSON.stringify(THREE_NODES), "openai"),
      ok(JSON.stringify({ kind: "PROCEED", rationale: "covers AC-1" }), "openai-compat"),
    );
    const result = await planAndGateChain(SPEC, router, ids);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.id).toBe("plan-xyz");
      expect(result.plan.nodes.map((n) => n.id)).toEqual(["N-1", "N-2", "N-3"]);
      expect(result.verdict.kind).toBe("PROCEED");
      expect(result.costUsd).toBeCloseTo(0.1);
    }
  });

  it("stops at decomposition when the planner call fails (a value, not a throw)", async () => {
    const router = stagedRouter(fail("planner exploded"), ok("{}", "openai-compat"));
    const result = await planAndGateChain(SPEC, router, ids);
    expect(result).toMatchObject({ ok: false, phase: "plan" });
    if (!result.ok) expect(result.message).toContain("planner exploded");
  });

  it("stops at the gate on a non-PROCEED verdict, surfacing the rationale", async () => {
    const router = stagedRouter(
      ok(JSON.stringify(THREE_NODES), "openai"),
      ok(JSON.stringify({ kind: "REVISE", rationale: "node 2 is underspecified" }), "openai-compat"),
    );
    const result = await planAndGateChain(SPEC, router, ids);
    expect(result).toMatchObject({ ok: false, phase: "gate" });
    if (!result.ok) {
      expect(result.message).toContain("node 2 is underspecified");
      expect(result.verdict?.kind).toBe("REVISE");
    }
  });

  it("stops at the gate when the plan-judge shares the planner family (no opt-in)", async () => {
    // routing.judge provider === executor family (openai) → FamilyDiversityError.
    const sameFamily: TaskSpec = {
      ...SPEC,
      routing: { stages: { ...SPEC.routing.stages, judge: { provider: "openai", model: "gpt-test" } } },
    };
    const router = stagedRouter(
      ok(JSON.stringify(THREE_NODES), "openai"),
      ok(JSON.stringify({ kind: "PROCEED", rationale: "ok" }), "openai"),
    );
    const result = await planAndGateChain(sameFamily, router, ids);
    expect(result).toMatchObject({ ok: false, phase: "gate" });
    if (!result.ok) expect(result.message.toLowerCase()).toContain("family");
  });
});
