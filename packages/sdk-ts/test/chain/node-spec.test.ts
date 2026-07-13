import { describe, expect, it } from "vitest";

import {
  childRunId,
  deriveNodeOutcome,
  planNodeToTaskSpec,
  type ChainNodeTemplate,
} from "../../src/index.js";
import type { PlanNode } from "../../src/types.js";

const template: ChainNodeTemplate = {
  repos: [{ url: "/tmp/repo", writable: true }],
  executor: { adapter: "scripted", family: "anthropic" },
  judge: { family: "openai-compat", cadence: 1 },
  routing: {
    stages: {
      plan: { provider: "anthropic", model: "claude-fable-5" },
      code: { provider: "anthropic", model: "claude-fable-5" },
      review: { provider: "anthropic", model: "claude-fable-5" },
      judge: { provider: "openai-compat", model: "fake-judge" },
    },
  },
};

const node: PlanNode = {
  id: "N-2",
  goal: "Implement the second slice",
  acceptanceCriteria: [{ id: "AC-1", description: "second slice complete" }],
  dependsOn: ["N-1"],
  budgetUsd: 3,
};

describe("childRunId", () => {
  it("is a pure function of chainId and nodeId", () => {
    expect(childRunId("chain-abc", "N-2")).toBe("chain-abc-node-N-2");
    expect(childRunId("chain-abc", "N-2")).toBe(childRunId("chain-abc", "N-2"));
  });
});

describe("planNodeToTaskSpec", () => {
  it("projects a PlanNode onto an ordinary TaskSpec carrying node + template fields", () => {
    const spec = planNodeToTaskSpec(node, template, "plan-1");
    expect(spec.name).toBe("plan-1-N-2");
    expect(spec.goal).toBe(node.goal);
    expect(spec.acceptanceCriteria).toEqual(node.acceptanceCriteria);
    expect(spec.budgetUsd).toBe(3);
    expect(spec.repos).toBe(template.repos);
    expect(spec.executor).toBe(template.executor);
    expect(spec.judge).toBe(template.judge);
    expect(spec.routing).toBe(template.routing);
    expect(spec.chainLink).toEqual({ planId: "plan-1", nodeId: "N-2" });
  });

  it("records the predecessor run id in chainLink when supplied", () => {
    const spec = planNodeToTaskSpec(node, template, "plan-1", "run-parent");
    expect(spec.chainLink).toEqual({
      planId: "plan-1",
      nodeId: "N-2",
      parentRunId: "run-parent",
    });
  });

  it("appends a static predecessor handoff note when supplied", () => {
    const note = [
      "## Already completed by predecessor nodes (do not redo)",
      "- N-1: Implement the first slice",
      "The code from this node is ALREADY PRESENT in your workspace. Build on it.",
    ].join("\n");
    const spec = planNodeToTaskSpec(node, template, "plan-1", "run-parent", note);

    expect(spec.goal).toBe(`${node.goal}\n\n${note}`);
    expect(spec.chainLink?.parentRunId).toBe("run-parent");
  });

  it("carries ordered artifact handoffs and the node write boundary", () => {
    const parent = {
      nodeId: "N-1",
      runId: "run-parent",
      repos: [
        {
          repoUrl: "/tmp/repo",
          sourceCommit: "source",
          baseCommit: "base",
          headCommit: "head",
          changedPaths: ["src/one.ts"],
          bundleRef: {
            id: "a".repeat(64),
            kind: "repo_snapshot" as const,
            bytes: 100,
            summary: "parent snapshot",
          },
        },
      ],
    };
    const spec = planNodeToTaskSpec(
      { ...node, writeSet: ["src/two.ts"] },
      template,
      "plan-1",
      "run-parent",
      undefined,
      "chain-1",
      [parent],
    );

    expect(spec.chainLink).toMatchObject({
      chainId: "chain-1",
      writeSet: ["src/two.ts"],
      parentHandoffs: [parent],
    });
  });

  it("carries the plan's big-picture context on chainLink when supplied", () => {
    const spec = planNodeToTaskSpec(
      node,
      template,
      "plan-1",
      undefined,
      undefined,
      "chain-1",
      undefined,
      undefined,
      {
        goal: "Build the whole importer end to end",
        outline: ["N-1: Implement the first slice", "N-2: Implement the second slice"],
      },
    );

    expect(spec.chainLink).toMatchObject({
      planGoal: "Build the whole importer end to end",
      planOutline: ["N-1: Implement the first slice", "N-2: Implement the second slice"],
    });
  });

  it("omits planOutline when the plan context has an empty outline", () => {
    const spec = planNodeToTaskSpec(
      node,
      template,
      "plan-1",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { goal: "Build the whole importer end to end", outline: [] },
    );

    expect(spec.chainLink?.planGoal).toBe("Build the whole importer end to end");
    expect(spec.chainLink?.planOutline).toBeUndefined();
  });

  it("does not alter the node goal when no handoff note is supplied", () => {
    expect(planNodeToTaskSpec(node, template, "plan-1", "run-parent").goal).toBe(
      node.goal,
    );
  });

  it("WP-243: arms the park seam only on the targeted dispatch index", () => {
    const parkTemplate: ChainNodeTemplate = {
      ...template,
      debugPark: { beforeStep: 0, nodeIndex: 1 },
    };
    // node A (dispatch index 0) runs normally; node B (index 1) parks.
    expect(planNodeToTaskSpec(node, parkTemplate, "plan-1", undefined, undefined, undefined, undefined, 0).debug).toBeUndefined();
    expect(planNodeToTaskSpec(node, parkTemplate, "plan-1", undefined, undefined, undefined, undefined, 1).debug).toEqual({
      parkBeforeStep: 0,
    });
  });

  it("WP-243: arms every node when no nodeIndex is given", () => {
    const parkTemplate: ChainNodeTemplate = { ...template, debugPark: { beforeStep: 2 } };
    expect(planNodeToTaskSpec(node, parkTemplate, "plan-1", undefined, undefined, undefined, undefined, 0).debug).toEqual({
      parkBeforeStep: 2,
    });
    expect(planNodeToTaskSpec(node, parkTemplate, "plan-1", undefined, undefined, undefined, undefined, 9).debug).toEqual({
      parkBeforeStep: 2,
    });
  });

  it("leaves debug undefined when the template carries no park seam", () => {
    expect(planNodeToTaskSpec(node, template, "plan-1").debug).toBeUndefined();
  });

  it("WP-246: arms the bad-diff seam only on the targeted dispatch index", () => {
    const badDiffTemplate: ChainNodeTemplate = {
      ...template,
      debugSeedBadDiff: { atStep: 0, path: "src/util/x.ts", content: "broken", nodeIndex: 1 },
    };
    // node A (dispatch index 0) runs normally; node B (index 1) gets the bad diff.
    expect(planNodeToTaskSpec(node, badDiffTemplate, "plan-1", undefined, undefined, undefined, undefined, 0).debug).toBeUndefined();
    expect(planNodeToTaskSpec(node, badDiffTemplate, "plan-1", undefined, undefined, undefined, undefined, 1).debug).toEqual({
      seedBadDiff: { atStep: 0, path: "src/util/x.ts", content: "broken" },
    });
  });

  it("WP-246: arms every node when no nodeIndex is given", () => {
    const badDiffTemplate: ChainNodeTemplate = {
      ...template,
      debugSeedBadDiff: { atStep: 2, path: "src/util/x.ts", content: "broken" },
    };
    expect(planNodeToTaskSpec(node, badDiffTemplate, "plan-1", undefined, undefined, undefined, undefined, 0).debug).toEqual({
      seedBadDiff: { atStep: 2, path: "src/util/x.ts", content: "broken" },
    });
    expect(planNodeToTaskSpec(node, badDiffTemplate, "plan-1", undefined, undefined, undefined, undefined, 9).debug).toEqual({
      seedBadDiff: { atStep: 2, path: "src/util/x.ts", content: "broken" },
    });
  });

  it("WP-246: merges both debug seams when armed together on the targeted node", () => {
    const bothTemplate: ChainNodeTemplate = {
      ...template,
      debugPark: { beforeStep: 0, nodeIndex: 1 },
      debugSeedBadDiff: { atStep: 0, path: "src/util/x.ts", content: "broken", nodeIndex: 1 },
    };
    expect(planNodeToTaskSpec(node, bothTemplate, "plan-1", undefined, undefined, undefined, undefined, 1).debug).toEqual({
      parkBeforeStep: 0,
      seedBadDiff: { atStep: 0, path: "src/util/x.ts", content: "broken" },
    });
    // a non-targeted node gets neither.
    expect(planNodeToTaskSpec(node, bothTemplate, "plan-1", undefined, undefined, undefined, undefined, 0).debug).toBeUndefined();
  });

  it("carries optional template budgetTokens/maxSteps only when present", () => {
    const bare = planNodeToTaskSpec(node, template, "plan-1");
    expect(bare.budgetTokens).toBeUndefined();
    expect(bare.maxSteps).toBeUndefined();

    const withCaps = planNodeToTaskSpec(
      node,
      { ...template, budgetTokens: 50_000, maxSteps: 6 },
      "plan-1",
    );
    expect(withCaps.budgetTokens).toBe(50_000);
    expect(withCaps.maxSteps).toBe(6);
  });
});

describe("deriveNodeOutcome", () => {
  it("maps SUCCESS → SUCCESS, defaulting the verdict to PROCEED", () => {
    expect(deriveNodeOutcome("SUCCESS")).toEqual({ status: "SUCCESS", verdict: "PROCEED" });
  });

  it("maps a failure with no verdict → FAILED/HALT", () => {
    expect(deriveNodeOutcome("FAILED")).toEqual({ status: "FAILED", verdict: "HALT" });
  });

  it("narrows CANCELLED to a FAILED node outcome", () => {
    expect(deriveNodeOutcome("CANCELLED")).toEqual({ status: "FAILED", verdict: "HALT" });
  });

  it("preserves the child run's actual final verdict when supplied", () => {
    expect(deriveNodeOutcome("SUCCESS", "PROCEED")).toEqual({
      status: "SUCCESS",
      verdict: "PROCEED",
    });
    expect(deriveNodeOutcome("FAILED", "ESCALATE")).toEqual({
      status: "FAILED",
      verdict: "ESCALATE",
    });
  });
});
