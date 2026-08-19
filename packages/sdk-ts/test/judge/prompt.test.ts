import { describe, expect, it } from "vitest";

import {
  buildJudgeMessages,
  JUDGE_FORM_RESPONSE_SCHEMA,
  JUDGE_SYSTEM_PROMPT,
  MAX_COMPLETION_REVIEW_CONCERNS_CHARS,
  renderActiveWorkChunkScope,
  renderCompletionReviewConcerns,
  renderOverallGoal,
  renderOverallGoalContext,
  renderWriteBoundaryScope,
  type JudgePromptInput,
} from "../../src/judge/prompt.js";
import { MAX_CHECK_OUTPUT_CHARS } from "../../src/judge/evidence.js";

function baseInput(overrides: Partial<JudgePromptInput> = {}): JudgePromptInput {
  return {
    goal: "Implement feature X",
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
    ...overrides,
  };
}

function getUserContent(input: JudgePromptInput): string {
  const messages = buildJudgeMessages(input);
  const user = messages.find((m) => m.role === "user");
  expect(user).toBeDefined();
  return user!.content;
}

describe("JUDGE_FORM_RESPONSE_SCHEMA & JUDGE_SYSTEM_PROMPT", () => {
  it("defines schema requirements and system prompt structure", () => {
    expect(JUDGE_FORM_RESPONSE_SCHEMA.type).toBe("object");
    expect(JUDGE_FORM_RESPONSE_SCHEMA.required).toEqual([
      "criterionResults",
      "rubricResults",
      "concerns",
    ]);
    expect(JUDGE_SYSTEM_PROMPT).toContain("You are an independent code-review judge.");
    expect(JUDGE_SYSTEM_PROMPT).toContain("Respond with a single JSON object matching the requested schema.");
  });
});

describe("renderActiveWorkChunkScope", () => {
  it("returns empty string when directive is undefined", () => {
    expect(renderActiveWorkChunkScope()).toBe("");
    expect(renderActiveWorkChunkScope(undefined)).toBe("");
  });

  it("renders active work chunk directive and instructions when directive is provided", () => {
    const result = renderActiveWorkChunkScope("Implement step 1 parser");
    expect(result).toContain("## ACTIVE WORK CHUNK (this step's scope)");
    expect(result).toContain("Implement step 1 parser");
    expect(result).toContain("Judge this pass against the active work chunk above.");
    expect(result).toContain("DEFERRED BY DESIGN");
    expect(result).toContain("FRONT-LOADING");
  });
});

describe("renderOverallGoalContext", () => {
  it("returns planGoal directly when planOutline is undefined or empty", () => {
    expect(renderOverallGoalContext("Goal 1")).toBe("Goal 1");
    expect(renderOverallGoalContext("Goal 1", [])).toBe("Goal 1");
  });

  it("appends bulleted plan outline when provided", () => {
    const result = renderOverallGoalContext("Main Goal", ["Step A", "Step B"]);
    expect(result).toBe("Main Goal\n\nPlan outline (sibling nodes):\n- Step A\n- Step B");
  });
});

describe("renderWriteBoundaryScope", () => {
  it("returns empty string when writeBoundary is undefined or empty", () => {
    expect(renderWriteBoundaryScope()).toBe("");
    expect(renderWriteBoundaryScope(undefined)).toBe("");
    expect(renderWriteBoundaryScope("")).toBe("");
  });

  it("renders write boundary header and path instructions when writeBoundary is provided", () => {
    const boundary = "Allowed paths: src/*.ts";
    const result = renderWriteBoundaryScope(boundary);
    expect(result).toContain("## WRITE BOUNDARY (deterministic — enforced when this node seals)");
    expect(result).toContain("Allowed paths: src/*.ts");
    expect(result).toContain("fail `scope_matches_instruction` and name the offending");
  });
});

describe("renderOverallGoal", () => {
  it("returns empty string when overallGoal is undefined", () => {
    expect(renderOverallGoal()).toBe("");
    expect(renderOverallGoal(undefined)).toBe("");
  });

  it("renders overall goal section when provided", () => {
    const result = renderOverallGoal("Build the whole system");
    expect(result).toContain("## OVERALL GOAL (big picture)");
    expect(result).toContain("Build the whole system");
    expect(result).toContain("Use it only to");
    expect(result).toContain("judge `design_serves_overall_goal`");
  });
});

describe("renderCompletionReviewConcerns", () => {
  it("returns empty array if concerns is empty or maxChars <= 0", () => {
    expect(renderCompletionReviewConcerns([])).toEqual([]);
    expect(renderCompletionReviewConcerns(["concern 1"], 0)).toEqual([]);
    expect(renderCompletionReviewConcerns(["concern 1"], -10)).toEqual([]);
  });

  it("returns all concerns when they fit within maxChars", () => {
    const concerns = ["concern 1", "concern 2"];
    const result = renderCompletionReviewConcerns(concerns, 1000);
    expect(result).toEqual([
      "### Out-of-rubric concerns to adjudicate against the cumulative diff:",
      "- concern 1",
      "- concern 2",
    ]);
  });

  it("clamps a single concern if it exceeds maxChars", () => {
    const hugeConcern = "A".repeat(500);
    // Header is ~72 chars; maxChars = 200 gives enough room for header + notice note (~35 chars) + prefix text
    const result = renderCompletionReviewConcerns([hugeConcern], 200);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain("Out-of-rubric concerns");
    expect(result.join("\n").length).toBeLessThanOrEqual(200);
    expect(result[1]).toContain("[truncated,");
  });

  it("falls back gracefully when maxChars is extremely tiny for single concern", () => {
    const hugeConcern = "A".repeat(100);
    const header = "### Out-of-rubric concerns to adjudicate against the cumulative diff:";
    const maxChars = header.length + 2; // available <= 0
    const result = renderCompletionReviewConcerns([hugeConcern], maxChars);
    expect(result.join("\n").length).toBeLessThanOrEqual(maxChars);
  });

  it("elides middle concerns when multiple concerns exceed budget", () => {
    const concerns = Array.from({ length: 10 }, (_, i) => `Concern number ${i + 1} with extra details`);
    const result = renderCompletionReviewConcerns(concerns, 200);
    const joined = result.join("\n");
    expect(joined.length).toBeLessThanOrEqual(200);
    expect(joined).toContain("Concern number 1");
    expect(joined).toContain("omitted]");
    expect(joined).toContain("Concern number 10");
  });

  it("clamps oldest/newest endpoints if base representation exceeds budget", () => {
    const hugeOldest = "Oldest concern " + "X".repeat(500);
    const hugeMiddle = "Middle concern " + "Y".repeat(500);
    const hugeNewest = "Newest concern " + "Z".repeat(500);
    const concerns = [hugeOldest, hugeMiddle, hugeNewest];

    const result = renderCompletionReviewConcerns(concerns, 200);
    const joined = result.join("\n");
    expect(joined.length).toBeLessThanOrEqual(200);
    expect(joined).toContain("omitted]");
    expect(joined).toContain("Oldest concern");
    expect(joined).toContain("Newest concern");
  });

  it("uses default MAX_COMPLETION_REVIEW_CONCERNS_CHARS when maxChars is omitted", () => {
    const concerns = ["concern 1", "concern 2"];
    const result = renderCompletionReviewConcerns(concerns);
    expect(result.join("\n").length).toBeLessThanOrEqual(MAX_COMPLETION_REVIEW_CONCERNS_CHARS);
    expect(result).toContain("- concern 1");
  });
});

describe("buildJudgeMessages", () => {
  it("constructs system and user messages correctly", () => {
    const input = baseInput();
    const messages = buildJudgeMessages(input);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: "system", content: JUDGE_SYSTEM_PROMPT });
    expect(messages[1].role).toEqual("user");
  });

  it("renders acceptance criteria with and without check commands, and empty criteria", () => {
    const emptyContent = getUserContent(baseInput({ evidence: { criteria: [], diffRefs: [], stepSummaries: [], criteriaHistory: {}, artifacts: [] } }));
    expect(emptyContent).toContain("(none defined)");

    const withCriteriaContent = getUserContent(
      baseInput({
        evidence: {
          criteria: [
            { id: "AC-1", description: "check test pass", check: "npm test" },
            { id: "AC-2", description: "diff inspect" },
          ],
          diffRefs: [],
          stepSummaries: [],
          criteriaHistory: {},
          artifacts: [],
        },
      }),
    );
    expect(withCriteriaContent).toContain("- AC-1: check test pass [check command: `npm test` — its result is in CHECK RESULTS below]");
    expect(withCriteriaContent).toContain("- AC-2: diff inspect [no check command — judge from the diff]");
  });

  it("renders rubric items", () => {
    const content = getUserContent(
      baseInput({
        rubric: [
          { id: "R-1", description: "no secrets", destructive: false },
          { id: "R-2", description: "clean code", destructive: false },
        ],
      }),
    );
    expect(content).toContain("- R-1: no secrets");
    expect(content).toContain("- R-2: clean code");
  });

  it("renders check runs with pass/fail exit codes, output bounds, and empty outputs", () => {
    const emptyCheckContent = getUserContent(baseInput({ checkRuns: [] }));
    expect(emptyCheckContent).toContain("(no check commands were run)");

    const longOutput = "L".repeat(MAX_CHECK_OUTPUT_CHARS + 50);
    const content = getUserContent(
      baseInput({
        checkRuns: [
          { criterionId: "AC-1", command: "npm test", exitCode: 0, durationMs: 120, output: "  all tests pass  ", infraFailed: false },
          { criterionId: "AC-2", command: "eslint .", exitCode: 1, durationMs: 45, output: longOutput, infraFailed: false },
          { criterionId: "AC-3", command: "true", exitCode: 0, durationMs: 10, output: "   ", infraFailed: false },
        ],
      }),
    );

    expect(content).toContain("### AC-1: `npm test`");
    expect(content).toContain("exit code: 0 (PASS), 120ms");
    expect(content).toContain("all tests pass");

    expect(content).toContain("### AC-2: `eslint .`");
    expect(content).toContain("exit code: 1 (FAIL), 45ms");
    expect(content).toContain("… [head truncated]");

    expect(content).toContain("### AC-3: `true`");
    expect(content).toContain("(no output)");
  });

  it("renders deterministic scan labels (secrets, dependencies, architecture)", () => {
    const emptyScansContent = getUserContent(
      baseInput({
        secretScanLabels: [],
        newDependencyLabels: [],
        architectureLabels: [],
      }),
    );
    expect(emptyScansContent).toContain("## EVIDENCE — deterministic secret scan (added diff lines)\n(none)");
    expect(emptyScansContent).toContain("## EVIDENCE — deterministic new-dependency scan (added diff lines)\n(none)");
    expect(emptyScansContent).toContain("## EVIDENCE — deterministic architecture scan (added diff lines)\n(none)");

    const filledScansContent = getUserContent(
      baseInput({
        secretScanLabels: ["label-secret-key"],
        newDependencyLabels: ["pkg:npm/lodash"],
        architectureLabels: ["arch:layer-violation"],
      }),
    );
    expect(filledScansContent).toContain("- label-secret-key");
    expect(filledScansContent).toContain("- pkg:npm/lodash");
    expect(filledScansContent).toContain("- arch:layer-violation");
  });

  it("renders diff evidence for incremental vs cumulative, and single-repo vs multi-repo diff sections", () => {
    const emptyIncremental = getUserContent(baseInput({ reviewScope: "incremental", diffText: "" }));
    expect(emptyIncremental).toContain("## EVIDENCE — workspace diff since last verdict");
    expect(emptyIncremental).toContain("(empty diff — no changes)");

    const diffIncremental = getUserContent(
      baseInput({ reviewScope: "incremental", diffText: "+ const x = 1;" }),
    );
    expect(diffIncremental).toContain("```diff\n+ const x = 1;\n```");

    const cumulativeDiff = getUserContent(
      baseInput({ reviewScope: "cumulative", diffText: "+ const x = 1;" }),
    );
    expect(cumulativeDiff).toContain("## EVIDENCE — CUMULATIVE workspace diff for the ENTIRE run (base → final state)");

    const multiRepoDiff = getUserContent(
      baseInput({
        reviewScope: "incremental",
        diffText: "",
        diffSections: [
          { repoName: "repo-a", relativePath: "packages/a", diffText: "+ change a", sinceCommit: "c1", label: "repo-a", evidenceText: "+ change a" },
          { repoName: "repo-b", relativePath: "packages/b", diffText: "", sinceCommit: "c1", label: "repo-b", evidenceText: "" },
        ],
      }),
    );
    expect(multiRepoDiff).toContain("## EVIDENCE — workspace diffs since last verdict (per writable repo)");
    expect(multiRepoDiff).toContain("### repo `repo-a` (packages/a)");
    expect(multiRepoDiff).toContain("```diff\n+ change a\n```");
    expect(multiRepoDiff).toContain("### repo `repo-b` (packages/b)");
    expect(multiRepoDiff).toContain("(empty diff — no changes)");
  });

  it("renders step summaries and criteria history", () => {
    const emptyContent = getUserContent(
      baseInput({
        evidence: {
          criteria: [],
          diffRefs: [],
          stepSummaries: [],
          criteriaHistory: {},
          artifacts: [],
        },
      }),
    );
    expect(emptyContent).toContain("## EVIDENCE — step summaries since last verdict (executor claims; do not trust)\n(none)");
    expect(emptyContent).toContain("## CRITERIA HISTORY (per-criterion pass/fail across previous verdicts)\n(first judge pass of this run)");

    const historyContent = getUserContent(
      baseInput({
        evidence: {
          criteria: [],
          diffRefs: [],
          stepSummaries: ["Did step 1", "Did step 2"],
          criteriaHistory: {
            "AC-1": [false, true],
            "AC-2": [true],
            "AC-3": [], // empty history ignored
          },
          artifacts: [],
        },
      }),
    );
    expect(historyContent).toContain("- Did step 1\n- Did step 2");
    expect(historyContent).toContain("- AC-1: fail → pass");
    expect(historyContent).toContain("- AC-2: pass");
    expect(historyContent).not.toContain("AC-3");
  });

  it("renders completion review scope with and without escalation concerns", () => {
    const noConcernsContent = getUserContent(
      baseInput({
        reviewScope: "cumulative",
      }),
    );
    expect(noConcernsContent).toContain("## REVIEW SCOPE — run-completion architecture review");
    expect(noConcernsContent).toContain("This pass judges ONLY whether the run's cumulative changes form a coherent");
    expect(noConcernsContent).not.toContain("Adjudication standard:");

    const withConcernsContent = getUserContent(
      baseInput({
        reviewScope: "cumulative",
        escalationConcerns: ["Potential performance regression"],
      }),
    );
    expect(withConcernsContent).toContain("This pass judges whether the run's cumulative changes form a coherent");
    expect(withConcernsContent).toContain("Adjudication standard: UPHOLD a concern only if you can point at a real");
    expect(withConcernsContent).toContain("### Out-of-rubric concerns to adjudicate against the cumulative diff:");
    expect(withConcernsContent).toContain("- Potential performance regression");
  });
});
