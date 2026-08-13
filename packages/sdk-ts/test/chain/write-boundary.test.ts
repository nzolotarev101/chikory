import { describe, expect, it } from "vitest";

import {
  isBarrelPath,
  isTestPath,
  parentDirOf,
  renderWriteBoundary,
  WRITE_BOUNDARY_NOTE,
} from "../../src/chain/write-boundary.js";

describe("WRITE_BOUNDARY_NOTE", () => {
  it("should have the correct key value", () => {
    expect(WRITE_BOUNDARY_NOTE).toBe("chain.write_boundary");
  });
});

describe("parentDirOf", () => {
  it("should return empty string for files at the root level", () => {
    expect(parentDirOf("")).toBe("");
    expect(parentDirOf("index.ts")).toBe("");
    expect(parentDirOf("README.md")).toBe("");
  });

  it("should correctly identify parent directory for single nested paths", () => {
    expect(parentDirOf("src/index.ts")).toBe("src");
    expect(parentDirOf("test/test-helper.ts")).toBe("test");
    expect(parentDirOf(".github/workflows")).toBe(".github");
  });

  it("should correctly identify parent directory for deeply nested paths", () => {
    expect(parentDirOf("packages/sdk-ts/src/chain/write-boundary.ts")).toBe(
      "packages/sdk-ts/src/chain",
    );
    expect(parentDirOf("a/b/c/d/e.txt")).toBe("a/b/c/d");
  });

  it("should handle files prefixed with a slash", () => {
    expect(parentDirOf("/root-file.ts")).toBe("");
    expect(parentDirOf("/src/index.ts")).toBe("/src");
  });
});

describe("isTestPath", () => {
  it("should match path segments with 'test' or 'tests'", () => {
    expect(isTestPath("test/util.ts")).toBe(true);
    expect(isTestPath("tests/main.js")).toBe(true);
    expect(isTestPath("src/test/helper.ts")).toBe(true);
    expect(isTestPath("packages/sdk-ts/tests/foo.ts")).toBe(true);
    expect(isTestPath("packages/sdk-ts/test/runner/pacing.test.ts")).toBe(true);
  });

  it("should match test or spec suffixes on standard extensions", () => {
    expect(isTestPath("src/left.test.ts")).toBe(true);
    expect(isTestPath("src/left.spec.ts")).toBe(true);
    expect(isTestPath("src/left.test.js")).toBe(true);
    expect(isTestPath("src/left.spec.js")).toBe(true);
    expect(isTestPath("src/left.test.tsx")).toBe(true);
    expect(isTestPath("src/left.spec.jsx")).toBe(true);
    expect(isTestPath("src/left.test.cts")).toBe(true);
    expect(isTestPath("src/left.spec.mts")).toBe(true);
  });

  it("should reject non-test files even if they contain partial words", () => {
    expect(isTestPath("src/left.ts")).toBe(false);
    expect(isTestPath("src/test-helper.ts")).toBe(false); // test is not a segment, and suffix is not .test.ts
    expect(isTestPath("src/spec-loader.ts")).toBe(false);
    expect(isTestPath("src/tester.ts")).toBe(false);
    expect(isTestPath("src/tests-helper.ts")).toBe(false);
  });

  it("should handle edge cases like directories/bare names", () => {
    expect(isTestPath("test")).toBe(true);
    expect(isTestPath("tests")).toBe(true);
    expect(isTestPath("")).toBe(false);
  });
});

describe("isBarrelPath", () => {
  it("should recognize barrel filenames (index.*)", () => {
    expect(isBarrelPath("index.ts")).toBe(true);
    expect(isBarrelPath("index.js")).toBe(true);
    expect(isBarrelPath("index.tsx")).toBe(true);
    expect(isBarrelPath("index.jsx")).toBe(true);
    expect(isBarrelPath("index.cts")).toBe(true);
    expect(isBarrelPath("index.mts")).toBe(true);
    expect(isBarrelPath("src/index.ts")).toBe(true);
    expect(isBarrelPath("packages/sdk-ts/src/chain/index.js")).toBe(true);
  });

  it("should reject non-barrel filenames", () => {
    expect(isBarrelPath("src/indexer.ts")).toBe(false);
    expect(isBarrelPath("src/index2.ts")).toBe(false);
    expect(isBarrelPath("src/main.ts")).toBe(false);
    expect(isBarrelPath("src/INDEX.ts")).toBe(false); // case-sensitive in regex
    expect(isBarrelPath("")).toBe(false);
  });
});

describe("renderWriteBoundary", () => {
  it("should return empty string for an empty writeSet", () => {
    expect(renderWriteBoundary([])).toBe("");
  });

  it("should deduplicate and sort paths alphabetically", () => {
    const rendered = renderWriteBoundary([
      "src/b.ts",
      "src/a.ts",
      "src/b.ts",
    ]);

    expect(rendered).toContain("- src/a.ts");
    expect(rendered).toContain("- src/b.ts");
    // Verify count of declared paths
    const lines = rendered.split("\n");
    const bulletCount = lines.filter((line) => line.trim().startsWith("-")).length;
    expect(bulletCount).toBe(2);
  });

  it("should list the unique parent directories of declared paths", () => {
    const rendered = renderWriteBoundary([
      "src/components/button.tsx",
      "src/components/card.tsx",
      "src/utils/math.ts",
      "root-file.ts", // No parent dir (parentDirOf is "")
    ]);

    expect(rendered).toContain("src/components, src/utils");
    expect(rendered).not.toContain("none");
  });

  it("should print 'none' when there are no valid parent directories", () => {
    const rendered = renderWriteBoundary(["file1.ts", "file2.ts"]);
    expect(rendered).toContain("(none)");
  });

  it("should include standard instructions and warning about failing the node", () => {
    const rendered = renderWriteBoundary(["src/index.ts"]);
    expect(rendered).toContain("ANY changed path outside that boundary FAILS the whole node");
    expect(rendered).toContain("Also admitted: any file directly inside a declared directory");
    expect(rendered).toContain("any test file (in a `test`/`tests` directory, or named `*.test.*` / `*.spec.*`)");
    expect(rendered).toContain("barrel `index.*`");
    expect(rendered).toContain("Everything else is outside.");
  });
});
