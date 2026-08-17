/**
 * Judge prompt construction (WP-131) — the second fold of JD-5's three-fold
 * diversity: the judge gets a different PROMPT REGIME from the executor.
 * No executor persona, no task-solving instructions — only the rubric, the
 * acceptance criteria, and the evidence. The third fold (different memory)
 * is the compacted evidence itself: step summaries, not the raw transcript.
 */
import type { AcceptanceCriterion, JudgeEvidence, Message } from "../types.js";
import type { CheckRun, DiffSection } from "./evidence.js";
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
    concernSeverities: {
      type: "array",
      items: { type: "string", enum: ["minor", "blocking"] },
    },
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
  "  the rubric covers everything you found. When non-empty, provide",
  "  `concernSeverities` with an index-aligned array of 'minor' (cosmetic /",
  "  advisory, does not stop the run) or 'blocking' (defect / unmet goal",
  "  requirement, stops the run).",
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

function renderArchitectureLabels(labels: string[]): string {
  if (labels.length === 0) return "(none)";
  return labels.map((label) => `- ${label}`).join("\n");
}

export function renderActiveWorkChunkScope(directive?: string): string {
  if (directive === undefined) return "";
  return [
    "## ACTIVE WORK CHUNK (this step's scope)",
    directive,
    "",
    "Judge this pass against the active work chunk above. Later parts of the",
    "overall goal that are absent from THIS step's diff are DEFERRED BY DESIGN",
    "and must NOT be treated as omissions for this judge pass.",
    "",
    // F-130 (dogfood-096): the scope answer must come from the diff's own
    // footprint — a front-loaded later part passed a self-description-based
    // scope check.
    "For `scope_matches_instruction`, compare the DIFF'S actual footprint (the",
    "files and symbols it adds or changes) against the active work chunk — not",
    "the executor's self-description. Work that implements a LATER part of the",
    "overall goal appearing in THIS step's diff is FRONT-LOADING: fail",
    "`scope_matches_instruction` and name the out-of-chunk files/symbols in the",
    "justification.",
    "",
    "For `design_serves_overall_goal`, judge the DESIGN QUALITY of the work",
    "present in this diff against the overall goal; later parts deferred to",
    "future chunks are NOT design flaws. This item is about how the present",
    "work is built, not whether it is complete.",
  ].join("\n");
}

/** Joins a chain plan's goal (+ optional node outline) into one overall-goal string. */
export function renderOverallGoalContext(planGoal: string, planOutline?: string[]): string {
  if (planOutline === undefined || planOutline.length === 0) return planGoal;
  return [
    planGoal,
    "",
    "Plan outline (sibling nodes):",
    ...planOutline.map((line) => `- ${line}`),
  ].join("\n");
}

/**
 * F-218: the chain node's declared write boundary, as the JUDGE must apply it.
 * The seal check is deterministic and terminal — a changed path outside the
 * boundary FAILS the node and discards its work — so a pass that greenlights an
 * out-of-boundary write is a pass that lets the node die later. On dogfood-120
 * `N-2` this rubric item PASSED at step 4 for `docs/reports/…` files, and the
 * seal then threw the node away.
 */
export function renderWriteBoundaryScope(writeBoundary?: string): string {
  if (writeBoundary === undefined || writeBoundary.length === 0) return "";
  return [
    "## WRITE BOUNDARY (deterministic — enforced when this node seals)",
    writeBoundary,
    "",
    "The executor was shown exactly this. A changed path outside the boundary is",
    "NOT a style question: fail `scope_matches_instruction` and name the offending",
    "paths in the justification, so the executor can move the file while the work",
    "is still recoverable.",
  ].join("\n");
}

export function renderOverallGoal(overallGoal?: string): string {
  if (overallGoal === undefined) return "";
  return [
    "## OVERALL GOAL (big picture)",
    overallGoal,
    "",
    "This run implements ONE PART of the overall goal above. Use it only to",
    "judge `design_serves_overall_goal`: whether the diff's design choices",
    "(placement, abstractions, interfaces, duplication vs reuse) add coherently",
    "to this bigger picture. Parts of the overall goal outside this run's own",
    "GOAL are other runs' work — their absence is NEVER a failure of any item.",
  ].join("\n");
}

function renderHistory(history: Record<string, boolean[]>): string {
  const entries = Object.entries(history).filter(([, h]) => h.length > 0);
  if (entries.length === 0) return "(first judge pass of this run)";
  return entries
    .map(([id, h]) => `- ${id}: ${h.map((p) => (p ? "pass" : "fail")).join(" → ")}`)
    .join("\n");
}

/**
 * Character budget for the out-of-rubric concerns section rendered into
 * the completion-review prompt (WP-631 / F-365).
 */
export const MAX_COMPLETION_REVIEW_CONCERNS_CHARS = 3072;

function clampText(text: string, maxLen: number): string {
  if (maxLen <= 0) return "";
  if (text.length <= maxLen) return text;
  if (maxLen === 1) return "…";
  return `${text.slice(0, maxLen - 1)}…`;
}

/**
 * Clamps ONE finding and says out loud that it did (F-371, dogfood-149).
 *
 * A bare `…` is an elision with no count: the reader cannot tell a finding that
 * ended from one whose substance was cut. The whole point of the WP-631 bound is
 * that nothing leaves the evidence path silently, so a truncated finding carries
 * the exact number of characters removed, the same way an omitted finding carries
 * the exact count omitted. Falls back to the bare clamp only when `maxLen` has no
 * room for the notice — the character bound always wins.
 */
function clampFinding(text: string, maxLen: number): string {
  if (maxLen <= 0) return "";
  if (text.length <= maxLen) return text;
  const note = (omitted: number): string => ` … [truncated, ${omitted} chars omitted]`;
  // The notice length depends on the digit count of the omitted total, which depends
  // on the notice length. Two passes reach the fixed point for any realistic input;
  // the length check below is the actual guarantee.
  let keep = maxLen - note(text.length).length;
  for (let pass = 0; pass < 2 && keep > 0; pass++) {
    keep = maxLen - note(text.length - keep).length;
  }
  if (keep <= 0) return clampText(text, maxLen);
  const out = `${text.slice(0, keep)}${note(text.length - keep)}`;
  return out.length <= maxLen ? out : clampText(text, maxLen);
}

/**
 * Renders the out-of-rubric concerns section for completion review with a strict
 * character budget. When the accumulated findings exceed `maxChars`, the oldest
 * and newest findings survive intact (in full, never per-entry truncated when they
 * fit within the budget), while middle findings are omitted and replaced by an
 * explicit elision notice containing the exact count left out. If individual
 * findings are so large that even the oldest and newest endpoints exceed `maxChars`,
 * they are deterministically clamped to guarantee that the rendered output strictly
 * satisfies `lines.join("\n").length <= maxChars`.
 *
 * PRECEDENCE, settled by the dogfood-149 review (F-370): the character bound is
 * absolute and the intact-endpoints rule is conditional on there being room for it.
 * The two cannot both hold when the oldest and newest findings alone exceed
 * `maxChars`, and an unbounded prompt is the defect this function exists to close,
 * so BOUNDED WINS — but the clamp must announce itself (`clampFinding`), because a
 * silently shortened finding is evidence dropped without a trace (F-364).
 */
export function renderCompletionReviewConcerns(
  concerns: readonly string[],
  maxChars: number = MAX_COMPLETION_REVIEW_CONCERNS_CHARS,
): string[] {
  if (concerns.length === 0 || maxChars <= 0) return [];
  const header = "### Out-of-rubric concerns to adjudicate against the cumulative diff:";

  // Check if all concerns fit without any elision
  const allLines = [header, ...concerns.map((c) => `- ${c}`)];
  if (allLines.join("\n").length <= maxChars) {
    return allLines;
  }

  // Single concern that exceeds maxChars: clamp the concern text to fit within maxChars
  if (concerns.length === 1) {
    const available = maxChars - header.length - 1 - 2; // for '\n' and '- '
    if (available <= 0) {
      return [clampText(header, maxChars)];
    }
    return [header, `- ${clampFinding(concerns[0], available)}`];
  }

  // Multiple concerns: keep oldest and newest intact when possible, eliding middle items.
  const buildLines = (hEnd: number, tStart: number): string[] => {
    const omitted = tStart - hEnd - 1;
    const lines = [header];
    for (let i = 0; i <= hEnd; i++) {
      lines.push(`- ${concerns[i]}`);
    }
    if (omitted > 0) {
      lines.push(`- … [${omitted} finding${omitted === 1 ? "" : "s"} omitted]`);
    }
    for (let i = tStart; i < concerns.length; i++) {
      lines.push(`- ${concerns[i]}`);
    }
    return lines;
  };

  // If the base representation (oldest + elision + newest) fits within maxChars,
  // greedily expand headEnd and tailStart to include as many intact findings as possible.
  const baseLines = buildLines(0, concerns.length - 1);
  if (baseLines.join("\n").length <= maxChars) {
    let headEnd = 0;
    let tailStart = concerns.length - 1;
    while (tailStart - headEnd > 1) {
      const candidateHead = buildLines(headEnd + 1, tailStart);
      if (candidateHead.join("\n").length <= maxChars) {
        headEnd++;
        continue;
      }
      const candidateTail = buildLines(headEnd, tailStart - 1);
      if (candidateTail.join("\n").length <= maxChars) {
        tailStart--;
        continue;
      }
      break;
    }
    return buildLines(headEnd, tailStart);
  }

  // If even the base representation exceeds maxChars (e.g. oldest or newest is individually huge),
  // retain the structure (oldest, elision notice if any, newest) while clamping the oversized endpoints.
  const omitted = concerns.length - 2;
  const elisionLine =
    omitted > 0 ? `- … [${omitted} finding${omitted === 1 ? "" : "s"} omitted]` : undefined;
  const fixedOverhead =
    header.length +
    1 + // '\n'
    2 + // '- '
    (elisionLine !== undefined ? 1 + elisionLine.length : 0) +
    1 + // '\n'
    2; // '- '
  const available = Math.max(0, maxChars - fixedOverhead);

  const oldest = concerns[0];
  const newest = concerns[concerns.length - 1];

  let oldestBudget = Math.floor(available / 2);
  let newestBudget = available - oldestBudget;

  if (oldest.length < oldestBudget) {
    newestBudget = available - oldest.length;
    oldestBudget = oldest.length;
  } else if (newest.length < newestBudget) {
    oldestBudget = available - newest.length;
    newestBudget = newest.length;
  }

  const boundedOldest = clampFinding(oldest, oldestBudget);
  const boundedNewest = clampFinding(newest, newestBudget);

  const lines = [
    header,
    `- ${boundedOldest}`,
    ...(elisionLine !== undefined ? [elisionLine] : []),
    `- ${boundedNewest}`,
  ];

  const joined = lines.join("\n");
  if (joined.length <= maxChars) {
    return lines;
  }
  return [clampText(joined, maxChars)];
}

function renderCompletionReviewScope(escalationConcerns?: string[]): string {
  const hasConcerns = escalationConcerns !== undefined && escalationConcerns.length > 0;
  // F-340 (dogfood-140): the adjudication sentence and its rubric row appear
  // TOGETHER or not at all. A concern-less review that is told it "adjudicates
  // out-of-rubric concerns" is being asked a question with no subject and no
  // row to answer in, and a ✗ on that row condemns a converged run.
  // F-344 (dogfood-141): the adjudication standard below is part of the
  // charter, not the runner — the runner never reads a concern's text (the
  // WP-619 invariant), so the only place to keep an un-answerable concern
  // class from condemning every honest run is the question the judge is asked.
  const charter = hasConcerns
    ? [
        "This pass judges whether the run's cumulative changes form a coherent",
        "design in service of the goal, and adjudicates the out-of-rubric concerns",
        "listed below.",
        "Adjudication standard: UPHOLD a concern only if you can point at a real",
        "defect, regression, or unfulfilled requirement in the DELIVERED work,",
        "evidenced by the cumulative diff or a failing trusted check in this pass.",
        "A concern that process evidence is MISSING — e.g. the executor never",
        "showed it ran its own verification commands — is not a defect in the",
        "delivery: it is answered by this pass's trusted evidence, and when the",
        "judge-executed checks and the declared regression suite are green, that",
        "concern is CLEARED.",
      ]
    : [
        "This pass judges ONLY whether the run's cumulative changes form a coherent",
        "design in service of the goal.",
      ];
  const lines = [
    "## REVIEW SCOPE — run-completion architecture review",
    "Every acceptance criterion has already been confirmed by a previous pass.",
    ...charter,
    "Express every finding through the rubric",
    "items; leave `concerns` empty — process concerns were already handled by",
    "the per-step passes.",
  ];
  if (hasConcerns) {
    lines.push(
      "",
      ...renderCompletionReviewConcerns(escalationConcerns),
    );
  }
  return lines.join("\n");
}

function renderDiffEvidence(
  diffText: string,
  diffSections: DiffSection[],
  reviewScope?: "incremental" | "cumulative",
): string[] {
  const cumulative = reviewScope === "cumulative";
  if (diffSections.length === 0) {
    return [
      cumulative
        ? "## EVIDENCE — CUMULATIVE workspace diff for the ENTIRE run (base → final state)"
        : "## EVIDENCE — workspace diff since last verdict",
      diffText.length > 0 ? `\`\`\`diff\n${diffText}\n\`\`\`` : "(empty diff — no changes)",
    ];
  }

  return [
    cumulative
      ? "## EVIDENCE — CUMULATIVE workspace diffs for the ENTIRE run (base → final state, per writable repo)"
      : "## EVIDENCE — workspace diffs since last verdict (per writable repo)",
    ...diffSections.flatMap((section) => [
      "",
      `### repo \`${section.repoName}\` (${section.relativePath})`,
      section.diffText.length > 0
        ? `\`\`\`diff\n${section.diffText}\n\`\`\``
        : "(empty diff — no changes)",
    ]),
  ];
}

export interface JudgePromptInput {
  goal: string;
  /** Big-picture context (e.g. the chain plan's goal) distinct from `goal`. */
  overallGoal?: string;
  /** The chain node's declared write boundary, rendered (F-218). */
  writeBoundary?: string;
  evidence: JudgeEvidence;
  rubric: RubricItem[];
  diffText: string;
  diffSections?: DiffSection[];
  secretScanLabels: string[];
  newDependencyLabels: string[];
  architectureLabels: string[];
  checkRuns: CheckRun[];
  activeWorkChunkDirective?: string;
  /** "cumulative" marks the run-completion review over the whole-run diff. */
  reviewScope?: "incremental" | "cumulative";
  /** Out-of-rubric concerns raised by earlier passes to adjudicate in completion review. */
  escalationConcerns?: string[];
}

export function buildJudgeMessages(input: JudgePromptInput): Message[] {
  const overallGoal = renderOverallGoal(input.overallGoal);
  const writeBoundaryScope = renderWriteBoundaryScope(input.writeBoundary);
  const activeWorkChunkScope = renderActiveWorkChunkScope(input.activeWorkChunkDirective);
  const user = [
    "## GOAL the executor was given",
    input.goal,
    ...(overallGoal.length > 0 ? ["", overallGoal] : []),
    ...(activeWorkChunkScope.length > 0 ? ["", activeWorkChunkScope] : []),
    ...(writeBoundaryScope.length > 0 ? ["", writeBoundaryScope] : []),
    ...(input.reviewScope === "cumulative"
      ? ["", renderCompletionReviewScope(input.escalationConcerns)]
      : []),
    // F-341 (dogfood-140): a per-step branch rendering these concerns used to sit
    // here. No caller can reach it — `escalationConcerns` is only ever set on a
    // `completionReview: true` judge pass, and that always sets
    // `reviewScope: "cumulative"` (activities.ts). Removed rather than left as an
    // untested second rendering path.
    "",
    "## ACCEPTANCE CRITERIA (fill `criterionResults`, one entry per id)",
    renderCriteria(input.evidence.criteria),
    "",
    "## RUBRIC (fill `rubricResults`, one entry per id)",
    renderRubric(input.rubric),
    "",
    ...renderDiffEvidence(input.diffText, input.diffSections ?? [], input.reviewScope),
    "",
    "## EVIDENCE — deterministic secret scan (added diff lines)",
    renderSecretScanLabels(input.secretScanLabels),
    "",
    "## EVIDENCE — deterministic new-dependency scan (added diff lines)",
    renderNewDependencyLabels(input.newDependencyLabels),
    "",
    "## EVIDENCE — deterministic architecture scan (added diff lines)",
    renderArchitectureLabels(input.architectureLabels),
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
