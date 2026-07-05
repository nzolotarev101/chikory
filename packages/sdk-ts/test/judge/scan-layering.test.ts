import { describe, expect, it } from "vitest";

import { scanDiffForLayeringViolations } from "../../src/judge/scan-layering.js";

describe("scanDiffForLayeringViolations", () => {
  it("reports an added upward static import", () => {
    const diff = [
      "diff --git a/packages/sdk-ts/src/judge/rubric.ts b/packages/sdk-ts/src/judge/rubric.ts",
      "+++ b/packages/sdk-ts/src/judge/rubric.ts",
      '+import { createRunnerWorker } from "../runner/worker.js";',
    ].join("\n");

    expect(scanDiffForLayeringViolations(diff)).toEqual(["judge→runner"]);
  });

  it("reports an added upward re-export", () => {
    const diff = [
      "diff --git a/packages/sdk-ts/src/router.ts b/packages/sdk-ts/src/router.ts",
      "+++ b/packages/sdk-ts/src/router.ts",
      '+export { createMemoryArtifactStore } from "./artifacts/index.js";',
    ].join("\n");

    expect(scanDiffForLayeringViolations(diff)).toEqual(["router→artifacts"]);
  });

  it("reports an added upward side-effect import", () => {
    const diff = [
      "diff --git a/src/providers/provider.ts b/src/providers/provider.ts",
      "+++ b/src/providers/provider.ts",
      '+import "../judge/index.js";',
    ].join("\n");

    expect(scanDiffForLayeringViolations(diff)).toEqual(["providers→judge"]);
  });

  it("reports an added upward CommonJS require", () => {
    const diff = [
      "diff --git a/src/util/clamp.ts b/src/util/clamp.ts",
      "+++ b/src/util/clamp.ts",
      '+const worker = require("../runner/worker.js");',
    ].join("\n");

    expect(scanDiffForLayeringViolations(diff)).toEqual(["core→runner"]);
  });

  it("reports an added upward dynamic import", () => {
    const diff = [
      "diff --git a/src/executors/native.ts b/src/executors/native.ts",
      "+++ b/src/executors/native.ts",
      '+const workflow = await import("../workflow/agent-loop.js");',
    ].join("\n");

    expect(scanDiffForLayeringViolations(diff)).toEqual(["executors→workflow"]);
  });

  it("allows same-layer imports", () => {
    const diff = [
      "diff --git a/src/judge/evidence.ts b/src/judge/evidence.ts",
      "+++ b/src/judge/evidence.ts",
      '+import { buildVerdict } from "./harness.js";',
    ].join("\n");

    expect(scanDiffForLayeringViolations(diff)).toEqual([]);
  });

  it("allows downward imports", () => {
    const diff = [
      "diff --git a/src/runner/activities.ts b/src/runner/activities.ts",
      "+++ b/src/runner/activities.ts",
      '+import { runJudgePass } from "../judge/index.js";',
    ].join("\n");

    expect(scanDiffForLayeringViolations(diff)).toEqual([]);
  });

  it("ignores removed lines and file headers", () => {
    const diff = [
      "diff --git a/src/judge/rubric.ts b/src/judge/rubric.ts",
      "+++ b/src/judge/rubric.ts",
      '---import { createRunnerWorker } from "../runner/worker.js";',
      '-import { createRunnerWorker } from "../runner/worker.js";',
    ].join("\n");

    expect(scanDiffForLayeringViolations(diff)).toEqual([]);
  });

  it("ignores external package imports", () => {
    const diff = [
      "diff --git a/src/core.ts b/src/types.ts",
      "+++ b/src/types.ts",
      '+import { z } from "zod";',
    ].join("\n");

    expect(scanDiffForLayeringViolations(diff)).toEqual([]);
  });

  it("ignores imports added in files outside declared layers", () => {
    const diff = [
      "diff --git a/test/judge/scan-layering.test.ts b/test/judge/scan-layering.test.ts",
      "+++ b/test/judge/scan-layering.test.ts",
      '+import { createRunnerWorker } from "../../src/runner/worker.js";',
    ].join("\n");

    expect(scanDiffForLayeringViolations(diff)).toEqual([]);
  });

  it("ignores commented import text", () => {
    const diff = [
      "diff --git a/src/judge/rubric.ts b/src/judge/rubric.ts",
      "+++ b/src/judge/rubric.ts",
      '+// import { createRunnerWorker } from "../runner/worker.js";',
      '+/* import { createRunnerWorker } from "../runner/worker.js"; */',
      '+* import { createRunnerWorker } from "../runner/worker.js";',
    ].join("\n");

    expect(scanDiffForLayeringViolations(diff)).toEqual([]);
  });

  it("uses absolute and src-rooted internal specifiers", () => {
    const diff = [
      "diff --git a/src/judge/rubric.ts b/src/judge/rubric.ts",
      "+++ b/src/judge/rubric.ts",
      '+import { createRunnerWorker } from "/src/runner/worker.js";',
      '+import { agentLoop } from "src/workflow/agent-loop.js";',
    ].join("\n");

    expect(scanDiffForLayeringViolations(diff)).toEqual(["judge→runner", "judge→workflow"]);
  });

  it("returns stable sorted de-duplicated labels across files", () => {
    const diff = [
      "diff --git a/src/providers/openai.ts b/src/providers/openai.ts",
      "+++ b/src/providers/openai.ts",
      '+import { createRouter } from "../router.js";',
      '+import { createRouter as again } from "../router.js";',
      '+import { runJudgePass } from "../judge/index.js";',
      "diff --git a/src/judge/rubric.ts b/src/judge/rubric.ts",
      "+++ b/src/judge/rubric.ts",
      '+import { createRunnerWorker } from "../runner/worker.js";',
    ].join("\n");

    expect(scanDiffForLayeringViolations(diff)).toEqual(["judge→runner", "providers→judge", "providers→router"]);
  });

  it("returns an empty array for an empty diff", () => {
    expect(scanDiffForLayeringViolations("")).toEqual([]);
  });
});
