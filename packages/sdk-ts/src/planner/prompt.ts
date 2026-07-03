import type { AcceptanceCriterion, Message, PlanInput } from "../types.js";

/** Pure planner system prompt for WP-219 S2 and ADR-005 D1. */
export const PLANNER_SYSTEM_PROMPT: string = [
  "You are a goal decomposer. Break the user's goal into an ordered dependency",
  "tree of judge-gated slices.",
  "",
  "Rules:",
  "- Each node must be a self-contained 1–3-step brief that becomes a child",
  "  run's goal.",
  "- DECOMPOSE. Prefer the FINEST decomposition where each node is ONE",
  "  independently-shippable, judge-gated slice with its own non-empty diff. A",
  "  single-node plan is valid ONLY for a genuinely atomic goal that cannot be",
  "  split into two independently-verifiable changes. When the goal enumerates",
  "  multiple deliverables / outcomes (e.g. a bulleted list, or \"first X, then",
  "  Y, then Z\"), emit ONE node per deliverable, ordered by dependency — do NOT",
  "  collapse them into a single omnibus node. Worked example: a goal \"add a",
  "  store, an overflow tier, and a query API\" becomes three nodes N-1 (store) →",
  "  N-2 (overflow, dependsOn N-1) → N-3 (query, dependsOn N-2), each with its",
  "  own diff and tests.",
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
  "- Copy a covered goal criterion's description and executable `check` verbatim.",
  "  Do not translate package managers, paths, flags, or working directories.",
  "- `dependsOn` lists the ids of nodes that must reach SUCCESS before the node",
  "  can start.",
  "- `writeSet` lists every repo-relative file path the node may create, modify,",
  "  rename, or delete. Use exact POSIX paths, not globs or directories. Chikory",
  "  deterministically serializes otherwise-independent nodes whose write sets",
  "  overlap, and rejects runtime writes outside the declared set.",
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
        required: ["id", "goal", "acceptanceCriteria", "dependsOn", "writeSet", "budgetUsd"],
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
          writeSet: { type: "array", minItems: 1, items: { type: "string" } },
          budgetUsd: { type: "number" },
        },
      },
    },
  },
} as const;

function renderCriteria(criteria: AcceptanceCriterion[]): string {
  if (criteria.length === 0) return "(none defined)";
  return criteria
    .map((criterion) =>
      [
        `- ${criterion.id}: ${criterion.description}`,
        ...(criterion.check === undefined ? [] : [`  check: ${criterion.check}`]),
      ].join("\n"),
    )
    .join("\n");
}

/** Builds pure planner messages for WP-219 S2 and ADR-005 D1. */
export function buildPlannerMessages(input: PlanInput): Message[] {
  const user = [
    "## GOAL to decompose",
    input.goal,
    "",
    ...(input.minNodes !== undefined
      ? [
          "## MINIMUM DECOMPOSITION",
          `Emit AT LEAST ${input.minNodes} nodes; a coarser plan is rejected.`,
          "",
        ]
      : []),
    "## ACCEPTANCE CRITERIA the plan must cover",
    "Reuse each id below VERBATIM on the node(s) that cover it (coverage is",
    "matched by id, not wording). Copy each description and check verbatim too.",
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
