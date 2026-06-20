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

  it("does not alter the node goal when no handoff note is supplied", () => {
    expect(planNodeToTaskSpec(node, template, "plan-1", "run-parent").goal).toBe(
      node.goal,
    );
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
