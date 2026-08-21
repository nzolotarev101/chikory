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

  it("ignores pre-existing forbidden imports when lines are reordered in the same file", () => {
    const diff = [
      "diff --git a/packages/sdk-ts/src/workflow/agent-loop.ts b/packages/sdk-ts/src/workflow/agent-loop.ts",
      "--- a/packages/sdk-ts/src/workflow/agent-loop.ts",
      "+++ b/packages/sdk-ts/src/workflow/agent-loop.ts",
      "@@ -46,2 +46,2 @@",
      '-import { advanceStrikeCount } from "../runner/strike-accounting.js";',
      '-import { getStandingFindings } from "./standing.js";',
      '+import { getStandingFindings } from "./standing.js";',
      '+import { advanceStrikeCount } from "../runner/strike-accounting.js";',
    ].join("\n");

    expect(scanDiffForLayeringViolations(diff)).toEqual([]);
  });

  it("handles byte-exact dogfood-163 restoration hunk without false-positive violation", () => {
    const diff = [
      "diff --git a/packages/sdk-ts/src/workflow/agent-loop.ts b/packages/sdk-ts/src/workflow/agent-loop.ts",
      "--- a/packages/sdk-ts/src/workflow/agent-loop.ts",
      "+++ b/packages/sdk-ts/src/workflow/agent-loop.ts",
      "@@ -47,1 +47,1 @@",
      '-import { advanceStrikeCount, extra } from "../runner/strike-accounting.js";',
      '+import { advanceStrikeCount } from "../runner/strike-accounting.js";',
    ].join("\n");

    expect(scanDiffForLayeringViolations(diff)).toEqual([]);
  });

  it("allows widening of a pre-existing forbidden import in the pre-image", () => {
    const diff = [
      "diff --git a/src/workflow/agent-loop.ts b/src/workflow/agent-loop.ts",
      "--- a/src/workflow/agent-loop.ts",
      "+++ b/src/workflow/agent-loop.ts",
      "@@ -47,1 +47,1 @@",
      '-import { advanceStrikeCount } from "../runner/strike-accounting.js";',
      '+import { advanceStrikeCount, countStrikes } from "../runner/strike-accounting.js";',
    ].join("\n");

    expect(scanDiffForLayeringViolations(diff)).toEqual([]);
  });

  it("reports newly introduced violations in a multi-hunk diff while ignoring reordered pre-existing violations", () => {
    const diff = [
      "diff --git a/packages/sdk-ts/src/workflow/agent-loop.ts b/packages/sdk-ts/src/workflow/agent-loop.ts",
      "--- a/packages/sdk-ts/src/workflow/agent-loop.ts",
      "+++ b/packages/sdk-ts/src/workflow/agent-loop.ts",
      "@@ -47,2 +47,2 @@",
      '-import { advanceStrikeCount } from "../runner/strike-accounting.js";',
      '-import { helper } from "./helper.js";',
      '+import { helper } from "./helper.js";',
      '+import { advanceStrikeCount } from "../runner/strike-accounting.js";',
      "@@ -100,3 +100,4 @@",
      ' const x = 1;',
      '+import { runCli } from "../cli/main.js";',
      ' const y = 2;',
    ].join("\n");

    expect(scanDiffForLayeringViolations(diff)).toEqual(["workflow→cli"]);
  });

  it("does not report violation when diff hunk carries pre-existing forbidden import in context lines", () => {
    const diff = [
      "diff --git a/src/workflow/agent-loop.ts b/src/workflow/agent-loop.ts",
      "--- a/src/workflow/agent-loop.ts",
      "+++ b/src/workflow/agent-loop.ts",
      "@@ -45,5 +45,5 @@",
      ' import { advanceStrikeCount } from "../runner/strike-accounting.js";',
      '-const oldVal = 1;',
      '+const newVal = 2;',
      '+import { advanceStrikeCount as aliased } from "../runner/strike-accounting.js";',
    ].join("\n");

    expect(scanDiffForLayeringViolations(diff)).toEqual([]);
  });

  it("isolates pre-image context across files in a multi-file diff", () => {
    const diff = [
      "diff --git a/src/workflow/agent-loop.ts b/src/workflow/agent-loop.ts",
      "--- a/src/workflow/agent-loop.ts",
      "+++ b/src/workflow/agent-loop.ts",
      "@@ -47,2 +47,2 @@",
      '-import { advanceStrikeCount } from "../runner/strike-accounting.js";',
      '+import { advanceStrikeCount } from "../runner/strike-accounting.js";',
      "diff --git a/src/types.ts b/src/types.ts",
      "--- a/src/types.ts",
      "+++ b/src/types.ts",
      "@@ -1,2 +1,3 @@",
      ' export type A = string;',
      '+import { runJudgePass } from "./judge/index.js";',
    ].join("\n");

    expect(scanDiffForLayeringViolations(diff)).toEqual(["core→judge"]);
  });

  it("enforces false-positive ceiling (0 violations) and recall floor (100% violations) across the full src/ corpus", () => {
    const layerFiles: Record<string, string> = {
      core: "packages/sdk-ts/src/types.ts",
      providers: "packages/sdk-ts/src/providers/openai.ts",
      router: "packages/sdk-ts/src/router.ts",
      artifacts: "packages/sdk-ts/src/artifacts/index.ts",
      executors: "packages/sdk-ts/src/executors/native.ts",
      judge: "packages/sdk-ts/src/judge/rubric.ts",
      planner: "packages/sdk-ts/src/planner/prompt.ts",
      workflow: "packages/sdk-ts/src/workflow/agent-loop.ts",
      runner: "packages/sdk-ts/src/runner/worker.ts",
    };

    for (const [layer, filePath] of Object.entries(layerFiles)) {
      const isRoot = filePath.endsWith("/types.ts") || filePath.endsWith("/router.ts");
      const cliSpecifier = isRoot ? "./cli/bin.js" : "../cli/bin.js";

      const reorderDiff = [
        `diff --git a/${filePath} b/${filePath}`,
        `--- a/${filePath}`,
        `+++ b/${filePath}`,
        "@@ -10,2 +10,2 @@",
        `-import { someHigher } from "${cliSpecifier}";`,
        '-import { someLocal } from "./local.js";',
        '+import { someLocal } from "./local.js";',
        `+import { someHigher } from "${cliSpecifier}";`,
      ].join("\n");

      expect(
        scanDiffForLayeringViolations(reorderDiff),
        `False positive on reordered diff for ${filePath} (${layer})`,
      ).toEqual([]);
    }

    for (const [layer, filePath] of Object.entries(layerFiles)) {
      const isRoot = filePath.endsWith("/types.ts") || filePath.endsWith("/router.ts");
      const cliSpecifier = isRoot ? "./cli/bin.js" : "../cli/bin.js";

      const appendDiff = [
        `diff --git a/${filePath} b/${filePath}`,
        `--- a/${filePath}`,
        `+++ b/${filePath}`,
        "@@ -100,2 +100,3 @@",
        " export const a = 1;",
        `+import { main } from "${cliSpecifier}";`,
      ].join("\n");

      if (layer !== "runner") {
        expect(
          scanDiffForLayeringViolations(appendDiff),
          `Recall failure on appended diff for ${filePath} (${layer})`,
        ).toContain(`${layer}→cli`);
      }
    }
  });
  /**
   * F-431 (dogfood-164 review). The exoneration must be keyed on the resolved
   * import PATH, not on the layer-pair label. Seven files under
   * `packages/sdk-ts/src` already carry a forbidden edge (12 lines;
   * `workflow/agent-loop.ts` has 5), so a label-keyed exoneration turns each of
   * them into a blind spot: a genuinely new forbidden import lands within three
   * lines of the existing one, which therefore arrives in the same hunk as a
   * CONTEXT line and acquits it. These three shapes are the ones a real
   * `git diff -U3` emits; none of them is named by this run's acceptance checks.
   */
  it("reports a NEW forbidden import even when a DIFFERENT pre-existing one of the same layer pair is context", () => {
    const diff = [
      "diff --git a/packages/sdk-ts/src/workflow/agent-loop.ts b/packages/sdk-ts/src/workflow/agent-loop.ts",
      "index d2942bd..e5295be 100644",
      "--- a/packages/sdk-ts/src/workflow/agent-loop.ts",
      "+++ b/packages/sdk-ts/src/workflow/agent-loop.ts",
      "@@ -45,6 +45,7 @@ import {",
      ' import { calibrateContextWindow } from "../runner/context-window.js";',
      ' import { advanceStrikeCount } from "../runner/strike-accounting.js";',
      '+import { brandNewEscape } from "../runner/worker.js";',
      ' import { isInfraStepFailure } from "../executors/infra-failure.js";',
    ].join("\n");

    expect(scanDiffForLayeringViolations(diff)).toEqual(["workflow→runner"]);
  });

  it("reports a NEW forbidden import that REPLACES a different forbidden import of the same layer pair", () => {
    const diff = [
      "diff --git a/packages/sdk-ts/src/workflow/agent-loop.ts b/packages/sdk-ts/src/workflow/agent-loop.ts",
      "--- a/packages/sdk-ts/src/workflow/agent-loop.ts",
      "+++ b/packages/sdk-ts/src/workflow/agent-loop.ts",
      "@@ -47,1 +47,1 @@",
      '-import { advanceStrikeCount } from "../runner/strike-accounting.js";',
      '+import { createRunnerWorker } from "../runner/worker.js";',
    ].join("\n");

    expect(scanDiffForLayeringViolations(diff)).toEqual(["workflow→runner"]);
  });

  it("still acquits a restore of the SAME module when another forbidden import of the same pair is context", () => {
    const diff = [
      "diff --git a/packages/sdk-ts/src/workflow/agent-loop.ts b/packages/sdk-ts/src/workflow/agent-loop.ts",
      "--- a/packages/sdk-ts/src/workflow/agent-loop.ts",
      "+++ b/packages/sdk-ts/src/workflow/agent-loop.ts",
      "@@ -45,4 +45,4 @@",
      ' import { createRunnerWorker } from "../runner/worker.js";',
      '-import { advanceStrikeCount } from "../runner/strike-accounting.js";',
      '+import { advanceStrikeCount } from "../runner/strike-accounting.js";',
    ].join("\n");

    expect(scanDiffForLayeringViolations(diff)).toEqual([]);
  });
});
