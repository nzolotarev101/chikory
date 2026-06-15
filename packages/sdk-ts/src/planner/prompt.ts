import type { AcceptanceCriterion, Message, PlanInput } from "../types.js";

/** Pure planner system prompt for WP-219 S2 and ADR-005 D1. */
export const PLANNER_SYSTEM_PROMPT: string = [
  "You are a goal decomposer. Break the user's goal into an ordered dependency",
  "tree of judge-gated slices.",
  "",
  "Rules:",
  "- Each node must be a self-contained 1–3-step brief that becomes a child",
  "  run's goal.",
  "- Every goal acceptance criterion must be covered by at least one node.",
  "- `dependsOn` lists the ids of nodes that must reach SUCCESS before the node",
  "  can start.",
  "- Per-node `budgetUsd` values must sum to at most the chain budget.",
  "",
  "Respond with a single JSON object matching the requested schema.",
].join("\n");

/** Pure planner response schema for WP-219 S2 and ADR-005 D1. */
export const PLAN_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["nodes"],
  properties: {
    nodes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "goal", "acceptanceCriteria", "dependsOn", "budgetUsd"],
        properties: {
          id: { type: "string", minLength: 1 },
          goal: { type: "string" },
          acceptanceCriteria: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "description"],
              properties: {
                id: { type: "string", minLength: 1 },
                description: { type: "string" },
                check: { type: "string" },
              },
            },
          },
          dependsOn: { type: "array", items: { type: "string" } },
          budgetUsd: { type: "number" },
        },
      },
    },
  },
} as const;

function renderCriteria(criteria: AcceptanceCriterion[]): string {
  if (criteria.length === 0) return "(none defined)";
  return criteria.map((criterion) => `- ${criterion.id}: ${criterion.description}`).join("\n");
}

/** Builds pure planner messages for WP-219 S2 and ADR-005 D1. */
export function buildPlannerMessages(input: PlanInput): Message[] {
  const user = [
    "## GOAL to decompose",
    input.goal,
    "",
    "## ACCEPTANCE CRITERIA the plan must cover",
    renderCriteria(input.acceptanceCriteria),
    "",
    "## CHAIN BUDGET (node `budgetUsd` values must sum within this amount)",
    String(input.budgetUsd),
  ].join("\n");

  return [
    { role: "system", content: PLANNER_SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}
