import { describe, expect, it } from "vitest";

import {
  MAX_REPLAN_BRIEF_CHARS,
  buildReplanBrief,
  buildRetryPlan,
} from "../../src/chain/replan-plan.js";
import type { Plan } from "../../src/types.js";

function linearPlan(): Plan {
  return {
    id: "plan-heal",
    goal: "recover a failed chain",
    createdAt: "2026-07-15T00:00:00.000Z",
    nodes: [
      { id: "N-1", goal: "first", acceptanceCriteria: [], dependsOn: [], budgetUsd: 5 },
      {
        id: "N-2",
        goal: "second",
        acceptanceCriteria: [{ id: "AC-1", description: "does the thing" }],
        dependsOn: ["N-1"],
        writeSet: ["src/second.ts"],
        budgetUsd: 7,
      },
      { id: "N-3", goal: "third", acceptanceCriteria: [], dependsOn: ["N-2"], budgetUsd: 5 },
    ],
  };
}

describe("buildReplanBrief", () => {
  it("folds the failed node id and normalized reason into a deterministic brief", () => {
    const brief = buildReplanBrief("N-2", "AC-1 failed:\n  the check\texited 1");

    expect(brief).toContain("node N-2 failed");
    // The reason is normalized to a single line (no tab/newline); the brief's own
    // structural line breaks between its three sections are intentional.
    const reasonLine = brief.split("\n").find((l) => l.startsWith("previous failure:"))!;
    expect(reasonLine).toBe("previous failure: AC-1 failed: the check exited 1");
    expect(reasonLine).not.toMatch(/[\t]/);
    expect(buildReplanBrief("N-2", "AC-1 failed:\n  the check\texited 1")).toBe(brief);
  });

  it("falls back to 'unknown' for an empty reason and caps a long one", () => {
    expect(buildReplanBrief("N-2", "   ")).toContain("previous failure: unknown");
    const capped = buildReplanBrief("N-2", "x".repeat(MAX_REPLAN_BRIEF_CHARS + 500));
    expect(capped.length).toBeLessThanOrEqual(MAX_REPLAN_BRIEF_CHARS);
    expect(capped.endsWith("…")).toBe(true);
  });
});

describe("buildRetryPlan", () => {
  it("replaces the failed node with an evidence-carrying retry and rewires downstream deps", () => {
    const revised = buildRetryPlan(linearPlan(), "N-2", "AC-1 failed", 1);

    expect(revised.id).toBe("plan-heal-r1");
    expect(revised.nodes.map((n) => n.id)).toEqual(["N-1", "N-2-r1", "N-3"]);

    const retry = revised.nodes.find((n) => n.id === "N-2-r1")!;
    expect(retry.goal).toContain("second");
    expect(retry.goal).toContain("REPLAN BRIEF");
    expect(retry.goal).toContain("previous failure: AC-1 failed");
    // node identity (ACs, writeSet, budget, deps) is preserved.
    expect(retry.acceptanceCriteria).toEqual([{ id: "AC-1", description: "does the thing" }]);
    expect(retry.writeSet).toEqual(["src/second.ts"]);
    expect(retry.budgetUsd).toBe(7);
    expect(retry.dependsOn).toEqual(["N-1"]);

    // The downstream node is rewired onto the retry id; the predecessor is untouched.
    expect(revised.nodes.find((n) => n.id === "N-3")!.dependsOn).toEqual(["N-2-r1"]);
    expect(revised.nodes.find((n) => n.id === "N-1")).toEqual(linearPlan().nodes[0]);
  });

  it("is deterministic and does not mutate the input plan", () => {
    const plan = linearPlan();
    const first = buildRetryPlan(plan, "N-2", "boom", 2);
    const second = buildRetryPlan(linearPlan(), "N-2", "boom", 2);

    expect(first).toEqual(second);
    expect(plan.nodes[1]!.id).toBe("N-2"); // input untouched
    expect(first.nodes.map((n) => n.id)).toEqual(["N-1", "N-2-r2", "N-3"]);
  });

  it("throws when the failed node is not in the plan", () => {
    expect(() => buildRetryPlan(linearPlan(), "N-9", "boom", 1)).toThrow(/not in the plan/);
  });
});
