import { describe, expect, it } from "vitest";

import { parseBranchTarget } from "../../src/cli/branch-target.js";

describe("parseBranchTarget", () => {
  it("parses positive integer step targets", () => {
    expect(parseBranchTarget("run-205@7")).toEqual({
      runId: "run-205",
      step: 7,
      checkpointId: "run-205@7",
    });
  });

  it("parses base targets", () => {
    expect(parseBranchTarget("run-205@base")).toEqual({
      runId: "run-205",
      step: "base",
      checkpointId: "run-205@base",
    });
  });

  it("canonicalizes integer checkpoint ids", () => {
    expect(parseBranchTarget("run-205@007")).toEqual({
      runId: "run-205",
      step: 7,
      checkpointId: "run-205@7",
    });
  });

  it.each([
    ["missing @", "run-205"],
    ["empty run id", "@1"],
    ["empty step", "run-205@"],
    ["zero step", "run-205@0"],
    ["negative step", "run-205@-1"],
    ["non-integer step", "run-205@1.5"],
    ["multiple @ separators", "run-205@1@2"],
  ])("rejects malformed targets with %s", (_label, input) => {
    expect(() => parseBranchTarget(input)).toThrow(/<run-id>@<step\|base>/);
  });
});
