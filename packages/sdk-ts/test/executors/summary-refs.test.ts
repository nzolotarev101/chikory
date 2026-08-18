/**
 * Step summary reference normalisation tests (WP-606 / F-390).
 *
 * Asserts at the consumed seam (StepRecord returned by runCliStep), driving a
 * real temporary git workspace at measured magnitude (15 URLs, ~2.3 KB, ~6.6 KB
 * summary) so that ephemeral workspace paths are transformed to durable
 * workspace-relative refs while preserving line numbers and leaving external
 * paths and raw transcript artifacts untouched.
 */
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { createLocalArtifactStore } from "../../src/artifacts/index.js";
import { parseAgyOutput } from "../../src/executors/gemini-cli.js";
import { normalizeWorkspaceRefs, runCliStep } from "../../src/executors/step.js";
import type { ArtifactStore, StepInput } from "../../src/types.js";

const execFileAsync = promisify(execFile);

interface WorkspaceFixture {
  dir: string;
  store: ArtifactStore;
}

async function makeTestWorkspace(): Promise<WorkspaceFixture> {
  const parent = await mkdtemp(join(tmpdir(), "chikory-summary-ref-"));
  const dir = join(parent, "ws");
  await mkdir(dir);
  await mkdir(join(parent, "artifacts"));
  const g = (args: string[]) => execFileAsync("git", ["-C", dir, ...args]);
  await g(["init", "-q"]);
  await g(["config", "user.email", "test@chikory.dev"]);
  await g(["config", "user.name", "chikory-test"]);
  await writeFile(join(dir, "README.md"), "# Test Workspace\n");
  await g(["add", "-A"]);
  await g(["commit", "-q", "-m", "initial"]);
  return { dir, store: createLocalArtifactStore(join(parent, "artifacts")) };
}

function makeInput(dir: string): StepInput {
  return {
    workspaceDir: dir,
    instruction: "implement and summarize changes",
    context: {
      goal: "WP-606 reference normalization",
      acceptanceCriteria: [{ id: "AC-1", description: "refs resolve" }],
      planItem: "normalize references",
      notes: {},
      recentSteps: [],
      injections: [],
      memoryRefs: [],
    },
    limits: { maxSeconds: 30, maxCostUsd: 1 },
  };
}

describe("runCliStep summary reference normalisation (WP-606)", () => {
  it("normalises workspace file:// URLs and bare paths to workspace-relative refs at measured magnitude", async () => {
    const { dir, store } = await makeTestWorkspace();
    const targetFile = "packages/sdk-ts/src/judge/harness.ts";
    const secondFile = "packages/sdk-ts/src/workflow/agent-loop.ts";
    const externalUrl = "https://github.com/org/repo/blob/main/docs/guide.md#L10-L20";
    const systemPath = "/etc/hosts";
    const siblingDir = dir + "-sibling/other.ts";

    // Measured magnitude: 15 URLs, ~2.3 KB of refs in a ~6.6 KB summary.
    const sections: string[] = [
      "# Execution Summary",
      "",
      "Refactored check execution and result parsing across multiple modules:",
      "",
    ];

    for (let i = 1; i <= 15; i += 1) {
      sections.push(
        `* Step ${i}: Updated [\`checkRunner_${i}\`](file://${dir}/${targetFile}#L${100 + i * 5}-L${120 + i * 5}) with retry logic.`,
      );
    }
    sections.push(`* Also updated bare path: ${dir}/${secondFile} for telemetry.`);
    sections.push(`* Reference docs: ${externalUrl}`);
    sections.push(`* Host config: ${systemPath}`);
    sections.push(`* Sibling workspace: ${siblingDir}`);

    const rawSummary = sections.join("\n");
    expect(rawSummary.length).toBeGreaterThan(2000);
    expect(rawSummary.split(dir).length - 1).toBeGreaterThanOrEqual(16);

    const stdoutFile = join(dir, "..", "stdout.txt");
    await writeFile(stdoutFile, "CLI execution finished successfully\n");

    const record = await runCliStep({
      adapterName: "test-adapter",
      store,
      input: makeInput(dir),
      bin: "cat",
      args: [stdoutFile],
      parse: () => ({
        ok: true,
        summary: rawSummary,
        toolCalls: 3,
        tokens: { input: 100, output: 500 },
        costUsd: 0.01,
        costEstimated: false,
      }),
    });

    const summary = record.summary;

    // 1. Workspace absolute directory must be completely removed from workspace refs
    expect(summary).not.toContain(`file://${dir}`);
    expect(summary).not.toContain(`${dir}/${targetFile}`);
    expect(summary).not.toContain(`${dir}/${secondFile}`);

    // 2. Relative paths and line ranges must be preserved
    expect(summary).toContain(targetFile);
    expect(summary).toContain(secondFile);
    expect(summary).toMatch(new RegExp(`${targetFile.replace(/\//g, "\\/")}:105-125`));

    // 3. External URLs, system paths, and sibling directories outside the workspace are untouched
    expect(summary).toContain(externalUrl);
    expect(summary).toContain(systemPath);
    expect(summary).toContain(siblingDir);

    // 4. Significant byte reduction achieved
    expect(summary.length).toBeLessThan(rawSummary.length);
    expect(rawSummary.length - summary.length).toBeGreaterThan(1000);
  });

  it("integrates with real gemini-cli parseAgyOutput through runCliStep", async () => {
    const { dir, store } = await makeTestWorkspace();
    const relPath = "packages/sdk-ts/src/executors/step.ts";

    const agyOutput = [
      "<notification><task_id>task-999</task_id><exit_code>0</exit_code></notification>",
      '<gmsg name="task_notification" id="task-999">Task completed</gmsg>',
      `Updated [\`runCliStep\`](file://${dir}/${relPath}#L96-L160) to normalise summary references.`,
      `Verified with ${dir}/${relPath}:200.`,
      "CHIKORY_TASK_COMPLETE",
    ].join("\n");

    const stdoutFile = join(dir, "..", "agy-out.txt");
    await writeFile(stdoutFile, agyOutput);

    const record = await runCliStep({
      adapterName: "gemini-cli",
      store,
      input: makeInput(dir),
      bin: "cat",
      args: [stdoutFile],
      parse: parseAgyOutput("test prompt"),
    });

    expect(record.status).toBe("SUCCESS");
    expect(record.claimsComplete).toBe(true);
    expect(record.summary).not.toContain("<notification>");
    expect(record.summary).not.toContain("<gmsg");
    expect(record.summary).not.toContain(dir);
    expect(record.summary).toContain(relPath);
    expect(record.summary).toContain(`${relPath}:96-160`);
    expect(record.summary).toContain(`${relPath}:200`);
  });

  it("leaves the transcript artifact containing raw un-normalised stdout and stderr", async () => {
    const { dir, store } = await makeTestWorkspace();
    const rawStdout = `Emitted ref at file://${dir}/packages/sdk-ts/src/index.ts#L1-L10`;
    const stdoutFile = join(dir, "..", "raw-stdout.txt");
    await writeFile(stdoutFile, rawStdout);

    const record = await runCliStep({
      adapterName: "test-adapter",
      store,
      input: makeInput(dir),
      bin: "cat",
      args: [stdoutFile],
      parse: (stdout) => ({
        ok: true,
        summary: stdout.trim(),
        toolCalls: 0,
        tokens: { input: 10, output: 10 },
        costUsd: 0,
        costEstimated: true,
      }),
    });

    const transcriptBytes = await store.get(record.transcriptRef);
    const transcriptContent = new TextDecoder().decode(transcriptBytes);

    // Transcript artifact must preserve original raw stdout verbatim
    expect(transcriptContent).toContain(`file://${dir}/packages/sdk-ts/src/index.ts#L1-L10`);
    // While StepRecord.summary is normalised
    expect(record.summary).not.toContain(dir);
    expect(record.summary).toBe("Emitted ref at packages/sdk-ts/src/index.ts:1-10");
  });

  it("returns byte-identical output when summary has nothing to normalise", async () => {
    const { dir, store } = await makeTestWorkspace();
    const cleanSummary = "Refactored packages/sdk-ts/src/index.ts:15 and all 25 tests pass.";
    const stdoutFile = join(dir, "..", "clean-out.txt");
    await writeFile(stdoutFile, cleanSummary);

    const record = await runCliStep({
      adapterName: "test-adapter",
      store,
      input: makeInput(dir),
      bin: "cat",
      args: [stdoutFile],
      parse: () => ({
        ok: true,
        summary: cleanSummary,
        toolCalls: 1,
        tokens: { input: 10, output: 10 },
        costUsd: 0,
        costEstimated: true,
      }),
    });

    expect(record.summary).toBe(cleanSummary);
  });

  it("preserves empty summaries without adding headers or newlines", async () => {
    const { dir, store } = await makeTestWorkspace();
    const stdoutFile = join(dir, "..", "empty-out.txt");
    await writeFile(stdoutFile, "");

    const record = await runCliStep({
      adapterName: "test-adapter",
      store,
      input: makeInput(dir),
      bin: "cat",
      args: [stdoutFile],
      parse: () => ({
        ok: true,
        summary: "",
        toolCalls: 0,
        tokens: { input: 0, output: 0 },
        costUsd: 0,
        costEstimated: true,
      }),
    });

    expect(record.summary).toBe("");
  });

  it("normalises summary on step failure branches as well", async () => {
    const { dir, store } = await makeTestWorkspace();
    const failedSummary = `Failed while modifying file://${dir}/packages/sdk-ts/src/error.ts#L45`;
    const stdoutFile = join(dir, "..", "fail-out.txt");
    await writeFile(stdoutFile, failedSummary);

    const record = await runCliStep({
      adapterName: "test-adapter",
      store,
      input: makeInput(dir),
      bin: "cat",
      args: [stdoutFile],
      parse: () => ({
        ok: false,
        summary: failedSummary,
        failure: { reason: "syntax error in file", retriable: false },
        toolCalls: 1,
        tokens: { input: 10, output: 10 },
        costUsd: 0,
        costEstimated: true,
      }),
    });

    expect(record.status).toBe("FAILED");
    expect(record.summary).not.toContain(dir);
    expect(record.summary).toBe("Failed while modifying packages/sdk-ts/src/error.ts:45");
  });
});

describe("normalizeWorkspaceRefs unit variations", () => {
  const ws = "/workspace/chikory-run";

  it("handles multiple URL hash formats (#L1-L10, #L5, #1-10, #5)", () => {
    expect(normalizeWorkspaceRefs(`file://${ws}/src/a.ts#L1-L10`, ws)).toBe("src/a.ts:1-10");
    expect(normalizeWorkspaceRefs(`file://${ws}/src/a.ts#L1-10`, ws)).toBe("src/a.ts:1-10");
    expect(normalizeWorkspaceRefs(`file://${ws}/src/a.ts#1-10`, ws)).toBe("src/a.ts:1-10");
    expect(normalizeWorkspaceRefs(`file://${ws}/src/a.ts#L5`, ws)).toBe("src/a.ts:5");
    expect(normalizeWorkspaceRefs(`file://${ws}/src/a.ts#5`, ws)).toBe("src/a.ts:5");
  });

  it("handles colon line ranges (:1-10, :5)", () => {
    expect(normalizeWorkspaceRefs(`${ws}/src/b.ts:1-10`, ws)).toBe("src/b.ts:1-10");
    expect(normalizeWorkspaceRefs(`${ws}/src/b.ts:5`, ws)).toBe("src/b.ts:5");
  });

  it("handles trailing sentence punctuation without line numbers", () => {
    expect(normalizeWorkspaceRefs(`Edited ${ws}/src/c.ts.`, ws)).toBe("Edited src/c.ts.");
    expect(normalizeWorkspaceRefs(`Edited ${ws}/src/c.ts, and more`, ws)).toBe("Edited src/c.ts, and more");
    expect(normalizeWorkspaceRefs(`Check ${ws}/src/c.ts!`, ws)).toBe("Check src/c.ts!");
  });

  it("safely handles empty inputs and root directory edge cases", () => {
    expect(normalizeWorkspaceRefs("", ws)).toBe("");
    expect(normalizeWorkspaceRefs("unchanged", "")).toBe("unchanged");
    expect(normalizeWorkspaceRefs("unchanged", "/")).toBe("unchanged");
  });
});
