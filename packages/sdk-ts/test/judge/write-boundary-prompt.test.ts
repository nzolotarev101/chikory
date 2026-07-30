/**
 * F-218 — the judge applies the same write boundary the seal enforces.
 *
 * dogfood-120 `N-2` step 4: `scope_matches_instruction` PASSED with
 * `docs/reports/brownfield-004-evidence.md` in the diff ("all changed content
 * concerns brownfield-004 provenance…"), and the deterministic seal check then
 * discarded the node for exactly those paths. Two gates, one boundary — the
 * judge has to see it, or it greenlights work the seal will throw away.
 */
import { describe, expect, it } from "vitest";

import {
  buildJudgeMessages,
  renderWriteBoundaryScope,
  type JudgePromptInput,
} from "../../src/judge/prompt.js";
import { renderWriteBoundary } from "../../src/chain/write-boundary.js";

const HEADER = "## WRITE BOUNDARY (deterministic — enforced when this node seals)";

const N2_BOUNDARY = renderWriteBoundary([
  "benchmarks/reports/p3-rung-4/brownfield-004.md",
  "benchmarks/tasks/brownfield-004.yaml",
]);

function input(overrides: Partial<JudgePromptInput> = {}): JudgePromptInput {
  return {
    goal: "author brownfield-004",
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

describe("renderWriteBoundaryScope", () => {
  it("is empty without a boundary — a plain run's prompt is unchanged", () => {
    expect(renderWriteBoundaryScope()).toBe("");
    expect(renderWriteBoundaryScope("")).toBe("");
    expect(userContent()).not.toContain(HEADER);
  });

  it("tells the judge to FAIL scope_matches_instruction on an out-of-boundary path", () => {
    const rendered = renderWriteBoundaryScope(N2_BOUNDARY);
    expect(rendered).toContain(HEADER);
    expect(rendered).toContain("benchmarks/tasks/brownfield-004.yaml");
    expect(rendered).toMatch(/fail `scope_matches_instruction`/);
    expect(rendered).toMatch(/name the offending/);
  });

  it("carries the declared paths into the judge's user message", () => {
    const content = userContent({ writeBoundary: N2_BOUNDARY });
    expect(content).toContain(HEADER);
    expect(content).toContain("- benchmarks/reports/p3-rung-4/brownfield-004.md");
    // After the run goal, before the acceptance criteria it is applied to.
    expect(content.indexOf("## GOAL the executor was given")).toBeLessThan(content.indexOf(HEADER));
    expect(content.indexOf(HEADER)).toBeLessThan(content.indexOf("## ACCEPTANCE CRITERIA"));
  });
});
