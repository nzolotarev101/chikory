import type { AcceptanceCriterion, Message, Plan, PlanNode } from "../types.js";

/** Pure plan-verdict response schema for WP-219 S2b and ADR-005 D2. */
export const PLAN_VERDICT_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "rationale", "uncoveredCriteria"],
  properties: {
    kind: {
      type: "string",
      enum: ["PROCEED", "REVISE", "ESCALATE"],
    },
    rationale: { type: "string" },
    uncoveredCriteria: {
      type: "array",
      items: { type: "string" },
    },
  },
} as const;

/** Pure plan meta-judge system prompt for WP-219 S2b and ADR-005 D2. */
export const PLAN_JUDGE_SYSTEM_PROMPT: string = [
  "You are an INDEPENDENT plan reviewer. You did not write this plan and",
  "you have no stake in it passing. Your only job is to judge whether the",
  "decomposed plan is a sound, complete decomposition of the goal: every goal",
  "acceptance criterion is covered by at least one node, dependencies are",
  "coherent, and node scopes are self-contained.",
  "",
  "Choose exactly one verdict `kind`:",
  "- `PROCEED`: the plan is sound; run it.",
  "- `REVISE`: the plan has fixable structural or coverage gaps; re-plan.",
  "- `ESCALATE`: the plan is ambiguous or unsound enough to need a human.",
  "",
  "Rules:",
  "- Reason before answering and put that reasoning in `rationale`.",
  "- List in `uncoveredCriteria` every goal criterion id that no node covers.",
  "  Leave `uncoveredCriteria` empty on `PROCEED`.",
  "- Do not judge code or implementation quality; no diff is in scope. Judge",
  "  only the plan's structure and coverage.",
  "",
  "Respond with a single JSON object matching the requested schema.",
].join("\n");

/** Pure plan-review input for WP-219 S2b and ADR-005 D2. */
export interface PlanJudgePromptInput {
  plan: Plan;
  goalCriteria: AcceptanceCriterion[];
}

function renderCriteria(criteria: AcceptanceCriterion[]): string {
  if (criteria.length === 0) return "(none defined)";
  return criteria.map((criterion) => `- ${criterion.id}: ${criterion.description}`).join("\n");
}

function renderPlanNode(node: PlanNode): string {
  return [
    `### ${node.id}`,
    `goal: ${node.goal}`,
    `dependsOn: ${node.dependsOn.length > 0 ? node.dependsOn.join(", ") : "(none)"}`,
    `budgetUsd: ${String(node.budgetUsd)}`,
    `acceptanceCriteria: ${node.acceptanceCriteria.map((criterion) => criterion.id).join(", ")}`,
  ].join("\n");
}

function renderPlanNodes(nodes: PlanNode[]): string {
  return nodes.map(renderPlanNode).join("\n\n");
}

/** Builds pure plan meta-judge messages for WP-219 S2b and ADR-005 D2. */
export function buildPlanJudgeMessages(input: PlanJudgePromptInput): Message[] {
  const user = [
    "## GOAL the plan must decompose",
    input.plan.goal,
    "",
    "## GOAL ACCEPTANCE CRITERIA the plan must cover",
    renderCriteria(input.goalCriteria),
    "",
    "## PLAN NODES",
    renderPlanNodes(input.plan.nodes),
  ].join("\n");

  return [
    { role: "system", content: PLAN_JUDGE_SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}
