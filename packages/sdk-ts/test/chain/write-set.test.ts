import { describe, expect, it } from "vitest";

import {
  formatUndeclaredPaths,
  isToolchainPath,
  renderWriteBoundary,
  serializeWriteConflicts,
  undeclaredWritePaths,
  type Plan,
} from "../../src/index.js";

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

describe("renderWriteBoundary (F-218)", () => {
  it("names every declared path and every relaxation the runtime check admits", () => {
    const rendered = renderWriteBoundary(["src/memory/core.ts", "src/memory/index.ts"]);

    expect(rendered).toContain("- src/memory/core.ts");
    expect(rendered).toContain("- src/memory/index.ts");
    expect(rendered).toContain("src/memory");
    expect(rendered).toMatch(/test file/);
    expect(rendered).toMatch(/barrel `index\.\*`/);
    // The consequence, not just the rule: dogfood-120's N-2 lost the node with a
    // PASSING judge form.
    expect(rendered).toMatch(/FAILS the whole node/);
  });

  it("is empty for a node with no declared writeSet, so no boundary is promised", () => {
    expect(renderWriteBoundary([])).toBe("");
  });

  it("de-duplicates and orders the declared paths for a stable prompt", () => {
    // Input is the plan's writeSet, already normalized by
    // `serializeWriteConflicts`; the renderer only makes the listing stable.
    const rendered = renderWriteBoundary(["a/c.ts", "a/b.ts", "a/b.ts"]);
    expect(rendered.match(/^ {2}- /gmu)).toHaveLength(2);
    expect(rendered.indexOf("- a/b.ts")).toBeLessThan(rendered.indexOf("- a/c.ts"));
  });

  it("would have shown dogfood-120's N-2 the legal slot it never used", () => {
    // The real declared set of chain-0723ac0b node N-2, and the real path the
    // executor invented for the evidence the goal demanded.
    const writeSet = [
      "benchmarks/reports/p3-rung-4/brownfield-004.md",
      "benchmarks/tasks/brownfield-004.yaml",
    ];
    const rendered = renderWriteBoundary(writeSet);
    expect(rendered).toContain("- benchmarks/reports/p3-rung-4/brownfield-004.md");

    // And the enforcement side still rejects what the node actually wrote — the
    // prompt and the gate describe one boundary, not two.
    const node = { ...plan([writeSet]).nodes[0]!, writeSet };
    expect(
      undeclaredWritePaths(node, [
        "benchmarks/tasks/brownfield-004.yaml",
        "docs/reports/brownfield-004-evidence.md",
      ]),
    ).toEqual(["docs/reports/brownfield-004-evidence.md"]);
  });
});

describe("isToolchainPath", () => {
  it("recognizes top-level and nested node_modules paths as toolchain output", () => {
    expect(isToolchainPath("node_modules")).toBe(true);
    expect(isToolchainPath("node_modules/pkg/lib/util.js")).toBe(true);
    expect(isToolchainPath("packages/sdk-ts/node_modules/vitest/index.js")).toBe(true);
  });

  it("does not match non-toolchain paths that contain node_modules as substring", () => {
    expect(isToolchainPath("src/node_modules.ts")).toBe(false);
    expect(isToolchainPath("src/not_node_modules/file.ts")).toBe(false);
    expect(isToolchainPath("src/a.ts")).toBe(false);
  });

  // F-401 (dogfood-158 review): node_modules was the only family the acceptance
  // checks drove, so it was the only one the first cut exempted. A real workspace
  // carries all of these.
  it("recognizes the other toolchain families a real workspace accumulates", () => {
    expect(isToolchainPath("packages/sdk-ts/dist/chain/write-set.js")).toBe(true);
    expect(isToolchainPath("benchmarks/harness/dist/index.js")).toBe(true);
    expect(isToolchainPath(".venv/lib/python3.11/site-packages/pkg/mod.py")).toBe(true);
    expect(isToolchainPath("packages/sdk-py/__pycache__/runner.cpython-311.pyc")).toBe(true);
    expect(isToolchainPath(".ruff_cache/0.4.0/12345")).toBe(true);
    expect(isToolchainPath(".devbox/gen/scripts/run.sh")).toBe(true);
    expect(isToolchainPath(".chikory/runs/run-x/journal.db")).toBe(true);
    expect(isToolchainPath("coverage/index.html")).toBe(true);
    expect(isToolchainPath("packages/sdk-ts/tsconfig.tsbuildinfo")).toBe(true);
  });

  it("does not exempt run output — the family dogfood-123 escaped 2.1 GiB into", () => {
    expect(isToolchainPath("benchmarks/results/p3/arm/summary.json")).toBe(false);
    expect(isToolchainPath("benchmarks/runs/2026/workspace/big.bin")).toBe(false);
    expect(isToolchainPath("results/big.txt")).toBe(false);
    expect(isToolchainPath("lib/dist.ts")).toBe(false);
    expect(isToolchainPath("lib/coverage.ts")).toBe(false);
    expect(isToolchainPath("lib/not_node_modules/file.ts")).toBe(false);
  });
});

describe("formatUndeclaredPaths", () => {
  it("returns empty string for empty input", () => {
    expect(formatUndeclaredPaths([])).toBe("");
  });

  it("formats a single path verbatim", () => {
    expect(formatUndeclaredPaths(["results/big.txt"])).toBe("results/big.txt");
  });

  it("formats a small list as comma-separated", () => {
    expect(formatUndeclaredPaths(["src/a.ts", "src/b.ts"])).toBe("src/a.ts, src/b.ts");
  });

  it("bounds a large list of 400 paths with count summary and stays compact", () => {
    const paths = Array.from({ length: 400 }, (_, i) => `results/f${i}.txt`);
    const formatted = formatUndeclaredPaths(paths);
    expect(formatted).toContain("results/f0.txt");
    expect(formatted).toContain("results");
    expect(formatted).toContain("(+390 more)");
    expect(formatted.length).toBeLessThan(1000);
  });
});

