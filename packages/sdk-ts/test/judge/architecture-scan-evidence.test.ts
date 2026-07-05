import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { createMemoryArtifactStore } from "../../src/artifacts/index.js";
import { collectEvidence } from "../../src/judge/evidence.js";
import { buildJudgeMessages, type JudgePromptInput } from "../../src/judge/prompt.js";

const execFileAsync = promisify(execFile);

const HEADER = "## EVIDENCE — deterministic architecture scan (added diff lines)";

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

function input(architectureLabels: string[]): JudgePromptInput {
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
    newDependencyLabels: [],
    architectureLabels,
    checkRuns: [],
  };
}

function userContent(architectureLabels: string[]): string {
  const userMessage = buildJudgeMessages(input(architectureLabels)).find((m) => m.role === "user");
  expect(userMessage).toBeDefined();
  return userMessage!.content;
}

describe("architecture scan evidence wire", () => {
  it("collectEvidence populates architectureLabels from the full untruncated diff", async () => {
    workspace = await mkdtemp(join(tmpdir(), "chikory-architecture-evidence-"));
    await execFileAsync("git", ["init", "-q", workspace]);
    await git(workspace, ["config", "user.email", "test@chikory.dev"]);
    await git(workspace, ["config", "user.name", "chikory-test"]);
    await writeFile(join(workspace, "README.md"), "# base\n");
    await git(workspace, ["add", "-A"]);
    await git(workspace, ["commit", "-q", "-m", "base"]);
    const baseCommit = (await git(workspace, ["rev-parse", "HEAD"])).trim();

    const padding = Array.from({ length: 30_000 }, (_, i) => `line ${i}`).join("\n");
    await writeFile(join(workspace, "README.md"), `${padding}\n`);
    await mkdir(join(workspace, "src", "judge"), { recursive: true });
    await writeFile(
      join(workspace, "src", "judge", "rubric.ts"),
      'import { createRunnerWorker } from "../runner/worker.js";\n',
    );

    const collected = await collectEvidence({
      workspaceDir: workspace,
      store: createMemoryArtifactStore(),
      criteria: [],
      sinceCommit: baseCommit,
      criteriaHistory: {},
      stepSummaries: [],
    });

    expect(collected.diffText).not.toContain("createRunnerWorker");
    expect(collected.architectureLabels).toEqual(["judge→runner"]);
  });

  it("renders deterministic architecture labels one per line", () => {
    const content = userContent(["judge→runner", "providers→router"]);

    expect(content).toContain(HEADER);
    expect(content).toContain(`${HEADER}\n- judge→runner\n- providers→router`);
  });

  it("renders none when deterministic architecture labels are empty", () => {
    const content = userContent([]);

    expect(content).toContain(`${HEADER}\n(none)`);
    expect(content).not.toContain("- judge→runner");
  });
});
