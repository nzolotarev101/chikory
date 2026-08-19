/**
 * Unit tests for judge prompt rendering functions and message construction (packages/sdk-ts/src/judge/prompt.ts).
 */
import { describe, expect, it } from "vitest";

import {
  buildJudgeMessages,
  JUDGE_FORM_RESPONSE_SCHEMA,
  JUDGE_SYSTEM_PROMPT,
  renderActiveWorkChunkScope,
  renderCompletionReviewConcerns,
  renderOverallGoal,
  renderOverallGoalContext,
  renderWriteBoundaryScope,
  type JudgePromptInput,
} from "../../src/judge/prompt.js";
import { MAX_CHECK_OUTPUT_CHARS } from "../../src/judge/evidence.js";

function makeInput(overrides: Partial<JudgePromptInput> = {}): JudgePromptInput {
  return {
    goal: "Implement feature X",
    evidence: {
      diffRefs: [],
      criteria: [
        { id: "c1", description: "Criterion 1 with check", check: "npm test" },
        { id: "c2", description: "Criterion 2 without check" },
      ],
      criteriaHistory: {
        c1: [true, false, true],
        c2: [],
      },
      stepSummaries: ["Step 1 summary", "Step 2 summary"],
      artifacts: [],
    },
    rubric: [
      { id: "r1", description: "Rubric item 1", destructive: false },
      { id: "r2", description: "Rubric item 2", destructive: false },
    ],
    diffText: "diff --git a/file.ts b/file.ts\n+const x = 1;",
    secretScanLabels: ["label1"],
    newDependencyLabels: ["dep1"],
    architectureLabels: ["arch1"],
    checkRuns: [
      {
        criterionId: "c1",
        command: "npm test",
        exitCode: 0,
        output: "Tests passed successfully",
        durationMs: 150,
        infraFailed: false,
      },
      {
        criterionId: "c2",
        command: "npm run lint",
        exitCode: 1,
        output: "Linter found 1 error",
        durationMs: 80,
        infraFailed: false,
      },
    ],
    ...overrides,
  };
}

describe("renderActiveWorkChunkScope", () => {
  it("returns empty string when directive is undefined", () => {
    expect(renderActiveWorkChunkScope(undefined)).toBe("");
  });

  it("renders active work chunk scope header and directive instructions when provided", () => {
    const directive = "Implement component parser";
    const result = renderActiveWorkChunkScope(directive);
    expect(result).toContain("## ACTIVE WORK CHUNK (this step's scope)");
    expect(result).toContain(directive);
    expect(result).toContain("DEFERRED BY DESIGN");
    expect(result).toContain("scope_matches_instruction");
    expect(result).toContain("design_serves_overall_goal");
  });
});

describe("renderOverallGoalContext", () => {
  it("returns planGoal directly when planOutline is undefined or empty", () => {
    expect(renderOverallGoalContext("Goal text")).toBe("Goal text");
    expect(renderOverallGoalContext("Goal text", [])).toBe("Goal text");
  });

  it("appends planOutline formatted as a bulleted list", () => {
    const result = renderOverallGoalContext("Main goal", ["Node A", "Node B"]);
    expect(result).toBe("Main goal\n\nPlan outline (sibling nodes):\n- Node A\n- Node B");
  });
});

describe("renderWriteBoundaryScope", () => {
  it("returns empty string when writeBoundary is undefined or empty", () => {
    expect(renderWriteBoundaryScope(undefined)).toBe("");
    expect(renderWriteBoundaryScope("")).toBe("");
  });

  it("renders write boundary header and path enforcement instructions", () => {
    const boundary = "- src/allowed.ts";
    const result = renderWriteBoundaryScope(boundary);
    expect(result).toContain("## WRITE BOUNDARY (deterministic — enforced when this node seals)");
    expect(result).toContain("- src/allowed.ts");
    expect(result).toContain("fail `scope_matches_instruction`");
  });
});

describe("renderOverallGoal", () => {
  it("returns empty string when overallGoal is undefined", () => {
    expect(renderOverallGoal(undefined)).toBe("");
  });

  it("renders overall goal header and instructions when overallGoal is provided", () => {
    const result = renderOverallGoal("Build complete SDK");
    expect(result).toContain("## OVERALL GOAL (big picture)");
    expect(result).toContain("Build complete SDK");
    expect(result).toContain("design_serves_overall_goal");
  });
});

describe("renderCompletionReviewConcerns", () => {
  it("returns empty array when concerns is empty or maxChars <= 0", () => {
    expect(renderCompletionReviewConcerns([])).toEqual([]);
    expect(renderCompletionReviewConcerns(["Some concern"], 0)).toEqual([]);
    expect(renderCompletionReviewConcerns(["Some concern"], -10)).toEqual([]);
  });

  it("returns header and all concerns intact when everything fits within maxChars", () => {
    const concerns = ["Concern 1", "Concern 2"];
    const result = renderCompletionReviewConcerns(concerns, 1000);
    expect(result).toEqual([
      "### Out-of-rubric concerns to adjudicate against the cumulative diff:",
      "- Concern 1",
      "- Concern 2",
    ]);
  });

  it("handles a single concern that exceeds maxChars by clamping it", () => {
    const longConcern = "A".repeat(200);
    const maxChars = 100;
    const result = renderCompletionReviewConcerns([longConcern], maxChars);
    expect(result.length).toBe(2);
    expect(result[0]).toBe("### Out-of-rubric concerns to adjudicate against the cumulative diff:");
    expect(result[1]).toContain("…");
    expect(result.join("\n").length).toBeLessThanOrEqual(maxChars);
  });

  it("handles a single concern when available budget for body is <= 0", () => {
    const longConcern = "A".repeat(200);
    const maxChars = 50; // Less than header length, forcing clampText on header
    const result = renderCompletionReviewConcerns([longConcern], maxChars);
    expect(result.length).toBe(1);
    expect(result[0]).toContain("…");
    expect(result[0].length).toBeLessThanOrEqual(maxChars);
  });

  it("elides middle concerns when multiple concerns exceed budget", () => {
    const concerns = [
      "Oldest concern that should be preserved",
      "Middle concern 1",
      "Middle concern 2",
      "Middle concern 3",
      "Newest concern that should be preserved",
    ];
    // Give budget that fits header + oldest + elision + newest (182 chars), but not all middle ones (214 chars)
    const maxChars = 190;
    const result = renderCompletionReviewConcerns(concerns, maxChars);

    expect(result).toContain("- Oldest concern that should be preserved");
    expect(result).toContain("- Newest concern that should be preserved");
    expect(result.some((line) => line.includes("finding") && line.includes("omitted"))).toBe(true);
    expect(result.join("\n").length).toBeLessThanOrEqual(maxChars);
  });

  it("handles multiple concerns when even base representation (oldest + newest) exceeds budget", () => {
    const hugeOldest = "Oldest: " + "X".repeat(500);
    const middle = "Middle concern";
    const hugeNewest = "Newest: " + "Y".repeat(500);
    const maxChars = 250;

    const result = renderCompletionReviewConcerns([hugeOldest, middle, hugeNewest], maxChars);
    const joined = result.join("\n");

    expect(joined.length).toBeLessThanOrEqual(maxChars);
    expect(joined).toContain("truncated");
    expect(joined).toContain("omitted");
  });

  it("falls back to clampText when joined output still exceeds maxChars in edge cases", () => {
    const hugeOldest = "Oldest: " + "X".repeat(200);
    const hugeNewest = "Newest: " + "Y".repeat(200);
    const maxChars = 30; // Very small budget

    const result = renderCompletionReviewConcerns([hugeOldest, hugeNewest], maxChars);
    expect(result.join("\n").length).toBeLessThanOrEqual(maxChars);
  });
});

describe("buildJudgeMessages", () => {
  it("builds judge system and user messages correctly with default options", () => {
    const input = makeInput();
    const messages = buildJudgeMessages(input);

    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toBe(JUDGE_SYSTEM_PROMPT);

    const user = messages[1];
    expect(user.role).toBe("user");
    expect(user.content).toContain("## GOAL the executor was given");
    expect(user.content).toContain("Implement feature X");
    expect(user.content).toContain("## ACCEPTANCE CRITERIA");
    expect(user.content).toContain("- c1: Criterion 1 with check [check command: `npm test` — its result is in CHECK RESULTS below]");
    expect(user.content).toContain("- c2: Criterion 2 without check [no check command — judge from the diff]");
    expect(user.content).toContain("## RUBRIC");
    expect(user.content).toContain("- r1: Rubric item 1");
    expect(user.content).toContain("- r2: Rubric item 2");
    expect(user.content).toContain("## EVIDENCE — workspace diff since last verdict");
    expect(user.content).toContain("diff --git a/file.ts b/file.ts");
    expect(user.content).toContain("## EVIDENCE — deterministic secret scan");
    expect(user.content).toContain("- label1");
    expect(user.content).toContain("## EVIDENCE — deterministic new-dependency scan");
    expect(user.content).toContain("- dep1");
    expect(user.content).toContain("## EVIDENCE — deterministic architecture scan");
    expect(user.content).toContain("- arch1");
    expect(user.content).toContain("## EVIDENCE — CHECK RESULTS");
    expect(user.content).toContain("### c1: `npm test`");
    expect(user.content).toContain("exit code: 0 (PASS)");
    expect(user.content).toContain("### c2: `npm run lint`");
    expect(user.content).toContain("exit code: 1 (FAIL)");
    expect(user.content).toContain("## EVIDENCE — step summaries since last verdict");
    expect(user.content).toContain("- Step 1 summary");
    expect(user.content).toContain("- Step 2 summary");
    expect(user.content).toContain("## CRITERIA HISTORY");
    expect(user.content).toContain("- c1: pass → fail → pass");
  });

  it("handles empty criteria, rubric, diff, scans, checkRuns, stepSummaries, and history", () => {
    const input = makeInput({
      evidence: {
        diffRefs: [],
        criteria: [],
        criteriaHistory: {},
        stepSummaries: [],
        artifacts: [],
      },
      rubric: [],
      diffText: "",
      secretScanLabels: [],
      newDependencyLabels: [],
      architectureLabels: [],
      checkRuns: [],
    });

    const messages = buildJudgeMessages(input);
    const userContent = messages[1].content;

    expect(userContent).toContain("(none defined)");
    expect(userContent).toContain("(empty diff — no changes)");
    expect(userContent).toContain("(none)");
    expect(userContent).toContain("(no check commands were run)");
    expect(userContent).toContain("(first judge pass of this run)");
  });

  it("renders diff sections when provided", () => {
    const input = makeInput({
      diffSections: [
        { repoName: "repo-a", relativePath: "packages/a", diffText: "diff a", sinceCommit: "HEAD~1", label: "incremental", evidenceText: "" },
        { repoName: "repo-b", relativePath: "packages/b", diffText: "", sinceCommit: "HEAD~1", label: "incremental", evidenceText: "" },
      ],
    });

    const messages = buildJudgeMessages(input);
    const userContent = messages[1].content;

    expect(userContent).toContain("## EVIDENCE — workspace diffs since last verdict (per writable repo)");
    expect(userContent).toContain("### repo `repo-a` (packages/a)");
    expect(userContent).toContain("diff a");
    expect(userContent).toContain("### repo `repo-b` (packages/b)");
    expect(userContent).toContain("(empty diff — no changes)");
  });

  it("renders cumulative review scope and cumulative diff headers when reviewScope is cumulative", () => {
    const input = makeInput({
      reviewScope: "cumulative",
      escalationConcerns: ["Escalated concern 1"],
      diffSections: [
        { repoName: "repo-a", relativePath: "packages/a", diffText: "cumulative diff", sinceCommit: "HEAD~3", label: "cumulative", evidenceText: "" },
      ],
    });

    const messages = buildJudgeMessages(input);
    const userContent = messages[1].content;

    expect(userContent).toContain("## REVIEW SCOPE — run-completion architecture review");
    expect(userContent).toContain("adjudicates the out-of-rubric concerns");
    expect(userContent).toContain("Escalated concern 1");
    expect(userContent).toContain("## EVIDENCE — CUMULATIVE workspace diffs for the ENTIRE run");
  });

  it("renders cumulative review scope without escalation concerns when escalationConcerns is empty", () => {
    const input = makeInput({
      reviewScope: "cumulative",
      escalationConcerns: [],
    });

    const messages = buildJudgeMessages(input);
    const userContent = messages[1].content;

    expect(userContent).toContain("## REVIEW SCOPE — run-completion architecture review");
    expect(userContent).toContain("This pass judges ONLY whether the run's cumulative changes form a coherent");
    expect(userContent).toContain("## EVIDENCE — CUMULATIVE workspace diff for the ENTIRE run");
  });

  it("truncates check run output if it exceeds MAX_CHECK_OUTPUT_CHARS", () => {
    const hugeOutput = "A".repeat(MAX_CHECK_OUTPUT_CHARS + 500);
    const input = makeInput({
      checkRuns: [
        {
          criterionId: "c1",
          command: "npm test",
          exitCode: 0,
          output: hugeOutput,
          durationMs: 100,
          infraFailed: false,
        },
      ],
    });

    const messages = buildJudgeMessages(input);
    const userContent = messages[1].content;

    expect(userContent).toContain("… [head truncated]");
  });

  it("renders (no output) for check runs with whitespace-only output", () => {
    const input = makeInput({
      checkRuns: [
        {
          criterionId: "c1",
          command: "npm test",
          exitCode: 0,
          output: "   \n\t  ",
          durationMs: 10,
          infraFailed: false,
        },
      ],
    });

    const messages = buildJudgeMessages(input);
    const userContent = messages[1].content;

    expect(userContent).toContain("(no output)");
  });

  it("exports JUDGE_FORM_RESPONSE_SCHEMA with expected properties", () => {
    expect(JUDGE_FORM_RESPONSE_SCHEMA.type).toBe("object");
    expect(JUDGE_FORM_RESPONSE_SCHEMA.required).toEqual([
      "criterionResults",
      "rubricResults",
      "concerns",
    ]);
  });
});
