/**
 * OVERALL GOAL (big picture) prompt section — the per-pass carrier for the
 * `design_serves_overall_goal` rubric judgment. Pure prompt-construction
 * tests: the section renders only when big-picture context exists, sits
 * between the run GOAL and the active-work-chunk scope, and the chunk-scope
 * guard keeps deferred-by-design work from reading as a design flaw.
 */
import { describe, expect, it } from "vitest";

import {
  buildJudgeMessages,
  renderOverallGoalContext,
  type JudgePromptInput,
} from "../../src/judge/prompt.js";

const HEADER = "## OVERALL GOAL (big picture)";

function input(overrides: Partial<JudgePromptInput> = {}): JudgePromptInput {
  return {
    goal: "implement node-2 of the plan",
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

function userContent(overrides: Partial<JudgePromptInput> = {}): string {
  const userMessage = buildJudgeMessages(input(overrides)).find((m) => m.role === "user");
  expect(userMessage).toBeDefined();
  return userMessage!.content;
}

describe("renderOverallGoalContext", () => {
  it("returns the plan goal alone when no outline is given", () => {
    expect(renderOverallGoalContext("build the pipeline")).toBe("build the pipeline");
    expect(renderOverallGoalContext("build the pipeline", [])).toBe("build the pipeline");
  });

  it("appends the sibling-node outline as a bulleted list", () => {
    const context = renderOverallGoalContext("build the pipeline", [
      "N-1: parse input",
      "N-2: write output",
    ]);

    expect(context).toContain("build the pipeline");
    expect(context).toContain("Plan outline (sibling nodes):");
    expect(context).toContain("- N-1: parse input");
    expect(context).toContain("- N-2: write output");
  });
});

describe("overall-goal prompt section", () => {
  it("renders the section with the big-picture text when overallGoal is provided", () => {
    const content = userContent({ overallGoal: "build the full ingestion pipeline" });

    expect(content).toContain(HEADER);
    expect(content).toContain("build the full ingestion pipeline");
    expect(content).toContain("Use it only to");
    expect(content).toContain("judge `design_serves_overall_goal`");
  });

  it("omits the section entirely when overallGoal is absent", () => {
    const content = userContent();

    expect(content).not.toContain(HEADER);
    expect(content).not.toContain("other runs' work");
  });

  it("orders the section after GOAL and before the active work chunk scope", () => {
    const content = userContent({
      overallGoal: "build the full ingestion pipeline",
      activeWorkChunkDirective: "chunk 2: wire the parser",
    });

    const goalAt = content.indexOf("## GOAL the executor was given");
    const overallAt = content.indexOf(HEADER);
    const chunkAt = content.indexOf("## ACTIVE WORK CHUNK (this step's scope)");
    expect(goalAt).toBeGreaterThanOrEqual(0);
    expect(overallAt).toBeGreaterThan(goalAt);
    expect(chunkAt).toBeGreaterThan(overallAt);
  });

  it("chunk scope carries the design-quality guard so deferred chunks are not design flaws", () => {
    const content = userContent({ activeWorkChunkDirective: "chunk 2: wire the parser" });

    expect(content).toContain("For `design_serves_overall_goal`, judge the DESIGN QUALITY");
    expect(content).toContain("later parts deferred to");
    expect(content).toContain("future chunks are NOT design flaws");
  });
});
