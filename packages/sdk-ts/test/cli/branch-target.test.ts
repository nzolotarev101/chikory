import { describe, expect, it } from "vitest";

import {
  branchNameForTarget,
  parseBranchTarget,
} from "../../src/cli/branch-target.js";

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

describe("branchNameForTarget", () => {
  it("returns default branch names for numeric step targets", () => {
    expect(branchNameForTarget(parseBranchTarget("run-205@7"))).toBe(
      "branch-run-205-step-7",
    );
  });

  it("returns default branch names for base targets", () => {
    expect(branchNameForTarget(parseBranchTarget("run-205@base"))).toBe(
      "branch-run-205-base",
    );
  });

  it("uses canonical numeric steps after parsing leading-zero targets", () => {
    expect(branchNameForTarget(parseBranchTarget("run-205@007"))).toBe(
      "branch-run-205-step-7",
    );
  });

  it("sanitizes run ids containing path, space, and punctuation characters", () => {
    expect(branchNameForTarget(parseBranchTarget("team/run 205!*@3"))).toBe(
      "branch-team-run-205-step-3",
    );
  });

  it("rejects targets whose run id cannot produce a branch segment", () => {
    expect(() => branchNameForTarget(parseBranchTarget("!/@1"))).toThrow(
      /run id must contain branch-safe characters/,
    );
  });
});
