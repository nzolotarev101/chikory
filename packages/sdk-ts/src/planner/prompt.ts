import type { AcceptanceCriterion, Message, PlanInput } from "../types.js";

/** Pure planner system prompt for WP-219 S2 and ADR-005 D1. */
export const PLANNER_SYSTEM_PROMPT: string = [
  "You are a goal decomposer. Break the user's goal into an ordered dependency",
  "tree of judge-gated slices.",
  "",
  "Rules:",
  "- Each node must be a self-contained 1–3-step brief that becomes a child",
  "  run's goal.",
  "- EVERY node must produce a concrete code change (a non-empty diff). Do NOT",
  "  emit verification-only, testing-only, or review-only nodes (e.g. a final",
  "  \"verify tests/typecheck/lint pass\" node): each node is already independently",
  "  judge-gated and its acceptance `check`s are run automatically by the judge,",
  "  so a node with no diff of its own has nothing to deliver and cannot pass.",
  "  Fold the tests and verification for a change INTO the same node that makes",
  "  the change.",
  "- Every goal acceptance criterion must be covered by at least one node. A node",
  "  COVERS a goal acceptance criterion ONLY by including, in its own",
  "  `acceptanceCriteria`, an entry whose `id` is EXACTLY that goal criterion's",
  "  id — copy the id verbatim (e.g. a node covering `AC-1` must contain an",
  "  acceptance criterion with `id: \"AC-1\"`). Coverage is matched by id, not by",
  "  wording: a renamed or paraphrased id is NOT detected and the whole plan is",
  "  rejected. You MAY add extra node-specific criteria with new ids, but the id",
  "  of every goal criterion must appear on the node(s) that cover it, and across",
  "  all nodes every goal criterion id must appear at least once.",
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
    "Reuse each id below VERBATIM on the node(s) that cover it (coverage is",
    "matched by id, not wording).",
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
