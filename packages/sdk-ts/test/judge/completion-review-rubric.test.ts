/**
 * Completion-review rubric + prompt scope: every item is non-destructive by
 * construction (a design finding at the finish line must never ROLLBACK), a
 * fully failing form still computes PROCEED, and the "cumulative" review
 * scope re-headlines the diff evidence + prepends the REVIEW SCOPE preamble.
 */
import { describe, expect, it } from "vitest";

import {
  COMPLETION_REVIEW_RUBRIC,
  computeVerdict,
  RUBRIC_CUMULATIVE_DESIGN_COHERENT,
  RUBRIC_DESIGN_SERVES_OVERALL_GOAL,
} from "../../src/judge/index.js";
import { buildJudgeMessages, type JudgePromptInput } from "../../src/judge/prompt.js";
import type { JudgeForm } from "../../src/types.js";

describe("COMPLETION_REVIEW_RUBRIC", () => {
  it("contains the architecture scan, the design item, and the cumulative item — all non-destructive", () => {
    expect(COMPLETION_REVIEW_RUBRIC.map((r) => r.id)).toEqual([
      "no_architecture_violations",
      RUBRIC_DESIGN_SERVES_OVERALL_GOAL,
      RUBRIC_CUMULATIVE_DESIGN_COHERENT,
    ]);
    expect(COMPLETION_REVIEW_RUBRIC.every((r) => !r.destructive)).toBe(true);
  });

  it("a fully failing completion form still computes PROCEED (no seal-time ROLLBACK/HALT path)", () => {
    const form: JudgeForm = {
      criterionResults: [],
      rubricResults: COMPLETION_REVIEW_RUBRIC.map((r) => ({
        id: r.id,
        pass: false,
        justification: `${r.id} violated`,
      })),
      concerns: [],
    };

    const decision = computeVerdict(form, {}, COMPLETION_REVIEW_RUBRIC);

    expect(decision.kind).toBe("PROCEED");
    expect(decision.rationale).toContain(RUBRIC_CUMULATIVE_DESIGN_COHERENT);
  });
});

describe("cumulative review scope prompt", () => {
  function input(reviewScope?: "incremental" | "cumulative"): JudgePromptInput {
    return {
      goal: "the run goal",
      evidence: {
        diffRefs: [],
        criteria: [],
        criteriaHistory: {},
        stepSummaries: [],
        artifacts: [],
      },
      rubric: COMPLETION_REVIEW_RUBRIC,
      diffText: "+the change",
      secretScanLabels: [],
      newDependencyLabels: [],
      architectureLabels: [],
      checkRuns: [],
      ...(reviewScope !== undefined ? { reviewScope } : {}),
    };
  }

  function userContent(reviewScope?: "incremental" | "cumulative"): string {
    const userMessage = buildJudgeMessages(input(reviewScope)).find((m) => m.role === "user");
    expect(userMessage).toBeDefined();
    return userMessage!.content;
  }

  it("cumulative scope re-headlines the diff and prepends the REVIEW SCOPE preamble", () => {
    const content = userContent("cumulative");

    expect(content).toContain("## REVIEW SCOPE — run-completion architecture review");
    expect(content).toContain("leave `concerns` empty");
    expect(content).toContain(
      "## EVIDENCE — CUMULATIVE workspace diff for the ENTIRE run (base → final state)",
    );
    expect(content).not.toContain("## EVIDENCE — workspace diff since last verdict");
  });

  it("default scope keeps the incremental heading and no preamble", () => {
    const content = userContent();

    expect(content).not.toContain("## REVIEW SCOPE");
    expect(content).toContain("## EVIDENCE — workspace diff since last verdict");
  });
});
