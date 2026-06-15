import { describe, expect, it } from "vitest";

import {
  buildPlanJudgeMessages,
  PLAN_JUDGE_SYSTEM_PROMPT,
  PLAN_VERDICT_RESPONSE_SCHEMA,
} from "../../src/planner/meta-judge-prompt.js";
import type { AcceptanceCriterion, Plan } from "../../src/types.js";

const plan: Plan = {
  id: "plan-219",
  goal: "Ship a sound plan meta-judge prompt regime",
  nodes: [
    {
      id: "N-1",
      goal: "Implement the pure plan-judge prompt builder",
      acceptanceCriteria: [
        { id: "AC-1", description: "The builder returns system and user messages" },
      ],
      dependsOn: [],
      budgetUsd: 2.5,
    },
    {
      id: "N-2",
      goal: "Verify the prompt schema and rendering",
      acceptanceCriteria: [
        { id: "AC-2", description: "The schema exposes every verdict kind" },
      ],
      dependsOn: ["N-1"],
      budgetUsd: 1.5,
    },
  ],
  createdAt: "2026-06-15T12:00:00.000Z",
};

const goalCriteria: AcceptanceCriterion[] = [
  { id: "AC-1", description: "The builder returns system and user messages" },
  { id: "AC-2", description: "The schema exposes every verdict kind" },
];

describe("plan meta-judge prompt (WP-219 S2b, ADR-005 D2)", () => {
  it("builds system and user messages in order", () => {
    const messages = buildPlanJudgeMessages({ plan, goalCriteria });

    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.role)).toEqual(["system", "user"]);
    expect(messages[0]?.content).toBe(PLAN_JUDGE_SYSTEM_PROMPT);
  });

  it("renders the plan goal, goal criteria, nodes, and node budget", () => {
    const userContent = buildPlanJudgeMessages({ plan, goalCriteria })[1]?.content;

    expect(userContent).toContain(plan.goal);
    for (const criterion of goalCriteria) {
      expect(userContent).toContain(criterion.id);
    }
    for (const node of plan.nodes) {
      expect(userContent).toContain(node.id);
    }
    expect(userContent).toContain(String(plan.nodes[0]?.budgetUsd));
  });

  it("renders a placeholder when no goal acceptance criteria are defined", () => {
    const messages = buildPlanJudgeMessages({ plan, goalCriteria: [] });

    expect(messages[1]?.content).toContain("(none defined)");
  });

  it("defines the complete plan verdict response schema", () => {
    expect(PLAN_VERDICT_RESPONSE_SCHEMA.required).toContain("kind");
    expect(PLAN_VERDICT_RESPONSE_SCHEMA.required).toContain("rationale");
    expect(PLAN_VERDICT_RESPONSE_SCHEMA.required).toContain("uncoveredCriteria");
    expect(PLAN_VERDICT_RESPONSE_SCHEMA.properties.kind.enum).toEqual([
      "PROCEED",
      "REVISE",
      "ESCALATE",
    ]);
  });

  it("does not mutate the input plan", () => {
    const originalNodeCount = plan.nodes.length;

    buildPlanJudgeMessages({ plan, goalCriteria });

    expect(plan.nodes).toHaveLength(originalNodeCount);
  });
});
