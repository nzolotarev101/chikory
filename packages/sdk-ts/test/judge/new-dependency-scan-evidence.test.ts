import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { createMemoryArtifactStore } from "../../src/artifacts/index.js";
import { collectEvidence } from "../../src/judge/evidence.js";
import { buildJudgeMessages, type JudgePromptInput } from "../../src/judge/prompt.js";

const execFileAsync = promisify(execFile);

const HEADER = "## EVIDENCE — deterministic new-dependency scan (added diff lines)";

async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", dir, ...args]);
  return stdout;
}

let workspace: string | undefined;

afterEach(async () => {
  if (workspace) {
    await rm(workspace, { recursive: true, force: true });
    workspace = undefined;
  }
});

function input(newDependencyLabels: string[]): JudgePromptInput {
  return {
    goal: "",
    evidence: {
      diffRefs: [],
      criteria: [],
      criteriaHistory: {},
      stepSummaries: [],
      artifacts: [],
    },
    rubric: [],
    diffText: "",
    secretScanLabels: [],
    newDependencyLabels,
    checkRuns: [],
  };
}

function userContent(newDependencyLabels: string[]): string {
  const userMessage = buildJudgeMessages(input(newDependencyLabels)).find((m) => m.role === "user");
  expect(userMessage).toBeDefined();
  return userMessage!.content;
}

describe("new dependency scan evidence wire (WP-215)", () => {
  it("collectEvidence populates newDependencyLabels from newly imported external packages", async () => {
    workspace = await mkdtemp(join(tmpdir(), "chikory-dependency-evidence-"));
    await execFileAsync("git", ["init", "-q", workspace]);
    await git(workspace, ["config", "user.email", "test@chikory.dev"]);
    await git(workspace, ["config", "user.name", "chikory-test"]);
    await writeFile(join(workspace, "app.ts"), "export const value = 1;\n");
    await git(workspace, ["add", "-A"]);
    await git(workspace, ["commit", "-q", "-m", "base"]);
    const baseCommit = (await git(workspace, ["rev-parse", "HEAD"])).trim();

    await writeFile(
      join(workspace, "app.ts"),
      [
        'import express from "express";',
        'import { helper } from "./helper.js";',
        'import { readFile } from "node:fs/promises";',
        "",
        "export const value = helper(express, readFile);",
      ].join("\n"),
    );

    const collected = await collectEvidence({
      workspaceDir: workspace,
      store: createMemoryArtifactStore(),
      criteria: [],
      sinceCommit: baseCommit,
      criteriaHistory: {},
      stepSummaries: [],
    });

    expect(collected.newDependencyLabels).toEqual(["express"]);
  });

  it("renders deterministic new dependency labels one per line", () => {
    const content = userContent(["axios", "zod"]);

    expect(content).toContain(HEADER);
    expect(content).toContain(`${HEADER}\n- axios\n- zod`);
  });

  it("renders none when deterministic new dependency labels are empty", () => {
    const content = userContent([]);

    expect(content).toContain(`${HEADER}\n(none)`);
    expect(content).not.toContain("- axios");
    expect(content).not.toContain("- zod");
  });
});
