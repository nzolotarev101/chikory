/**
 * Judge harness over a fake wire (WP-131). Faking the transport, not the LLM
 * (router.md Testing): a local HTTP server speaks the openai-compat wire
 * format and returns canned `JudgeForm` JSON; the unit under test is the
 * harness — evidence collection, JD-4 overrides, deterministic verdict,
 * failure-as-ESCALATE.
 */
import { execFile } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMemoryArtifactStore } from "../../src/artifacts/index.js";
import {
  applyCheckOverrides,
  baseCheckpointId,
  runJudgePass,
  STANDING_RUBRIC,
  type RunJudgePassInput,
} from "../../src/judge/index.js";
import { createRouter } from "../../src/router.js";
import type { ArtifactStore, JudgeForm, ModelChoice, RoutingPolicy } from "../../src/types.js";

const execFileAsync = promisify(execFile);

type Handler = (req: IncomingMessage, res: ServerResponse, body: string, hit: number) => void;

interface FakeServer {
  url: string;
  hits: number;
  requests: string[];
  setHandler(handler: Handler): void;
  close(): Promise<void>;
}

async function startFakeServer(): Promise<FakeServer> {
  let handler: Handler = (_req, res) => res.end();
  let hits = 0;
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => {
      hits++;
      fake.hits = hits;
      fake.requests.push(body);
      handler(req, res, body, hits);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const fake: FakeServer = {
    url: `http://127.0.0.1:${port}`,
    hits: 0,
    requests: [],
    setHandler: (h) => (handler = h),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
  return fake;
}

function chatCompletion(content: string): string {
  return JSON.stringify({
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  });
}

const JUDGE_MODEL: ModelChoice = { provider: "openai-compat", model: "test-judge" };

function judgePolicy(): RoutingPolicy {
  return { stages: { plan: JUDGE_MODEL, code: JUDGE_MODEL, review: JUDGE_MODEL, judge: JUDGE_MODEL } };
}

const allPassForm: JudgeForm = {
  criterionResults: [{ id: "AC-1", pass: true, justification: "diff implements it" }],
  rubricResults: STANDING_RUBRIC.map((r) => ({ id: r.id, pass: true, justification: "clean" })),
  concerns: [],
};

async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", dir, ...args]);
  return stdout;
}

async function initGitRepo(dir: string, fileName: string, content: string): Promise<string> {
  await execFileAsync("git", ["init", "-q", dir]);
  await git(dir, ["config", "user.email", "test@chikory.dev"]);
  await git(dir, ["config", "user.name", "chikory-test"]);
  await writeFile(join(dir, fileName), content);
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-q", "-m", "base"]);
  return (await git(dir, ["rev-parse", "HEAD"])).trim();
}

let workspace: string;
let baseCommit: string;
let fake: FakeServer;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "chikory-judge-"));
  await execFileAsync("git", ["init", "-q", workspace]);
  await git(workspace, ["config", "user.email", "test@chikory.dev"]);
  await git(workspace, ["config", "user.name", "chikory-test"]);
  await writeFile(join(workspace, "app.txt"), "v1\n");
  await git(workspace, ["add", "-A"]);
  await git(workspace, ["commit", "-q", "-m", "base"]);
  baseCommit = (await git(workspace, ["rev-parse", "HEAD"])).trim();
  // The step's (uncommitted) work product.
  await writeFile(join(workspace, "app.txt"), "v2\n");
  fake = await startFakeServer();
});

afterEach(async () => {
  await fake.close();
  await rm(workspace, { recursive: true, force: true });
});

function input(overrides: Partial<RunJudgePassInput> = {}): RunJudgePassInput {
  return {
    runId: "run-judge-test",
    router: createRouter(judgePolicy(), {
      env: { OPENAI_COMPAT_BASE_URL: "http://unused.invalid" },
      baseUrls: { "openai-compat": fake.url },
      retry: { baseDelayMs: 1, maxDelayMs: 5, jitter: false },
    }),
    judgeModel: JUDGE_MODEL,
    workspaceDir: workspace,
    store: createMemoryArtifactStore(),
    goal: "bump app.txt to v2",
    criteria: [{ id: "AC-1", description: "app.txt contains v2" }],
    sinceCommit: baseCommit,
    criteriaHistory: {},
    stepSummaries: ["step 1: edited app.txt"],
    ...overrides,
  };
}

describe("runJudgePass (WP-131)", () => {
  it("happy path: evidence collected, form filled, PROCEED computed in code", async () => {
    fake.setHandler((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(chatCompletion(JSON.stringify(allPassForm)));
    });

    const { verdict, collected } = await runJudgePass(input());

    expect(verdict.kind).toBe("PROCEED");
    expect(verdict.rationale).toContain("all 1 acceptance criteria pass");
    expect(verdict.judgeModel).toEqual(JUDGE_MODEL);
    expect(verdict.tokens).toEqual({ input: 10, output: 5 });
    expect(collected.evidence.diffRefs).toHaveLength(1);
    expect(collected.diffText).toContain("-v1");
    expect(collected.diffText).toContain("+v2");
    expect(collected.evidenceBytes).toBeGreaterThan(0);

    // The judge prompt carries evidence, not executor persona: rubric +
    // diff + history present in the wire request.
    const wire = JSON.parse(fake.requests[0]) as { messages: Array<{ content: string }> };
    const sent = wire.messages.map((m) => m.content).join("\n");
    expect(sent).toContain("no_secrets_introduced");
    expect(sent).toContain("+v2");
    expect(sent).toContain("step 1: edited app.txt");
  });

  it("collects one diff artifact and prompt section per writable workspace repo", async () => {
    fake.setHandler((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(chatCompletion(JSON.stringify(allPassForm)));
    });

    const multiWorkspace = await mkdtemp(join(tmpdir(), "chikory-judge-multi-"));
    try {
      const apiBase = await initGitRepo(join(multiWorkspace, "service-api"), "api.txt", "api base\n");
      const workerBase = await initGitRepo(
        join(multiWorkspace, "service-worker"),
        "worker.txt",
        "worker base\n",
      );
      await writeFile(join(multiWorkspace, "service-api", "api.txt"), "api changed\n");
      await writeFile(join(multiWorkspace, "service-worker", "worker.txt"), "worker changed\n");
      const store: ArtifactStore = createMemoryArtifactStore();

      const { collected } = await runJudgePass(
        input({
          workspaceDir: multiWorkspace,
          store,
          workspaceRepos: [
            { name: "service-api", relativePath: "service-api", writable: true },
            { name: "service-worker", relativePath: "service-worker", writable: true },
          ],
          repoDiffBases: {
            "service-api": apiBase,
            "service-worker": workerBase,
          },
        }),
      );

      expect(collected.evidence.diffRefs).toHaveLength(2);
      expect(collected.evidence.diffRefs.map((ref) => ref.summary)).toEqual([
        expect.stringContaining("workspace diff for service-api"),
        expect.stringContaining("workspace diff for service-worker"),
      ]);
      await expect(
        store.get(collected.evidence.diffRefs[0]!).then((bytes) => Buffer.from(bytes).toString()),
      ).resolves.toContain("+api changed");
      await expect(
        store.get(collected.evidence.diffRefs[1]!).then((bytes) => Buffer.from(bytes).toString()),
      ).resolves.toContain("+worker changed");
      expect(collected.diffSections.map((section) => section.repoName)).toEqual([
        "service-api",
        "service-worker",
      ]);

      const wire = JSON.parse(fake.requests[0]) as { messages: Array<{ content: string }> };
      const sent = wire.messages.map((m) => m.content).join("\n");
      expect(sent).toContain("## EVIDENCE — workspace diffs since last verdict (per writable repo)");
      expect(sent).toContain("### repo `service-api` (service-api)");
      expect(sent).toContain("### repo `service-worker` (service-worker)");
      expect(sent).toContain("+api changed");
      expect(sent).toContain("+worker changed");
    } finally {
      await rm(multiWorkspace, { recursive: true, force: true });
    }
  });

  it("JD-4: judge-executed check overrides the LLM's claimed pass", async () => {
    const lyingForm: JudgeForm = {
      ...allPassForm,
      criterionResults: [{ id: "AC-1", pass: true, justification: "looks done" }],
    };
    fake.setHandler((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(chatCompletion(JSON.stringify(lyingForm)));
    });

    const { verdict, collected } = await runJudgePass(
      input({ criteria: [{ id: "AC-1", description: "check fails", check: "exit 7" }] }),
    );

    expect(collected.checkRuns).toHaveLength(1);
    expect(collected.checkRuns[0].exitCode).toBe(7);
    const ac1 = verdict.form.criterionResults.find((r) => r.id === "AC-1");
    expect(ac1?.pass).toBe(false);
    expect(ac1?.justification).toContain("exited 7");
    // tests_pass rubric item is overridden too (non-destructive → still PROCEED).
    const testsPass = verdict.form.rubricResults.find((r) => r.id === "tests_pass");
    expect(testsPass?.pass).toBe(false);
    expect(verdict.kind).toBe("PROCEED");
  });

  it("JD-4: a passing check overrides the LLM's claimed fail", async () => {
    const pessimistForm: JudgeForm = {
      ...allPassForm,
      criterionResults: [{ id: "AC-1", pass: false, justification: "doubt it" }],
    };
    fake.setHandler((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(chatCompletion(JSON.stringify(pessimistForm)));
    });

    const { verdict } = await runJudgePass(
      input({ criteria: [{ id: "AC-1", description: "check passes", check: "grep -q v2 app.txt" }] }),
    );

    expect(verdict.form.criterionResults[0].pass).toBe(true);
    expect(verdict.kind).toBe("PROCEED");
  });

  it("destructive rubric fail → ROLLBACK targeting lastGood (or run base)", async () => {
    const badForm: JudgeForm = {
      ...allPassForm,
      rubricResults: STANDING_RUBRIC.map((r) => ({
        id: r.id,
        pass: r.id !== "no_secrets_introduced",
        justification: r.id === "no_secrets_introduced" ? "API key in diff" : "clean",
      })),
    };
    fake.setHandler((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(chatCompletion(JSON.stringify(badForm)));
    });

    const withCheckpoint = await runJudgePass(input({ lastGoodCheckpointId: "run-judge-test@4" }));
    expect(withCheckpoint.verdict.kind).toBe("ROLLBACK");
    expect(withCheckpoint.verdict.rollbackTo).toBe("run-judge-test@4");

    const withoutCheckpoint = await runJudgePass(input());
    expect(withoutCheckpoint.verdict.rollbackTo).toBe(baseCheckpointId("run-judge-test"));
  });

  it("router failure → ESCALATE verdict, zero cost, never a throw", async () => {
    fake.setHandler((_req, res) => {
      res.statusCode = 500;
      res.end("boom");
    });

    const { verdict } = await runJudgePass(input());

    expect(verdict.kind).toBe("ESCALATE");
    expect(verdict.escalateReason).toContain("judge LLM call failed");
    expect(verdict.costUsd).toBe(0);
    expect(verdict.form.criterionResults).toHaveLength(0);
  });

  it("schema-invalid form (after router re-ask) → ESCALATE", async () => {
    // Valid JSON, wrong shape — passes the router's JSON gate, fails JudgeFormSchema.
    fake.setHandler((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(chatCompletion(JSON.stringify({ verdict: "PROCEED" })));
    });

    const { verdict } = await runJudgePass(input());

    expect(verdict.kind).toBe("ESCALATE");
    expect(verdict.escalateReason).toContain("schema validation");
    expect(verdict.tokens).toEqual({ input: 10, output: 5 });
  });

  it("form missing a rubric item → ESCALATE naming the gap", async () => {
    const partialForm: JudgeForm = {
      ...allPassForm,
      rubricResults: allPassForm.rubricResults.filter((r) => r.id !== "scope_matches_instruction"),
    };
    fake.setHandler((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(chatCompletion(JSON.stringify(partialForm)));
    });

    const { verdict } = await runJudgePass(input());

    expect(verdict.kind).toBe("ESCALATE");
    expect(verdict.escalateReason).toContain("scope_matches_instruction");
  });

  it("unknown ids in the form are dropped, not smuggled into the verdict", async () => {
    const paddedForm: JudgeForm = {
      ...allPassForm,
      criterionResults: [
        ...allPassForm.criterionResults,
        { id: "AC-999", pass: false, justification: "invented" },
      ],
    };
    fake.setHandler((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(chatCompletion(JSON.stringify(paddedForm)));
    });

    const { verdict } = await runJudgePass(input());

    expect(verdict.form.criterionResults.map((r) => r.id)).toEqual(["AC-1"]);
    expect(verdict.kind).toBe("PROCEED");
  });
});

describe("applyCheckOverrides infra classification (WP-263(b))", () => {
  const criteria = [{ id: "AC-1", description: "checked criterion", check: "true" }];
  const llmForm: JudgeForm = {
    criterionResults: [{ id: "AC-1", pass: true, justification: "LLM says done" }],
    rubricResults: STANDING_RUBRIC.map((r) => ({ id: r.id, pass: true, justification: "ok" })),
    concerns: [],
  };
  const checkRun = {
    criterionId: "AC-1",
    command: "true",
    output: "",
    durationMs: 1,
  };

  it("an INFRA-failed check fails the criterion conservatively but carries the flag", () => {
    const result = applyCheckOverrides(llmForm, criteria, STANDING_RUBRIC, [
      { ...checkRun, exitCode: 1, infraFailed: true },
    ]);
    if ("error" in result) throw new Error(result.error);
    const ac1 = result.form.criterionResults.find((r) => r.id === "AC-1");
    expect(ac1?.pass).toBe(false); // never seal SUCCESS on an unproven check
    expect(ac1?.infraFailed).toBe(true);
    expect(ac1?.justification).toContain("DID NOT COMPLETE");
    // tests_pass distinguishes "infra died" from "code red".
    const testsPass = result.form.rubricResults.find((r) => r.id === "tests_pass");
    expect(testsPass?.pass).toBe(false);
    expect(testsPass?.justification).toContain("DID NOT COMPLETE (infra");
    expect(testsPass?.infraFailed).toBe(true);
  });

  it("a completed red check stays a plain code red (no flag)", () => {
    const result = applyCheckOverrides(llmForm, criteria, STANDING_RUBRIC, [
      { ...checkRun, exitCode: 1, infraFailed: false },
    ]);
    if ("error" in result) throw new Error(result.error);
    const ac1 = result.form.criterionResults.find((r) => r.id === "AC-1");
    expect(ac1?.pass).toBe(false);
    expect(ac1?.infraFailed).toBeUndefined();
    expect(ac1?.justification).toContain("exited 1");
    const testsPass = result.form.rubricResults.find((r) => r.id === "tests_pass");
    expect(testsPass?.infraFailed).toBeUndefined();
  });
});
