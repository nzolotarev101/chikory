/**
 * Planner harness (WP-219 S2, ADR-005 D1). Unit-tests the non-pure coordinator
 * over an injected fake `Router` (the router transport is covered separately in
 * router.test.ts): success assembles a `Plan`; every failure mode — router
 * failure, non-JSON, schema-invalid reply, unassemblable graph — is a value, not
 * a throw (invariant #4). The `DecomposingPlanner` adapter throws to satisfy the
 * frozen `GoalPlanner` contract.
 */
import { describe, expect, it } from "vitest";

import { DecomposingPlanner, PlannerError, runPlannerPass } from "../../src/planner/harness.js";
import type { LLMCallResult, PlanInput, Router, RouterError } from "../../src/types.js";

const INPUT: PlanInput = {
  goal: "Ship the widget",
  acceptanceCriteria: [{ id: "AC-1", description: "the widget ships" }],
  budgetUsd: 10,
  family: "openai",
};

function ok(content: string): LLMCallResult {
  return {
    status: "SUCCESS",
    content,
    provider: "openai",
    model: "gpt-test",
    tokens: { input: 100, output: 20 },
    costUsd: 0.05,
  };
}

function fail(reason: string): RouterError {
  return { status: "FAILED", reason, retriable: false, attempts: 3 };
}

function router(reply: LLMCallResult | RouterError): Router {
  return { complete: async () => reply };
}

const ONE_NODE = {
  nodes: [
    {
      id: "N-1",
      goal: "build the widget",
      acceptanceCriteria: [{ id: "AC-1", description: "the widget ships" }],
      dependsOn: [],
      budgetUsd: 10,
    },
  ],
};

const opts = { planId: "plan-xyz", createdAt: "2026-06-19T00:00:00.000Z" };

describe("runPlannerPass", () => {
  it("assembles a Plan from a valid reply with the injected id and clock", async () => {
    const result = await runPlannerPass({
      router: router(ok(JSON.stringify(ONE_NODE))),
      input: INPUT,
      ...opts,
    });

    expect(result.status).toBe("SUCCESS");
    if (result.status !== "SUCCESS") return;
    expect(result.plan.id).toBe("plan-xyz");
    expect(result.plan.goal).toBe("Ship the widget");
    expect(result.plan.createdAt).toBe("2026-06-19T00:00:00.000Z");
    expect(result.plan.nodes.map((n) => n.id)).toEqual(["N-1"]);
    expect(result.costUsd).toBe(0.05);
    expect(result.tokens).toEqual({ input: 100, output: 20 });
  });

  it("returns FAILED with zero cost when the router call fails", async () => {
    const result = await runPlannerPass({
      router: router(fail("upstream 503")),
      input: INPUT,
      ...opts,
    });

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.reason).toContain("after 3 attempts");
    expect(result.reason).toContain("upstream 503");
    expect(result.costUsd).toBe(0);
  });

  it("returns FAILED when the reply is not valid JSON", async () => {
    const result = await runPlannerPass({
      router: router(ok("not json {{{")),
      input: INPUT,
      ...opts,
    });

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.reason).toContain("not valid JSON");
    // cost from the (paid) call is still surfaced
    expect(result.costUsd).toBe(0.05);
  });

  it("returns FAILED when the reply fails schema validation", async () => {
    const badNode = {
      nodes: [{ id: "N-1", goal: "x", acceptanceCriteria: [], dependsOn: [], budgetUsd: 0 }],
    };
    const result = await runPlannerPass({
      router: router(ok(JSON.stringify(badNode))),
      input: INPUT,
      ...opts,
    });

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.reason).toContain("schema validation");
  });

  it("returns FAILED when a node depends on an unknown node", async () => {
    const dangling = {
      nodes: [
        {
          id: "N-1",
          goal: "build",
          acceptanceCriteria: [{ id: "AC-1", description: "ships" }],
          dependsOn: ["N-9"],
          budgetUsd: 10,
        },
      ],
    };
    const result = await runPlannerPass({
      router: router(ok(JSON.stringify(dangling))),
      input: INPUT,
      ...opts,
    });

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.reason).toContain("did not assemble");
    expect(result.reason).toContain("N-9");
  });

  it("returns FAILED on an empty node list", async () => {
    const result = await runPlannerPass({
      router: router(ok(JSON.stringify({ nodes: [] }))),
      input: INPUT,
      ...opts,
    });

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.reason).toContain("did not assemble");
  });
});

describe("DecomposingPlanner", () => {
  it("returns the Plan from a successful pass, using the id/clock injectors", async () => {
    const planner = new DecomposingPlanner({
      router: router(ok(JSON.stringify(ONE_NODE))),
      newPlanId: () => "plan-injected",
      now: () => "2026-06-19T12:00:00.000Z",
    });

    const plan = await planner.decompose(INPUT);
    expect(plan.id).toBe("plan-injected");
    expect(plan.createdAt).toBe("2026-06-19T12:00:00.000Z");
    expect(plan.nodes).toHaveLength(1);
  });

  it("throws PlannerError when the pass fails", async () => {
    const planner = new DecomposingPlanner({
      router: router(fail("boom")),
      newPlanId: () => "plan-injected",
      now: () => "2026-06-19T12:00:00.000Z",
    });

    await expect(planner.decompose(INPUT)).rejects.toBeInstanceOf(PlannerError);
  });
});
