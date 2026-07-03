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
});
