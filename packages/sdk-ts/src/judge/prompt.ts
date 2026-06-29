/**
 * Judge prompt construction (WP-131) — the second fold of JD-5's three-fold
 * diversity: the judge gets a different PROMPT REGIME from the executor.
 * No executor persona, no task-solving instructions — only the rubric, the
 * acceptance criteria, and the evidence. The third fold (different memory)
 * is the compacted evidence itself: step summaries, not the raw transcript.
 */
import type { AcceptanceCriterion, JudgeEvidence, Message } from "../types.js";
import type { CheckRun } from "./evidence.js";
import { MAX_CHECK_OUTPUT_CHARS } from "./evidence.js";
import type { RubricItem } from "./rubric.js";

const FORM_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["id", "pass", "justification"],
  properties: {
    id: { type: "string", minLength: 1 },
    pass: { type: "boolean" },
    justification: { type: "string" },
  },
} as const;

/** JSON Schema handed to the router as `responseSchema` — mirrors `JudgeForm`. */
export const JUDGE_FORM_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["criterionResults", "rubricResults", "concerns"],
  properties: {
    criterionResults: { type: "array", items: FORM_ITEM_SCHEMA },
    rubricResults: { type: "array", items: FORM_ITEM_SCHEMA },
    concerns: { type: "array", items: { type: "string" } },
  },
} as const;

export const JUDGE_SYSTEM_PROMPT = [
  "You are an independent code-review judge. You did not write this code and",
  "you have no stake in it passing. Your only job: answer each acceptance",
  "criterion and each rubric item with a binary pass/fail, justified strictly",
  "from the evidence provided (diff, check-command results, step summaries).",
  "",
  "Rules:",
  "- Reason step by step about each item before answering; put that reasoning",
  "  in the item's `justification` field.",
  "- pass=true only when the evidence shows it. Absence of evidence is fail,",
  "  not pass.",
  "- Never infer success from the executor's own claims in step summaries —",
  "  only from the diff and the check results.",
  "- `concerns` is for problems the rubric does not cover (suspicious but not",
  "  rubric-violating changes, ambiguous instructions). Leave it empty when",
  "  the rubric covers everything you found.",
  "- You do not choose what happens next; you only fill the form.",
  "",
  "Respond with a single JSON object matching the requested schema.",
].join("\n");

function renderCriteria(criteria: AcceptanceCriterion[]): string {
  if (criteria.length === 0) return "(none defined)";
  return criteria
    .map((c) => {
      const check = c.check
        ? ` [check command: \`${c.check}\` — its result is in CHECK RESULTS below]`
        : " [no check command — judge from the diff]";
      return `- ${c.id}: ${c.description}${check}`;
    })
    .join("\n");
}

function renderRubric(rubric: RubricItem[]): string {
  return rubric.map((r) => `- ${r.id}: ${r.description}`).join("\n");
}

function renderCheckRuns(checkRuns: CheckRun[]): string {
  if (checkRuns.length === 0) return "(no check commands were run)";
  return checkRuns
    .map((r) => {
      const out = r.output.trim();
      const bounded =
        out.length > MAX_CHECK_OUTPUT_CHARS
          ? `${out.slice(-MAX_CHECK_OUTPUT_CHARS)}\n… [head truncated]`
          : out;
      return [
        `### ${r.criterionId}: \`${r.command}\``,
        `exit code: ${r.exitCode} (${r.exitCode === 0 ? "PASS" : "FAIL"}), ${r.durationMs}ms`,
        bounded.length > 0 ? `\`\`\`\n${bounded}\n\`\`\`` : "(no output)",
      ].join("\n");
    })
    .join("\n\n");
}

function renderSecretScanLabels(labels: string[]): string {
  if (labels.length === 0) return "(none)";
  return labels.map((label) => `- ${label}`).join("\n");
}

function renderNewDependencyLabels(labels: string[]): string {
  if (labels.length === 0) return "(none)";
  return labels.map((label) => `- ${label}`).join("\n");
}

function renderHistory(history: Record<string, boolean[]>): string {
  const entries = Object.entries(history).filter(([, h]) => h.length > 0);
  if (entries.length === 0) return "(first judge pass of this run)";
  return entries
    .map(([id, h]) => `- ${id}: ${h.map((p) => (p ? "pass" : "fail")).join(" → ")}`)
    .join("\n");
}

export interface JudgePromptInput {
  goal: string;
  evidence: JudgeEvidence;
  rubric: RubricItem[];
  diffText: string;
  secretScanLabels: string[];
  newDependencyLabels: string[];
  checkRuns: CheckRun[];
}

export function buildJudgeMessages(input: JudgePromptInput): Message[] {
  const user = [
    "## GOAL the executor was given",
    input.goal,
    "",
    "## ACCEPTANCE CRITERIA (fill `criterionResults`, one entry per id)",
    renderCriteria(input.evidence.criteria),
    "",
    "## RUBRIC (fill `rubricResults`, one entry per id)",
    renderRubric(input.rubric),
    "",
    "## EVIDENCE — workspace diff since last verdict",
    input.diffText.length > 0 ? `\`\`\`diff\n${input.diffText}\n\`\`\`` : "(empty diff — no changes)",
    "",
    "## EVIDENCE — deterministic secret scan (added diff lines)",
    renderSecretScanLabels(input.secretScanLabels),
    "",
    "## EVIDENCE — deterministic new-dependency scan (added diff lines)",
    renderNewDependencyLabels(input.newDependencyLabels),
    "",
    "## EVIDENCE — CHECK RESULTS (judge-executed; exit 0 = pass)",
    renderCheckRuns(input.checkRuns),
    "",
    "## EVIDENCE — step summaries since last verdict (executor claims; do not trust)",
    input.evidence.stepSummaries.length > 0
      ? input.evidence.stepSummaries.map((s) => `- ${s}`).join("\n")
      : "(none)",
    "",
    "## CRITERIA HISTORY (per-criterion pass/fail across previous verdicts)",
    renderHistory(input.evidence.criteriaHistory),
  ].join("\n");

  return [
    { role: "system", content: JUDGE_SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}
