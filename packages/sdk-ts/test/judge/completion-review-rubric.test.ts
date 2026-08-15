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
  RUBRIC_ESCALATION_CONCERNS_ADJUDICATED,
} from "../../src/judge/index.js";
import { buildJudgeMessages, type JudgePromptInput } from "../../src/judge/prompt.js";
import type { JudgeForm } from "../../src/types.js";

describe("COMPLETION_REVIEW_RUBRIC", () => {
  it("contains the architecture scan, the design item, the cumulative item, and the escalation adjudication item — all non-destructive", () => {
    expect(COMPLETION_REVIEW_RUBRIC.map((r) => r.id)).toEqual([
      "no_architecture_violations",
      RUBRIC_DESIGN_SERVES_OVERALL_GOAL,
      RUBRIC_CUMULATIVE_DESIGN_COHERENT,
      RUBRIC_ESCALATION_CONCERNS_ADJUDICATED,
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

  // F-344 (dogfood-141): a converged run was condemned because the adjudicating
  // pass was asked only "is the concern true?" about a concern no diff could
  // ever clear (missing executor process evidence). The charter must carry an
  // adjudication standard scoping upholds to defects in the DELIVERED work and
  // naming this pass's trusted evidence as the arbiter for verification-shaped
  // concerns — and it must appear ONLY when there are concerns to adjudicate
  // (F-340: no subject, no question).
  it("concerns bring the adjudication standard: upholds are scoped to the delivered work", () => {
    const concern = "no evidence the executor ran its four verification commands";
    const userMessage = buildJudgeMessages({
      ...input("cumulative"),
      escalationConcerns: [concern],
    }).find((m) => m.role === "user");
    expect(userMessage).toBeDefined();
    const content = userMessage!.content;

    expect(content).toContain("adjudicates the out-of-rubric concerns");
    expect(content).toContain(concern);
    expect(content).toContain("Adjudication standard: UPHOLD a concern only if you can point");
    expect(content).toContain("A concern that process evidence is MISSING");
  });

  it("a concern-less cumulative review renders neither the concern charter nor the standard", () => {
    const content = userContent("cumulative");

    expect(content).not.toContain("adjudicates the out-of-rubric concerns");
    expect(content).not.toContain("Adjudication standard:");
  });
});
