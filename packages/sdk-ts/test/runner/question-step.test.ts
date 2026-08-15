import { describe, expect, test } from "vitest";
import {
  decideQuestionStep,
  renderStepPrompt,
  STANDING_APPROVAL_ANSWER,
} from "../../src/index.js";

const record = (diffBytes: number, summary: string) => ({ diffBytes, summary });

describe("decideQuestionStep & prompt standing answer (WP-608)", () => {
  test("empty diff + approval question => question step", () => {
    expect(
      decideQuestionStep(
        record(0, "Here is my plan. Would you like me to proceed with these changes?"),
      ).question,
    ).toBe(true);
    expect(
      decideQuestionStep(record(0, "Shall I go ahead and apply the refactor?")).question,
    ).toBe(true);
    expect(
      decideQuestionStep(record(0, "Should I proceed with the implementation?")).question,
    ).toBe(true);
    expect(
      decideQuestionStep(
        record(0, "I have prepared the plan. Would you like me to proceed with these changes?"),
      ).question,
    ).toBe(true);
  });

  test("empty diff without a question keeps today behavior", () => {
    expect(
      decideQuestionStep(record(0, "nothing to change; the goal is already satisfied")).question,
    ).toBe(false);
    expect(
      decideQuestionStep(record(0, "Done: verified the existing implementation")).question,
    ).toBe(false);
  });

  test("a question mark alone is not an ask (F-353)", () => {
    // The classifier gates the judge: anything it calls a question buys zero
    // judge passes. A final summary that merely CONTAINS a `?` — rhetorical,
    // diagnostic, quoted — must still be judged.
    expect(
      decideQuestionStep(record(0, "Done. Why was it empty? The fix had already landed upstream."))
        .question,
    ).toBe(false);
    expect(
      decideQuestionStep(record(0, "No change needed: does the config already set strict? Yes."))
        .question,
    ).toBe(false);
    // …and an ask with no question mark is still an ask.
    expect(
      decideQuestionStep(record(0, "Let me know if you want me to apply this plan.")).question,
    ).toBe(true);
  });

  test("a REAL diff is never a question step, whatever the summary says (trap G)", () => {
    expect(
      decideQuestionStep(
        record(2048, "Applied the change. Would you like me to also update the docs?"),
      ).question,
    ).toBe(false);
    expect(
      decideQuestionStep(
        record(10, "Shall I go ahead and apply the refactor?"),
      ).question,
    ).toBe(false);
  });

  test("deterministic: same input, same answer", () => {
    const r = record(0, "Would you like me to proceed?");
    expect(decideQuestionStep(r)).toEqual(decideQuestionStep(r));
  });

  test("supports diffRef object as candidate", () => {
    expect(
      decideQuestionStep({
        diffRef: { bytes: 0 },
        summary: "Would you like me to proceed?",
      }).question,
    ).toBe(true);
    expect(
      decideQuestionStep({
        diffRef: { bytes: 100 },
        summary: "Would you like me to proceed?",
      }).question,
    ).toBe(false);
  });

  test("the step prompt carries the standing answer verbatim", () => {
    const prompt = renderStepPrompt({
      instruction: "do the thing",
      workspaceDir: "/tmp/ws",
      limits: { maxSeconds: 60 },
      context: {
        goal: "g",
        planItem: "p",
        acceptanceCriteria: [],
        notes: {},
        recentSteps: [],
        injections: [],
        memoryRefs: [],
      },
    } as never);
    expect(prompt).toContain(STANDING_APPROVAL_ANSWER);
    expect(prompt).toContain("No approver exists — this step itself is the approval.");
  });
});
