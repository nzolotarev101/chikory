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

import {
  planAndGateChain,
  planRepairBudgetFromEnv,
  renderPlanRepairTrail,
} from "../../src/cli/chain.js";
import { MAX_GATE_REPAIR_ATTEMPTS } from "../../src/heal/gate-repair.js";
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
    { id: "N-1", goal: "slice one", acceptanceCriteria: [{ id: "AC-1", description: "one" }], dependsOn: [], writeSet: ["one.ts"], budgetUsd: 10 },
    { id: "N-2", goal: "slice two", acceptanceCriteria: [{ id: "AC-1", description: "two" }], dependsOn: ["N-1"], writeSet: ["two.ts"], budgetUsd: 10 },
    { id: "N-3", goal: "slice three", acceptanceCriteria: [{ id: "AC-1", description: "three" }], dependsOn: ["N-2"], writeSet: ["three.ts"], budgetUsd: 10 },
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

  it("stops at decomposition when the plan has fewer nodes than min_nodes (WP-509/F-88)", async () => {
    const oneNode = { nodes: [THREE_NODES.nodes[0]] };
    const router = stagedRouter(
      ok(JSON.stringify(oneNode), "openai"),
      ok(JSON.stringify({ kind: "PROCEED", rationale: "ok" }), "openai-compat"),
    );
    const result = await planAndGateChain({ ...SPEC, minNodes: 3 }, router, ids);
    expect(result).toMatchObject({ ok: false, phase: "plan" });
    if (!result.ok) {
      expect(result.message).toContain("min_nodes");
      expect(result.message).toContain("under-decomposed");
    }
  });

  it("proceeds when the plan meets min_nodes", async () => {
    const router = stagedRouter(
      ok(JSON.stringify(THREE_NODES), "openai"),
      ok(JSON.stringify({ kind: "PROCEED", rationale: "covers AC-1" }), "openai-compat"),
    );
    const result = await planAndGateChain({ ...SPEC, minNodes: 3 }, router, ids);
    expect(result.ok).toBe(true);
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

/**
 * WP-542/F-207 — the bounded plan repair loop. Before this, ANY plan-phase
 * rejection ended the launch and a human hand-edited the goal spec (five times
 * on dogfood-120). ADR-009 D1 is binding: every non-infra failure class gets at
 * least one bounded, journaled, automated heal attempt first.
 */
function scriptedRouter(
  planReplies: (LLMCallResult | RouterError)[],
  judgeReplies: (LLMCallResult | RouterError)[],
): { router: Router; planPrompts: string[] } {
  const planPrompts: string[] = [];
  let planIdx = 0;
  let judgeIdx = 0;
  const last = <T>(queue: T[], idx: number): T => queue[Math.min(idx, queue.length - 1)]!;
  return {
    planPrompts,
    router: {
      async complete(req) {
        if (req.stage === "plan") {
          planPrompts.push(req.messages.map((m) => m.content).join("\n"));
          return last(planReplies, planIdx++);
        }
        return last(judgeReplies, judgeIdx++);
      },
    },
  };
}

const plan = (nodes: unknown) => ok(JSON.stringify(nodes), "openai");
const verdict = (kind: string, rationale: string) =>
  ok(JSON.stringify({ kind, rationale }), "openai-compat");

describe("planAndGateChain repair loop (WP-542, F-207, ADR-009 D1)", () => {
  it("repairs a REVISE and launches on the healed plan instead of ending the launch", async () => {
    const { router } = scriptedRouter(
      [plan(THREE_NODES), plan(THREE_NODES)],
      [verdict("REVISE", "N-2 is underspecified"), verdict("PROCEED", "covers AC-1")],
    );

    const result = await planAndGateChain(SPEC, router, ids);

    expect(result.ok).toBe(true);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]).toMatchObject({ attempt: 1, kind: "gate-revise" });
    expect(result.attempts[1]).toMatchObject({ attempt: 2, kind: "PROCEED" });
    // Cost accumulates across every attempt — the loop is not free.
    expect(result.costUsd).toBeCloseTo(0.2);
  });

  it("feeds the gate's own rejection evidence into the retry prompt", async () => {
    const { router, planPrompts } = scriptedRouter(
      [plan(THREE_NODES)],
      [verdict("REVISE", "N-2 omits the lint step"), verdict("PROCEED", "ok")],
    );

    await planAndGateChain(SPEC, router, ids);

    expect(planPrompts).toHaveLength(2);
    expect(planPrompts[0]).not.toContain("REPAIR BRIEF");
    expect(planPrompts[1]).toContain("PLAN REVISION REQUIRED");
    expect(planPrompts[1]).toContain("REPAIR BRIEF");
    expect(planPrompts[1]).toContain("N-2 omits the lint step");
    // The rejected plan rides along so the retry revises rather than re-rolls.
    expect(planPrompts[1]).toContain("N-2 (after N-1): slice two");
  });

  it("repairs the deterministic literal floor, which the judge itself PROCEEDed", async () => {
    // The goal mandates two backtick literals; the plan's node goals carry
    // neither, so `buildPlanVerdict` force-downgrades PROCEED → REVISE (F-64).
    const literalSpec: TaskSpec = {
      ...SPEC,
      goal: "Ship the widget, writing `summary.json` under `benchmarks/results/`",
    };
    const covering = {
      nodes: [
        {
          ...THREE_NODES.nodes[0],
          goal: "write `summary.json` under `benchmarks/results/`",
        },
        THREE_NODES.nodes[1],
        THREE_NODES.nodes[2],
      ],
    };
    const { router, planPrompts } = scriptedRouter(
      [plan(THREE_NODES), plan(covering)],
      [verdict("PROCEED", "looks coherent")],
    );

    const result = await planAndGateChain(literalSpec, router, ids);

    expect(result.ok).toBe(true);
    expect(result.attempts[0]).toMatchObject({ kind: "gate-revise", verdictKind: "REVISE" });
    expect(result.attempts[0]?.machineGaps.join(" ")).toContain("`summary.json`");
    expect(planPrompts[1]).toContain("`benchmarks/results/`");
  });

  it("repairs an unreachable meta-judge (infra) rather than stopping at it", async () => {
    const { router } = scriptedRouter(
      [plan(THREE_NODES)],
      [fail("transport error: fetch failed"), verdict("PROCEED", "ok")],
    );

    const result = await planAndGateChain(SPEC, router, ids);

    expect(result.ok).toBe(true);
    expect(result.attempts[0]).toMatchObject({ kind: "gate-infra" });
  });

  it("repairs a planner transport failure, which produced no plan at all", async () => {
    const { router } = scriptedRouter(
      [fail("aborted due to timeout"), plan(THREE_NODES)],
      [verdict("PROCEED", "ok")],
    );

    const result = await planAndGateChain(SPEC, router, ids);

    expect(result.ok).toBe(true);
    expect(result.attempts[0]).toMatchObject({ kind: "planner-transport", phase: "plan" });
  });

  it("repairs an under-decomposed plan against the min_nodes shortfall", async () => {
    const oneNode = { nodes: [THREE_NODES.nodes[0]] };
    const { router, planPrompts } = scriptedRouter(
      [plan(oneNode), plan(THREE_NODES)],
      [verdict("PROCEED", "ok")],
    );

    const result = await planAndGateChain({ ...SPEC, minNodes: 3 }, router, ids);

    expect(result.ok).toBe(true);
    expect(result.attempts[0]).toMatchObject({ kind: "min-nodes", phase: "plan" });
    expect(planPrompts[1]).toContain("Emit at least 3 nodes");
  });

  it("stops after the attempt budget and returns the whole trail", async () => {
    const { router } = scriptedRouter(
      [plan(THREE_NODES)],
      [verdict("REVISE", "still underspecified")],
    );

    const result = await planAndGateChain(SPEC, router, ids);

    expect(result.ok).toBe(false);
    // 1 original pass + MAX_GATE_REPAIR_ATTEMPTS repairs.
    expect(result.attempts).toHaveLength(MAX_GATE_REPAIR_ATTEMPTS + 1);
    expect(result.attempts.map((a) => a.attempt)).toEqual([1, 2, 3, 4]);
    if (!result.ok) {
      expect(result.message).toContain("3 automated repair attempt(s) did not converge");
      expect(result.message).toContain("still underspecified");
    }
  });

  it("never returns an ungated plan when the budget runs out", async () => {
    const { router } = scriptedRouter([plan(THREE_NODES)], [verdict("REVISE", "no")]);

    const result = await planAndGateChain(SPEC, router, ids);

    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("plan");
  });

  it("does not repair a family-diversity config error (invariant #2, fail fast)", async () => {
    const sameFamily: TaskSpec = {
      ...SPEC,
      routing: {
        stages: { ...SPEC.routing.stages, judge: { provider: "openai", model: "gpt-test" } },
      },
    };
    const { router, planPrompts } = scriptedRouter(
      [plan(THREE_NODES)],
      [verdict("PROCEED", "ok")],
    );

    const result = await planAndGateChain(sameFamily, router, ids);

    expect(result.ok).toBe(false);
    expect(result.attempts).toHaveLength(1);
    expect(planPrompts).toHaveLength(1);
  });

  it("does not repair a substantive ESCALATE — that verdict is for a human", async () => {
    const { router } = scriptedRouter(
      [plan(THREE_NODES)],
      [verdict("ESCALATE", "the goal contradicts itself")],
    );

    const result = await planAndGateChain(SPEC, router, ids);

    expect(result.ok).toBe(false);
    expect(result.attempts).toHaveLength(1);
    if (!result.ok) expect(result.message).toContain("NOT safe to re-run as-is");
  });

  it("maxRepairAttempts 0 reproduces the pre-WP-542 single-shot stop", async () => {
    const { router, planPrompts } = scriptedRouter(
      [plan(THREE_NODES)],
      [verdict("REVISE", "node 2 is underspecified")],
    );

    const result = await planAndGateChain(SPEC, router, ids, { maxRepairAttempts: 0 });

    expect(result.ok).toBe(false);
    expect(result.attempts).toHaveLength(1);
    expect(planPrompts).toHaveLength(1);
    if (!result.ok) expect(result.message).toContain("automated repair is disabled");
  });

  it("stops on the cost cap before the attempt budget is spent", async () => {
    const { router } = scriptedRouter([plan(THREE_NODES)], [verdict("REVISE", "nope")]);

    // Each pass costs $0.10 (planner + judge), so a $0.15 cap allows one repair.
    const result = await planAndGateChain(SPEC, router, ids, { repairCostCapUsd: 0.15 });

    expect(result.ok).toBe(false);
    expect(result.attempts).toHaveLength(2);
  });

  it("reports every attempt to the operator as it happens", async () => {
    const { router } = scriptedRouter(
      [plan(THREE_NODES)],
      [verdict("REVISE", "N-2 is underspecified"), verdict("PROCEED", "ok")],
    );
    const seen: string[] = [];

    await planAndGateChain(SPEC, router, ids, {
      onAttempt: (attempt, maxPasses) => seen.push(`${attempt.attempt}/${maxPasses}:${attempt.kind}`),
    });

    expect(seen).toEqual(["1/4:gate-revise", "2/4:PROCEED"]);
  });
});

describe("renderPlanRepairTrail (WP-542)", () => {
  it("renders every attempt with its class, cost, and machine-checked gaps", () => {
    const lines = renderPlanRepairTrail(
      [
        {
          attempt: 1,
          phase: "gate",
          kind: "gate-revise",
          verdictKind: "REVISE",
          machineGaps: ["mandated goal literal `summary.json` appears in no node goal"],
          costUsd: 0.1,
          reason: "N-2 omits the lint step",
        },
        {
          attempt: 2,
          phase: "plan",
          kind: "planner-transport",
          machineGaps: [],
          costUsd: 0,
          reason: "transport error:   timeout",
        },
      ],
      0.1,
    );

    expect(lines[0]).toContain("plan repair trail (2 attempt(s), $0.1000)");
    expect(lines.join("\n")).toContain("attempt 1 · gate · REVISE · $0.1000");
    expect(lines.join("\n")).toContain("`summary.json`");
    // No machine gaps → the prose reason is the fallback, whitespace collapsed.
    expect(lines.join("\n")).toContain("transport error: timeout");
  });

  it("renders nothing when there are no attempts", () => {
    expect(renderPlanRepairTrail([], 0)).toEqual([]);
  });
});

describe("planRepairBudgetFromEnv (WP-542)", () => {
  it("defaults to the bounded tier maximum when unset or blank", () => {
    expect(planRepairBudgetFromEnv(undefined)).toBe(MAX_GATE_REPAIR_ATTEMPTS);
    expect(planRepairBudgetFromEnv("  ")).toBe(MAX_GATE_REPAIR_ATTEMPTS);
  });

  it("honors an explicit 0 — the seam that restores the pre-WP-542 dead end", () => {
    expect(planRepairBudgetFromEnv("0")).toBe(0);
  });

  it("honors an explicit larger budget", () => {
    expect(planRepairBudgetFromEnv("5")).toBe(5);
  });

  it("ignores junk rather than disabling repair by accident", () => {
    expect(planRepairBudgetFromEnv("-1")).toBe(MAX_GATE_REPAIR_ATTEMPTS);
    expect(planRepairBudgetFromEnv("two")).toBe(MAX_GATE_REPAIR_ATTEMPTS);
    expect(planRepairBudgetFromEnv("1.5")).toBe(MAX_GATE_REPAIR_ATTEMPTS);
  });
});
