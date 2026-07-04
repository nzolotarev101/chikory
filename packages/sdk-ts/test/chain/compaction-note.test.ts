import { describe, expect, it } from "vitest";

import {
  buildStructuredCompactionNote,
  DEFAULT_STRUCTURED_COMPACTION_NOTE_MAX_CHARS,
} from "../../src/index.js";
import type { ChainNodeHandoff, PlanNode } from "../../src/types.js";

const node: PlanNode = {
  id: "N-1",
  goal: "write the first slice",
  acceptanceCriteria: [{ id: "AC-1", description: "first slice complete" }],
  dependsOn: [],
  budgetUsd: 1,
};

const handoff: ChainNodeHandoff = {
  nodeId: "N-1",
  runId: "run-1",
  repos: [
    {
      repoUrl: "/repo",
      sourceCommit: "a",
      baseCommit: "a",
      headCommit: "b",
      changedPaths: ["z.txt", "a.txt"],
      bundleRef: { id: "bundle", kind: "repo_snapshot", bytes: 10, summary: "bundle" },
    },
  ],
};

describe("buildStructuredCompactionNote", () => {
  it("summarizes a sealed predecessor deterministically", () => {
    const note = buildStructuredCompactionNote({
      node,
      outcome: { status: "SUCCESS", verdict: "PROCEED" },
      handoff,
    });

    expect(note).toContain("node: N-1");
    expect(note).toContain("goal: write the first slice");
    expect(note).toContain("outcome: SUCCESS");
    expect(note).toContain("verdict: PROCEED");
    expect(note).toContain("changed_paths: a.txt, z.txt");
  });

  it("sorts changed paths across all handoff repositories", () => {
    const note = buildStructuredCompactionNote({
      node,
      outcome: { status: "SUCCESS", verdict: "PROCEED" },
      handoff: {
        ...handoff,
        repos: [
          {
            ...handoff.repos[0],
            changedPaths: ["packages/z.ts", "packages/a.ts"],
          },
          {
            ...handoff.repos[0],
            repoUrl: "/other",
            changedPaths: ["docs/b.md", "docs/a.md"],
          },
        ],
      },
    });

    expect(note).toContain("changed_paths: docs/a.md, docs/b.md, packages/a.ts, packages/z.ts");
  });

  it("is total for a sealed predecessor without a handoff artifact", () => {
    const first = buildStructuredCompactionNote({
      node,
      outcome: { status: "FAILED", verdict: "HALT" },
    });
    const second = buildStructuredCompactionNote({
      node,
      outcome: { status: "FAILED", verdict: "HALT" },
    });

    expect(first).toBe(second);
    expect(first).toContain("node: N-1");
    expect(first).toContain("outcome: FAILED");
    expect(first).toContain("verdict: HALT");
    expect(first).toContain("changed_paths: (none recorded)");
  });

  it("is bounded by maxChars", () => {
    const note = buildStructuredCompactionNote({
      node: { ...node, goal: "x".repeat(200) },
      outcome: { status: "SUCCESS", verdict: "PROCEED" },
      maxChars: 80,
    });

    expect(note.length).toBeLessThanOrEqual(80);
    expect(note.endsWith("...")).toBe(true);
  });

  it("respects tiny explicit bounds without overflowing", () => {
    for (const maxChars of [1, 2, 3]) {
      const note = buildStructuredCompactionNote({
        node: { ...node, goal: "x".repeat(200) },
        outcome: { status: "SUCCESS", verdict: "PROCEED" },
        maxChars,
      });

      expect(note.length).toBeLessThanOrEqual(maxChars);
    }
  });

  it("normalizes invalid bounds to the default cap", () => {
    for (const maxChars of [0, -1, Number.NaN]) {
      const note = buildStructuredCompactionNote({
        node: { ...node, goal: "x".repeat(DEFAULT_STRUCTURED_COMPACTION_NOTE_MAX_CHARS * 2) },
        outcome: { status: "SUCCESS", verdict: "PROCEED" },
        maxChars,
      });

      expect(note.length).toBeLessThanOrEqual(DEFAULT_STRUCTURED_COMPACTION_NOTE_MAX_CHARS);
    }
  });
});
