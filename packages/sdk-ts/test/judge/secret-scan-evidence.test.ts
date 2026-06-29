import { describe, expect, it } from "vitest";

import { buildJudgeMessages, type JudgePromptInput } from "../../src/judge/prompt.js";

const HEADER = "## EVIDENCE — deterministic secret scan (added diff lines)";
const AWS_LABEL = ["aws", "access", "key"].join("-");
const OPENAI_LABEL = ["openai", "key"].join("-");

function input(secretScanLabels: string[]): JudgePromptInput {
  return {
    goal: "",
    evidence: {
      diffRefs: [],
      criteria: [],
      criteriaHistory: {},
      stepSummaries: [],
      artifacts: [],
    },
    rubric: [],
    diffText: "",
    secretScanLabels,
    newDependencyLabels: [],
    checkRuns: [],
  };
}

function userContent(secretScanLabels: string[]): string {
  const userMessage = buildJudgeMessages(input(secretScanLabels)).find((m) => m.role === "user");
  expect(userMessage).toBeDefined();
  return userMessage!.content;
}

describe("secret scan evidence prompt section (WP-215)", () => {
  it("renders deterministic secret scan labels one per line", () => {
    const content = userContent([AWS_LABEL, OPENAI_LABEL]);

    expect(content).toContain(HEADER);
    expect(content).toContain(`- ${AWS_LABEL}`);
    expect(content).toContain(`- ${OPENAI_LABEL}`);
  });

  it("renders none when deterministic secret scan labels are empty", () => {
    const content = userContent([]);

    expect(content).toContain(`${HEADER}\n(none)`);
    expect(content).not.toContain(`- ${AWS_LABEL}`);
    expect(content).not.toContain(`- ${OPENAI_LABEL}`);
  });
});
