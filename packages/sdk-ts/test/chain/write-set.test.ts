import { describe, expect, it } from "vitest";

import { serializeWriteConflicts, undeclaredWritePaths, type Plan } from "../../src/index.js";

function plan(writeSets: string[][]): Plan {
  return {
    id: "plan-write-set",
    goal: "conflict-safe work",
    createdAt: "2026-06-20T00:00:00.000Z",
    nodes: writeSets.map((writeSet, index) => ({
      id: `N-${index + 1}`,
      goal: `node ${index + 1}`,
      acceptanceCriteria: [{ id: "AC-1", description: "done" }],
      dependsOn: [],
      writeSet,
      budgetUsd: 1,
    })),
  };
}

describe("serializeWriteConflicts", () => {
  it("keeps disjoint fan-in parents independent", () => {
    const normalized = serializeWriteConflicts(plan([["left.ts"], ["right.ts"]]), {
      requireWriteSets: true,
    });
    expect(normalized.nodes.map((node) => node.dependsOn)).toEqual([[], []]);
  });

  it("serializes overlapping unordered writers in stable plan order", () => {
    const normalized = serializeWriteConflicts(plan([["src/shared"], ["src/shared/file.ts"]]), {
      requireWriteSets: true,
    });
    expect(normalized.nodes[1]!.dependsOn).toEqual(["N-1"]);
  });

  it("normalizes paths and rejects paths outside the repository", () => {
    expect(serializeWriteConflicts(plan([["src/./left.ts"]])).nodes[0]!.writeSet).toEqual([
      "src/left.ts",
    ]);
    expect(() => serializeWriteConflicts(plan([["../secret"]]))).toThrow(
      "invalid plan write path",
    );
  });
});

describe("undeclaredWritePaths", () => {
  it("returns only actual paths outside the declared boundary", () => {
    const node = plan([["src/left.ts"]]).nodes[0]!;
    expect(undeclaredWritePaths(node, ["src/left.ts", "src/extra.ts"])).toEqual([
      "src/extra.ts",
    ]);
  });

  it("admits the AC-required test tree the src-only writeSet cannot predict (WP-510/F-89)", () => {
    const node = plan([["src/left.ts"]]).nodes[0]!;
    expect(
      undeclaredWritePaths(node, [
        "src/left.ts",
        "packages/sdk-ts/test/runner/pacing.test.ts",
        "packages/sdk-ts/tests/foo.ts",
        "src/left.spec.ts",
      ]),
    ).toEqual([]);
  });

  it("still fails a genuine undeclared src path even when test files are also written", () => {
    const node = plan([["src/left.ts"]]).nodes[0]!;
    expect(
      undeclaredWritePaths(node, ["src/left.ts", "src/rogue.ts", "test/left.test.ts"]),
    ).toEqual(["src/rogue.ts"]);
  });

  it("admits an executor-named NEW file in a declared directory (WP-510/F-89, dogfood-079)", () => {
    // Planner declared src/memory/core.ts; the loose executor created its own
    // src/memory/tiered-memory.ts in the same area — a net-new file → admit.
    const node = plan([["src/memory/core.ts", "src/memory/index.ts"]]).nodes[0]!;
    const changed = ["src/memory/index.ts", "src/memory/tiered-memory.ts"];
    expect(undeclaredWritePaths(node, changed, ["src/memory/tiered-memory.ts"])).toEqual([]);
  });

  it("still fails a MODIFIED undeclared file in a declared directory (rogue edit)", () => {
    // A pre-existing sibling that was edited (not in addedPaths) stays a violation.
    const node = plan([["src/memory/core.ts"]]).nodes[0]!;
    expect(undeclaredWritePaths(node, ["src/memory/core.ts", "src/memory/other.ts"], [])).toEqual([
      "src/memory/other.ts",
    ]);
  });

  it("does not admit a NEW file in a directory with no declared entry", () => {
    const node = plan([["src/memory/core.ts"]]).nodes[0]!;
    expect(
      undeclaredWritePaths(node, ["src/memory/core.ts", "src/runner/rogue.ts"], ["src/runner/rogue.ts"]),
    ).toEqual(["src/runner/rogue.ts"]);
  });
});
