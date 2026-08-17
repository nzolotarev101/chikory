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
  MAX_COMPLETION_REVIEW_CONCERNS_CHARS,
  renderCompletionReviewConcerns,
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

describe("renderCompletionReviewConcerns (WP-631 / F-365)", () => {
  it("empty concerns array renders empty output", () => {
    expect(renderCompletionReviewConcerns([])).toEqual([]);
  });

  it("single concern renders intact under the header", () => {
    const single = "OBJ-1-HEAD: single concern description: OBJ-1-TAIL";
    const lines = renderCompletionReviewConcerns([single]);
    expect(lines).toEqual([
      "### Out-of-rubric concerns to adjudicate against the cumulative diff:",
      `- ${single}`,
    ]);
  });

  it("findings that fit within the budget are all preserved intact with NO elision notice", () => {
    const findings = [
      "OBJ-1: first finding description",
      "OBJ-2: second finding description",
      "OBJ-3: third finding description",
    ];
    const lines = renderCompletionReviewConcerns(findings);
    const joined = lines.join("\n");
    expect(joined.length).toBeLessThanOrEqual(MAX_COMPLETION_REVIEW_CONCERNS_CHARS);
    for (const f of findings) {
      expect(joined).toContain(f);
    }
    expect(joined).not.toContain("omitted");
  });

  it("findings exceeding the budget bound section <= 3072 chars, keep oldest and newest intact, and emit elision notice with count", () => {
    const makeFinding = (n: number) =>
      `OBJ-${n}-HEAD: ${"x".repeat(900)} :OBJ-${n}-TAIL`;
    const sixFindings = [
      makeFinding(1),
      makeFinding(2),
      makeFinding(3),
      makeFinding(4),
      makeFinding(5),
      makeFinding(6),
    ];

    const lines = renderCompletionReviewConcerns(sixFindings);
    const section = lines.join("\n");

    expect(section.length).toBeLessThanOrEqual(MAX_COMPLETION_REVIEW_CONCERNS_CHARS);
    expect(section.length).toBeLessThanOrEqual(3072);

    // Oldest finding intact (both ends)
    expect(section).toContain("OBJ-1-HEAD");
    expect(section).toContain("OBJ-1-TAIL");

    // Newest finding intact (both ends)
    expect(section).toContain("OBJ-6-HEAD");
    expect(section).toContain("OBJ-6-TAIL");

    // Elision notice with count
    expect(section).toMatch(/… \[\d+ findings? omitted\]/);
  });

  // F-371 (dogfood-149 review): the expectation below was `/^- a+…$/` as delivered —
  // a bare ellipsis, indistinguishable from a finding that simply ended. Updated, not
  // weakened: the clamp must now state how many characters it removed.
  it("single huge finding is strictly bounded to maxChars AND says how much it cut", () => {
    const hugeFinding = "a".repeat(10_000);
    const lines = renderCompletionReviewConcerns([hugeFinding]);
    const section = lines.join("\n");
    expect(section.length).toBeLessThanOrEqual(MAX_COMPLETION_REVIEW_CONCERNS_CHARS);
    expect(lines.length).toBe(2);
    expect(lines[0]).toBe("### Out-of-rubric concerns to adjudicate against the cumulative diff:");
    expect(lines[1]).toMatch(/^- a+ … \[truncated, \d+ chars omitted\]$/);
    const cut = Number(/\[truncated, (\d+) chars omitted\]/.exec(section)?.[1]);
    const kept = /^- (a+) /.exec(lines[1])?.[1].length ?? 0;
    expect(
      kept + cut,
      "the announced cut plus the surviving prefix must account for the WHOLE finding — " +
        "a count that does not reconcile is worse than no count",
    ).toBe(10_000);
  });

  it("a clamped ENDPOINT announces its truncation, not just the omitted-finding count (F-371)", () => {
    const findings = [
      "OBJ-1-HEAD: " + "b".repeat(5000) + " :OBJ-1-TAIL",
      "OBJ-2-HEAD: " + "c".repeat(5000) + " :OBJ-2-TAIL",
      "OBJ-3-HEAD: " + "d".repeat(5000) + " :OBJ-3-TAIL",
    ];
    const section = renderCompletionReviewConcerns(findings, 2000).join("\n");
    expect(section.length).toBeLessThanOrEqual(2000);
    expect(section).toContain("… [1 finding omitted]");
    // BOTH surviving endpoints were cut, so BOTH must say so.
    expect(section.match(/\[truncated, \d+ chars omitted\]/g)?.length).toBe(2);
    // Trap: the truncation notice must never replace the omission notice.
    expect(section).toContain("OBJ-1-HEAD");
    expect(section).toContain("OBJ-3-HEAD");
  });

  it("a finding that FITS is never annotated — the notice marks real loss only", () => {
    const section = renderCompletionReviewConcerns(
      ["OBJ-1: short", "OBJ-2: also short"],
      MAX_COMPLETION_REVIEW_CONCERNS_CHARS,
    ).join("\n");
    expect(section).not.toContain("truncated");
    expect(section).not.toContain("omitted");
  });

  it("multiple huge findings are strictly bounded to maxChars while retaining elision notice", () => {
    const findings = [
      "OBJ-1-HEAD: " + "b".repeat(5000),
      "OBJ-2-HEAD: " + "c".repeat(5000),
      "OBJ-3-HEAD: " + "d".repeat(5000),
      "OBJ-4-HEAD: " + "e".repeat(5000),
    ];
    const lines = renderCompletionReviewConcerns(findings, 2000);
    const section = lines.join("\n");
    expect(section.length).toBeLessThanOrEqual(2000);
    expect(section).toContain("OBJ-1-HEAD");
    expect(section).toContain("OBJ-4-HEAD");
    expect(section).toContain("… [2 findings omitted]");
  });

  it("strictly bounds output when maxChars is smaller than default", () => {
    const lines = renderCompletionReviewConcerns(["finding one", "finding two"], 80);
    const section = lines.join("\n");
    expect(section.length).toBeLessThanOrEqual(80);
  });
});

