/**
 * F-218 — the executor must be SHOWN the boundary it is killed for crossing.
 *
 * dogfood-120 node `N-2`: goal said "record reproducible evidence",
 * `benchmarks/reports/p3-rung-4/brownfield-004.md` was in its declared writeSet,
 * the prompt never mentioned it, the executor wrote
 * `docs/reports/brownfield-004-evidence.md`, and the seal check discarded the
 * whole node — after a judge pass that marked every criterion PASS.
 */
import { describe, expect, it } from "vitest";

import { renderStepPrompt, renderWriteBoundary, WRITE_BOUNDARY_NOTE } from "../../src/index.js";
import type { ContextBundle, StepInput } from "../../src/types.js";

function context(notes: Record<string, string> = {}): ContextBundle {
  return {
    goal: "author the benchmark task",
    acceptanceCriteria: [{ id: "N2-AC-1", description: "the task is pinned and runnable" }],
    planItem: "author the benchmark task",
    notes,
    recentSteps: [],
    injections: [],
    memoryRefs: [],
  };
}

function stepInput(notes: Record<string, string> = {}): StepInput {
  return {
    workspaceDir: "/tmp/ws",
    instruction: "author the benchmark task",
    context: context(notes),
    limits: { maxSeconds: 840 },
  };
}

const DOGFOOD_120_N2_WRITE_SET = [
  "benchmarks/reports/p3-rung-4/brownfield-004.md",
  "benchmarks/tasks/brownfield-004.yaml",
];

describe("renderStepPrompt write boundary (F-218)", () => {
  it("names the declared write boundary inside the workspace-boundary section", () => {
    const prompt = renderStepPrompt(
      stepInput({ [WRITE_BOUNDARY_NOTE]: renderWriteBoundary(DOGFOOD_120_N2_WRITE_SET) }),
    );

    expect(prompt).toContain("## Declared write boundary");
    expect(prompt).toContain("- benchmarks/reports/p3-rung-4/brownfield-004.md");
    expect(prompt).toContain("- benchmarks/tasks/brownfield-004.yaml");
    expect(prompt).toMatch(/FAILS the whole node/);
    // It belongs to the boundary block, not the loose notes list.
    expect(prompt.indexOf("# Workspace boundary")).toBeLessThan(
      prompt.indexOf("## Declared write boundary"),
    );
    expect(prompt).not.toContain(`- ${WRITE_BOUNDARY_NOTE}:`);
  });

  it("still renders other notes as notes", () => {
    const prompt = renderStepPrompt(
      stepInput({
        "memory.recall": "excerpt of the earlier output",
        [WRITE_BOUNDARY_NOTE]: renderWriteBoundary(DOGFOOD_120_N2_WRITE_SET),
      }),
    );

    expect(prompt).toContain("# Notes\n- memory.recall: excerpt of the earlier output");
    expect(prompt).toContain("## Declared write boundary");
  });

  it("promises no boundary for a plain run that declares none", () => {
    const prompt = renderStepPrompt(stepInput());

    expect(prompt).not.toContain("Declared write boundary");
    expect(prompt).not.toContain("# Notes");
    // The F-192 workspace boundary is unconditional and unchanged.
    expect(prompt).toContain("# Workspace boundary");
    expect(prompt).toContain("Your workspace is: /tmp/ws");
  });
});
