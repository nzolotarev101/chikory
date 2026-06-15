import { describe, expect, it } from "vitest";

import {
  buildPlannerMessages,
  PLANNER_SYSTEM_PROMPT,
  PLAN_RESPONSE_SCHEMA,
} from "../../src/planner/prompt.js";
import type { PlanInput } from "../../src/types.js";

const input: PlanInput = {
  goal: "Ship a reliable goal planner",
  acceptanceCriteria: [
    { id: "AC-1", description: "Every criterion is assigned to a node" },
    { id: "AC-2", description: "Node budgets stay within the chain budget" },
  ],
  budgetUsd: 12.5,
  family: "anthropic",
};

describe("planner prompt (WP-219 S2, ADR-005 D1)", () => {
  it("builds system and user messages in order", () => {
    const messages = buildPlannerMessages(input);

    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.role)).toEqual(["system", "user"]);
    expect(messages[0]?.content).toBe(PLANNER_SYSTEM_PROMPT);
  });

  it("renders the goal, criteria, and chain budget", () => {
    const userContent = buildPlannerMessages(input)[1]?.content;

    expect(userContent).toContain(input.goal);
    for (const criterion of input.acceptanceCriteria) {
      expect(userContent).toContain(criterion.id);
      expect(userContent).toContain(criterion.description);
    }
    expect(userContent).toContain(String(input.budgetUsd));
  });

  it("renders a placeholder when no acceptance criteria are defined", () => {
    const messages = buildPlannerMessages({ ...input, acceptanceCriteria: [] });

    expect(messages[1]?.content).toContain("(none defined)");
  });

  it("requires nodes and every PlanNode field in the response schema", () => {
    expect(PLAN_RESPONSE_SCHEMA.required).toContain("nodes");
    expect(PLAN_RESPONSE_SCHEMA.properties.nodes.items.required).toEqual([
      "id",
      "goal",
      "acceptanceCriteria",
      "dependsOn",
      "budgetUsd",
    ]);
  });
});
