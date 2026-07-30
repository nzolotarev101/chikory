/**
 * F-221 — the plan-gate ORACLE floor.
 *
 * dogfood-120's accepted plan gave four of its six nodes a single
 * planner-invented prose criterion with no `check`. `N-2`'s (`N2-AC-1`) demanded
 * "evidence records… upstream provenance… review"; the judge refused
 * self-authored assertions on five consecutive passes, three fails is a rule-3
 * HALT, two HALTs killed the lineage, and the chain died — after the squeeze had
 * already produced a fabricated review sign-off and a fake-shim RED/GREEN proof.
 * The plan that dispatched it must be rejected at the gate instead, for the price
 * of one repair pass.
 */
import { describe, expect, it } from "vitest";

import { buildPlanVerdict, gateFailure, planOracleGaps } from "../../src/index.js";
import type { AcceptanceCriterion, Plan, PlanNode } from "../../src/types.js";

const AC_WITH_CHECK: AcceptanceCriterion = {
  id: "AC-1",
  description: "the comparison CLI owns the statistical oracle",
  check: "cd benchmarks/harness && pnpm exec tsc && node dist/bin.js compare --left a --right b",
};

function node(id: string, criteria: AcceptanceCriterion[], goal = `work for ${id}`): PlanNode {
  return {
    id,
    goal,
    acceptanceCriteria: criteria,
    dependsOn: [],
    writeSet: [`src/${id}.ts`],
    budgetUsd: 1,
  };
}

function plan(nodes: PlanNode[]): Plan {
  return {
    id: "plan-oracle-floor",
    goal: "climb the rung",
    nodes,
    createdAt: "2026-07-29T04:10:28.766Z",
  };
}

/** dogfood-120's real shape: AC-carrying tooling node, prose-only authoring node. */
const DOGFOOD_120_PLAN = plan([
  node("N-1", [AC_WITH_CHECK]),
  node("N-2", [
    {
      id: "N2-AC-1",
      description:
        "brownfield-004 is a reviewed, runnable, pinned public-OSS task whose evidence records " +
        "upstream provenance, the exact pin, RED results on the untouched base, GREEN results on " +
        "the known-good fix, and lockfile-respecting base verification.",
    },
  ]),
]);

describe("planOracleGaps", () => {
  it("names every node with no executable acceptance check", () => {
    expect(planOracleGaps(DOGFOOD_120_PLAN)).toEqual(["N-2"]);
  });

  it("is empty when every node carries one", () => {
    expect(planOracleGaps(plan([node("N-1", [AC_WITH_CHECK])]))).toEqual([]);
  });

  it("does not count a blank or whitespace-only check as an oracle", () => {
    const blank = node("N-1", [{ id: "AC-1", description: "d", check: "  \n" }]);
    expect(planOracleGaps(plan([blank, node("N-2", [AC_WITH_CHECK])]))).toEqual(["N-1"]);
  });

  it("exempts a plan with no checks anywhere — a prose-only SPEC the retry cannot repair", () => {
    // `buildPlan` hydrates a covering criterion from the goal spec verbatim, so
    // a plan without a single check means the operator wrote prose-only ACs.
    // Rejecting it would dead-end the launch (the planner must never author a
    // check of its own, F-40) — the WP-542 failure mode this floor lives inside.
    const proseOnly = plan([
      node("N-1", [{ id: "AC-1", description: "the first slice ships" }]),
      node("N-2", [{ id: "AC-2", description: "the second slice ships" }]),
    ]);
    expect(planOracleGaps(proseOnly)).toEqual([]);
    expect(
      buildPlanVerdict({ kind: "PROCEED", rationale: "coherent" }, proseOnly, []).kind,
    ).toBe("PROCEED");
  });

  it("accepts a node whose prose criterion sits ALONGSIDE a real check", () => {
    const mixed = node("N-2", [
      { id: "N2-AC-1", description: "reviewed and pinned" },
      AC_WITH_CHECK,
    ]);
    expect(planOracleGaps(plan([mixed]))).toEqual([]);
  });
});

describe("buildPlanVerdict oracle floor", () => {
  const proceed = { kind: "PROCEED" as const, rationale: "The six nodes cover the goal." };

  it("downgrades the real dogfood-120 PROCEED to REVISE and names the node", () => {
    const verdict = buildPlanVerdict(proceed, DOGFOOD_120_PLAN, [AC_WITH_CHECK]);

    expect(verdict.kind).toBe("REVISE");
    expect(verdict.rationale).toContain("oracle override");
    expect(verdict.rationale).toContain("N-2");
    // The gate's own prose survives ahead of the override.
    expect(verdict.rationale.startsWith("The six nodes cover the goal.")).toBe(true);
  });

  it("leaves a plan whose every node has a check at PROCEED", () => {
    const verdict = buildPlanVerdict(proceed, plan([node("N-1", [AC_WITH_CHECK])]), [
      AC_WITH_CHECK,
    ]);

    expect(verdict.kind).toBe("PROCEED");
    expect(verdict.rationale).not.toContain("oracle override");
  });

  it("never upgrades a non-PROCEED reply", () => {
    const verdict = buildPlanVerdict(
      { kind: "ESCALATE", rationale: "a human must look" },
      DOGFOOD_120_PLAN,
      [AC_WITH_CHECK],
    );
    expect(verdict.kind).toBe("ESCALATE");
  });
});

describe("the repair brief the floor produces", () => {
  it("tells the planner to reuse a goal criterion id, not to invent a check", () => {
    const failure = gateFailure(
      buildPlanVerdict(
        { kind: "PROCEED", rationale: "coherent" },
        DOGFOOD_120_PLAN,
        [AC_WITH_CHECK],
      ),
      DOGFOOD_120_PLAN,
    );

    expect(failure.kind).toBe("gate-revise");
    expect(failure.repairable).toBe(true);
    const gap = failure.machineGaps.find((entry) => entry.includes("N-2"));
    expect(gap).toBeDefined();
    expect(gap).toContain("no acceptance criterion with an executable `check`");
    expect(gap).toContain("Do not invent a check of your own.");
  });
});
