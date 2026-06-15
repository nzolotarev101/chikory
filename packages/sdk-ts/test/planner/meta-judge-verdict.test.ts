import { describe, expect, it } from "vitest";

import {
  buildPlanVerdict,
  type PlanJudgeReply,
} from "../../src/planner/meta-judge-verdict.js";
import type { AcceptanceCriterion, Plan } from "../../src/types.js";

const plan: Plan = {
  id: "plan-219",
  goal: "Ship a validated plan",
  nodes: [
    {
      id: "N-1",
      goal: "Implement the first plan slice",
      acceptanceCriteria: [{ id: "AC-1", description: "The first slice is complete" }],
      dependsOn: [],
      budgetUsd: 1,
    },
    {
      id: "N-2",
      goal: "Implement the second plan slice",
      acceptanceCriteria: [{ id: "AC-2", description: "The second slice is complete" }],
      dependsOn: ["N-1"],
      budgetUsd: 1,
    },
  ],
  createdAt: "2026-06-15T12:00:00.000Z",
};

const goalCriteria: AcceptanceCriterion[] = [
  { id: "AC-1", description: "The first slice is complete" },
  { id: "AC-2", description: "The second slice is complete" },
];

describe("buildPlanVerdict (WP-219 S2b, ADR-005 D2)", () => {
  it("passes through a PROCEED reply when coverage is complete", () => {
    const reply: PlanJudgeReply = { kind: "PROCEED", rationale: "The plan is sound." };

    const verdict = buildPlanVerdict(reply, plan, goalCriteria);

    expect(verdict.kind).toBe("PROCEED");
    expect(verdict.uncoveredCriteria).toEqual([]);
    expect(verdict.rationale).toBe(reply.rationale);
  });

  it("downgrades PROCEED to REVISE when coverage has a gap", () => {
    const reply: PlanJudgeReply = { kind: "PROCEED", rationale: "The plan is sound." };
    const criteriaWithGap: AcceptanceCriterion[] = [
      ...goalCriteria,
      { id: "AC-3", description: "The uncovered requirement is complete" },
    ];

    const verdict = buildPlanVerdict(reply, plan, criteriaWithGap);

    expect(verdict.kind).toBe("REVISE");
    expect(verdict.uncoveredCriteria).toEqual(["AC-3"]);
    expect(verdict.rationale).toContain("AC-3");
  });

  it("preserves a non-PROCEED reply when coverage is complete", () => {
    const reply: PlanJudgeReply = {
      kind: "ESCALATE",
      rationale: "The plan needs human review.",
    };

    const verdict = buildPlanVerdict(reply, plan, goalCriteria);

    expect(verdict.kind).toBe("ESCALATE");
    expect(verdict.rationale).toBe(reply.rationale);
  });

  it("returns exactly the PlanVerdict fields", () => {
    const verdict = buildPlanVerdict(
      { kind: "PROCEED", rationale: "The plan is sound." },
      plan,
      goalCriteria,
    );

    expect(Object.keys(verdict).sort()).toEqual(["kind", "rationale", "uncoveredCriteria"]);
  });

  it("does not mutate its inputs", () => {
    const reply: PlanJudgeReply = { kind: "PROCEED", rationale: "The plan is sound." };
    const originalReply = { ...reply };
    const originalNodeCount = plan.nodes.length;
    const originalCriteriaCount = goalCriteria.length;

    buildPlanVerdict(reply, plan, goalCriteria);

    expect(reply).toEqual(originalReply);
    expect(plan.nodes).toHaveLength(originalNodeCount);
    expect(goalCriteria).toHaveLength(originalCriteriaCount);
  });
});
