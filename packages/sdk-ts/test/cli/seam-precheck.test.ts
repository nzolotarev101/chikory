import { describe, expect, it } from "vitest";

import {
  describeSeamArming,
  type SeamArmingReport,
} from "../../src/cli/seam-precheck.js";

describe("describeSeamArming", () => {
  it("reports disarmed state when the path is absent", () => {
    const report: SeamArmingReport = describeSeamArming({});

    expect(describeSeamArming({}).armed).toBe(false)
    expect(describeSeamArming({}).lines).toContain("no seam armed")
    expect(report.atStep).toBe(0);
    expect(report).not.toHaveProperty("path");
    expect(report).not.toHaveProperty("nodeIndex");
    expect(report.warnings).toEqual([]);
    expect(report.lines).toEqual(["no seam armed"]);
  });

  it("reports armed state with path and default step", () => {
    const report = describeSeamArming({
      CHIKORY_SEED_BAD_DIFF_PATH: "packages/sdk-ts/src/util/x.ts",
      CHIKORY_SEED_BAD_DIFF_CONTENT: "export const x = 1;",
    });

    expect(describeSeamArming({ CHIKORY_SEED_BAD_DIFF_PATH: "packages/sdk-ts/src/util/x.ts", CHIKORY_SEED_BAD_DIFF_CONTENT: "export const x = 1;" }).armed).toBe(true)
    expect(report.path).toBe("packages/sdk-ts/src/util/x.ts");
    expect(report.atStep).toBe(0);
    expect(report).not.toHaveProperty("nodeIndex");
    expect(report.warnings).toEqual([]);
    expect(report.lines[0]).toMatch(/^🧪 seam armed/);
    expect(report.lines[0]).toContain("packages/sdk-ts/src/util/x.ts");
  });

  it("reports configured step and optional node index", () => {
    const report = describeSeamArming({
      CHIKORY_SEED_BAD_DIFF_PATH: "x.ts",
      CHIKORY_SEED_BAD_DIFF_CONTENT: "y",
      CHIKORY_SEED_BAD_DIFF_AT_STEP: "2",
      CHIKORY_SEED_BAD_DIFF_NODE_INDEX: "1",
    });

    expect(describeSeamArming({ CHIKORY_SEED_BAD_DIFF_PATH: "x.ts", CHIKORY_SEED_BAD_DIFF_CONTENT: "y", CHIKORY_SEED_BAD_DIFF_NODE_INDEX: "1" }).nodeIndex).toBe(1)
    expect(report.atStep).toBe(2);
    expect(report.nodeIndex).toBe(1);
    expect(report.lines[0]).toContain("node index 1");
  });

  it("warns when armed without content", () => {
    const report = describeSeamArming({
      CHIKORY_SEED_BAD_DIFF_PATH: "x.ts",
    });

    expect(report.warnings.length).toBeGreaterThan(0);
  });
});
