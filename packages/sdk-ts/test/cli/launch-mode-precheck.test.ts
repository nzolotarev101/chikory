import { describe, expect, it } from "vitest";

import {
  assessLaunchModeMismatch,
  detectIntendedSingleRun,
} from "../../src/cli/launch-mode-precheck.js";
import type { LaunchModeMismatch } from "../../src/cli/launch-mode-precheck.js";

describe("detectIntendedSingleRun", () => {
  it("detects the conventional single-run marker", () => {
    expect(detectIntendedSingleRun("# Launch with `chikory run`, NOT a chain.")).toBe(true);
  });

  it("detects a single `chikory run` marker", () => {
    expect(detectIntendedSingleRun("This task must be a single `chikory run`.")).toBe(true);
  });

  it("returns false for a genuine chain spec with no single-run marker", () => {
    expect(detectIntendedSingleRun("Decompose this goal into two dependent nodes.")).toBe(false);
  });
});

describe("assessLaunchModeMismatch", () => {
  it("returns the F-70 mismatch warning when a single-run spec launches as a chain", () => {
    const result = assessLaunchModeMismatch({ intendedSingleRun: true, launchedAsChain: true });
    const typedResult: LaunchModeMismatch | null = result;

    expect(typedResult).not.toBeNull();
    expect(result?.warning).toContain("chikory chain");
    expect(result?.warning).toContain("single `chikory run`");
    expect(result?.intendedSingleRun).toBe(true);
    expect(result?.launchedAsChain).toBe(true);
  });

  it("returns null when a single-run spec is launched correctly", () => {
    expect(assessLaunchModeMismatch({ intendedSingleRun: true, launchedAsChain: false })).toBeNull();
  });

  it("does not flag a genuine chain spec launched as a chain", () => {
    expect(assessLaunchModeMismatch({ intendedSingleRun: false, launchedAsChain: true })).toBeNull();
  });

  it("returns null when neither single-run intent nor chain launch is present", () => {
    expect(assessLaunchModeMismatch({ intendedSingleRun: false, launchedAsChain: false })).toBeNull();
  });

  it("does not mutate the input object", () => {
    const input = { intendedSingleRun: true, launchedAsChain: true };
    const snapshot = { ...input };

    assessLaunchModeMismatch(input);

    expect(input).toEqual(snapshot);
  });
});
