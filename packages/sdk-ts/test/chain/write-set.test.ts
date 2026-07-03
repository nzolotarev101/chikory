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
  it("returns actual paths outside any declared directory", () => {
    const node = plan([["src/left.ts"]]).nodes[0]!;
    expect(undeclaredWritePaths(node, ["src/left.ts", "other/extra.ts"])).toEqual([
      "other/extra.ts",
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

  it("fails a write to a directory no declared entry owns, even with test files present", () => {
    const node = plan([["src/memory/core.ts"]]).nodes[0]!;
    expect(
      undeclaredWritePaths(node, ["src/memory/core.ts", "src/runner/rogue.ts", "test/x.test.ts"]),
    ).toEqual(["src/runner/rogue.ts"]);
  });

  it("admits an executor-named file in a declared directory — created OR modified (WP-510/F-89, dogfood-079)", () => {
    // Planner declared src/memory/core.ts; the loose executor named its own
    // src/memory/tiered-memory.ts, and a downstream node then MODIFIES it. Both
    // sit in a directory the writeSet already owns → admit.
    const node = plan([["src/memory/core.ts", "src/memory/index.ts"]]).nodes[0]!;
    expect(
      undeclaredWritePaths(node, ["src/memory/index.ts", "src/memory/tiered-memory.ts"]),
    ).toEqual([]);
  });

  it("does not admit a write in a directory with no declared entry", () => {
    const node = plan([["src/memory/core.ts"]]).nodes[0]!;
    expect(undeclaredWritePaths(node, ["src/memory/core.ts", "src/runner/rogue.ts"])).toEqual([
      "src/runner/rogue.ts",
    ]);
  });

  it("admits an additive edit to the shared package barrel (WP-510/F-89, dogfood-079)", () => {
    // A memory-scoped node re-exports its primitive from the top-level barrel,
    // one directory up from its declared writeSet → admit the index.ts edit.
    const node = plan([["src/memory/core.ts"]]).nodes[0]!;
    expect(
      undeclaredWritePaths(node, ["src/memory/core.ts", "src/index.ts"]),
    ).toEqual([]);
  });
});
