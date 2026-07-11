import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, inject, test } from "vitest";

import {
  artifactsDir,
  collectPerRepoDiffs,
  collectWorkspaceRepos,
  createLocalArtifactStore,
  createRunnerWorker,
  createTemporalRunner,
  Journal,
  journalPath,
  runTotals,
  workspaceDir,
  type AdapterRegistry,
  type ArtifactStore,
  type ChainNodeHandoff,
  type Checkpoint,
  type ExecutorAdapter,
  type JudgePayload,
  type RunStatusReport,
  type StepRecord,
  type StepPayload,
  type TaskSpec,
  type VerdictPayload,
} from "../../src/index.js";
import { main } from "../../src/cli/main.js";
import { renderTrace } from "../../src/cli/trace.js";
import { sharedArtifactsDir } from "../../src/runner/paths.js";
import {
  initSourceRepo,
  judgeForm,
  makeJudgedSpec,
  scriptedRegistry,
  startFakeJudgeWire,
  TERMINAL_STATUSES,
  waitFor,
} from "./helpers.js";

const address = inject("temporalAddress");
const bundlePath = inject("workflowBundlePath");
const execFileAsync = promisify(execFile);

async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", dir, ...args], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout.trim();
}

async function initRepo(dir: string, fileName: string, content: string): Promise<string> {
  await execFileAsync("git", ["init", "-b", "main", dir]);
  await git(dir, ["config", "user.name", "test"]);
  await git(dir, ["config", "user.email", "test@chikory.local"]);
  await writeFile(join(dir, fileName), content);
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-m", "init"]);
  return dir;
}

function multiRepoAdapter(spec: TaskSpec, store: ArtifactStore): ExecutorAdapter {
  const workspaceRepos = collectWorkspaceRepos(spec.repos);
  return {
    name: "multi-repo-scripted",
    modelFamily: "anthropic",
    async runStep(input): Promise<StepRecord> {
      const contextRepo = workspaceRepos.readOnly[0];
      const context = contextRepo
        ? await readFile(join(input.workspaceDir, contextRepo.relativePath, "context.txt"), "utf8")
        : "";
      const [apiRepo, workerRepo] = workspaceRepos.writable;
      if (!apiRepo || !workerRepo) throw new Error("multi-repo test needs two writable repos");

      await writeFile(
        join(input.workspaceDir, apiRepo.relativePath, "step-output.txt"),
        `${input.instruction}\n${context}`,
      );
      await writeFile(
        join(input.workspaceDir, workerRepo.relativePath, "step-output.txt"),
        `${input.context.planItem}\n${context}`,
      );

      const [diffRef, transcriptRef] = await Promise.all([
        store.put("multi-repo diff", {
          kind: "diff",
          summary: "multi-repo diff",
        }),
        store.put("multi-repo transcript", {
          kind: "transcript",
          summary: "multi-repo transcript",
        }),
      ]);

      return {
        status: "SUCCESS",
        diffRef,
        transcriptRef,
        summary: "wrote outputs to both writable repo subdirs",
        toolCalls: 2,
        tokens: { input: 10, output: 5 },
        costUsd: 0.01,
        costEstimated: false,
        durationMs: 0,
        claimsComplete: true,
      };
    },
  };
}

function crossRepoWriteSetAdapter(spec: TaskSpec, store: ArtifactStore): ExecutorAdapter {
  const workspaceRepos = collectWorkspaceRepos(spec.repos);
  return {
    name: "cross-repo-writeset-scripted",
    modelFamily: "anthropic",
    async runStep(input): Promise<StepRecord> {
      const [apiRepo, workerRepo] = workspaceRepos.writable;
      if (!apiRepo || !workerRepo) throw new Error("cross-repo writeSet test needs two writable repos");

      await writeFile(join(input.workspaceDir, apiRepo.relativePath, "api-output.txt"), "api change\n");
      await writeFile(
        join(input.workspaceDir, workerRepo.relativePath, "worker-output.txt"),
        "worker change\n",
      );

      const [diffRef, transcriptRef] = await Promise.all([
        store.put("cross-repo writeSet diff", {
          kind: "diff",
          summary: "cross-repo writeSet diff",
        }),
        store.put("cross-repo writeSet transcript", {
          kind: "transcript",
          summary: "cross-repo writeSet transcript",
        }),
      ]);

      return {
        status: "SUCCESS",
        diffRef,
        transcriptRef,
        summary: "wrote repo-relative files in both writable repos",
        toolCalls: 2,
        tokens: { input: 10, output: 5 },
        costUsd: 0.01,
        costEstimated: false,
        durationMs: 0,
        claimsComplete: true,
      };
    },
  };
}

interface ResumeProbe {
  apiDirtyExists: boolean;
  workerDirtyExists: boolean;
  apiHead: string;
  workerHead: string;
}

function resumableMultiRepoAdapter(
  spec: TaskSpec,
  store: ArtifactStore,
  calls: number[],
  resumeProbes: ResumeProbe[],
): ExecutorAdapter {
  const workspaceRepos = collectWorkspaceRepos(spec.repos);
  return {
    name: "multi-repo-resume-scripted",
    modelFamily: "anthropic",
    async runStep(input): Promise<StepRecord> {
      const attempt = calls.length + 1;
      calls.push(attempt);
      const [apiRepo, workerRepo] = workspaceRepos.writable;
      if (!apiRepo || !workerRepo) throw new Error("multi-repo resume test needs two writable repos");

      const apiDir = join(input.workspaceDir, apiRepo.relativePath);
      const workerDir = join(input.workspaceDir, workerRepo.relativePath);
      if (attempt === 5) {
        resumeProbes.push({
          apiDirtyExists: existsSync(join(apiDir, "dirty-after-seal.txt")),
          workerDirtyExists: existsSync(join(workerDir, "dirty-after-seal.txt")),
          apiHead: await git(apiDir, ["rev-parse", "HEAD"]),
          workerHead: await git(workerDir, ["rev-parse", "HEAD"]),
        });
      }

      await writeFile(
        join(apiDir, "step-output.txt"),
        `attempt ${attempt}\n${input.context.judgeFeedback ?? ""}\n`,
      );
      await writeFile(
        join(workerDir, "step-output.txt"),
        `attempt ${attempt}\n${input.context.judgeFeedback ?? ""}\n`,
      );

      const [diffRef, transcriptRef] = await Promise.all([
        store.put(`multi-repo resume diff ${attempt}`, {
          kind: "diff",
          summary: `multi-repo resume diff ${attempt}`,
        }),
        store.put(`multi-repo resume transcript ${attempt}`, {
          kind: "transcript",
          summary: `multi-repo resume transcript ${attempt}`,
        }),
      ]);

      return {
        status: "SUCCESS",
        diffRef,
        transcriptRef,
        summary: [
          `multi-repo resume attempt ${attempt}`,
          ...(input.context.judgeFeedback ? [input.context.judgeFeedback] : []),
        ].join("; "),
        toolCalls: 2,
        tokens: { input: 10, output: 5 },
        costUsd: 0.01,
        costEstimated: false,
        durationMs: 0,
      };
    },
  };
}

describe.skipIf(address === null)("multi-repo workspace setup", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  async function awaitTerminal(handle: { status(): Promise<RunStatusReport> }) {
    return waitFor<RunStatusReport>(
      async () => {
        const current = await handle.status();
        return TERMINAL_STATUSES.includes(current.status) ? current : undefined;
      },
      { what: "multi-repo workspace run terminal status" },
    );
  }

  test("live runner seals SUCCESS with commits and judge diffs spanning two writable repos", async () => {
    expect(collectPerRepoDiffs).toBeTypeOf("function");

    const tmp = await mkdtemp(join(tmpdir(), "chikory-multi-repo-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));

    const apiRepo = await initRepo(join(tmp, "service-api"), "api.txt", "api base\n");
    const workerRepo = await initRepo(join(tmp, "service-worker"), "worker.txt", "worker base\n");
    const spec = makeJudgedSpec({
      repoUrl: apiRepo,
      name: "multi-repo-runner-test",
      repos: [
        { url: apiRepo, writable: true },
        { url: workerRepo, writable: true },
      ],
      maxSteps: 2,
      cadence: 10,
    });
    const resolved = collectWorkspaceRepos(spec.repos);
    expect(resolved.all.map((repo) => repo.relativePath)).toEqual(["service-api", "service-worker"]);

    const dataDir = join(tmp, "data");
    const taskQueue = `tq-${randomUUID()}`;
    const adapters: AdapterRegistry = {
      "multi-repo-scripted": (ctx) => multiRepoAdapter(spec, ctx.store),
    };
    const wire = await startFakeJudgeWire([judgeForm({ criteria: { "AC-1": true } })]);
    cleanups.push(() => wire.close());

    const worker = await createRunnerWorker({
      adapters,
      address: address!,
      taskQueue,
      dataDir,
      workflowBundlePath: bundlePath!,
      routerOptions: { baseUrls: { "openai-compat": wire.url } },
    });
    const workerDone = worker.run();
    const runner = createTemporalRunner({ address: address!, taskQueue, dataDir });
    cleanups.push(async () => {
      worker.shutdown();
      await workerDone;
      await runner.close();
    });

    const handle = await runner.start({
      ...spec,
      executor: { adapter: "multi-repo-scripted", family: "anthropic" },
    });
    const report = await awaitTerminal(handle);
    expect(report.status).toBe("SUCCESS");
    expect(wire.hits).toBe(1);

    const ws = workspaceDir(dataDir, handle.runId);
    for (const workspaceRepo of resolved.all) {
      await expect(
        git(join(ws, workspaceRepo.relativePath), ["rev-parse", "--is-inside-work-tree"]),
      ).resolves.toBe("true");
    }
    await expect(readFile(join(ws, "service-api", "step-output.txt"), "utf8")).resolves.toBe(
      "exercise the journaled agent loop\n",
    );
    await expect(readFile(join(ws, "service-worker", "step-output.txt"), "utf8")).resolves.toBe(
      "exercise the journaled agent loop\n",
    );

    await expect(git(join(ws, "service-api"), ["rev-parse", "--abbrev-ref", "HEAD"])).resolves.toBe(
      `chikory/run-${handle.runId}`,
    );
    await expect(
      git(join(ws, "service-worker"), ["rev-parse", "--abbrev-ref", "HEAD"]),
    ).resolves.toBe(`chikory/run-${handle.runId}`);

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const judgeEntries = journal.entries("judge").map((entry) => entry.payload as JudgePayload);
      expect(judgeEntries).toHaveLength(1);
      expect(judgeEntries[0]!.evidenceRefs.map((ref) => ref.summary)).toEqual([
        expect.stringContaining("workspace diff for service-api"),
        expect.stringContaining("workspace diff for service-worker"),
      ]);

      const store = createLocalArtifactStore(artifactsDir(dataDir, handle.runId));
      const [apiDiff, workerDiff] = await Promise.all(
        judgeEntries[0]!.evidenceRefs.map((ref) =>
          store.get(ref).then((bytes) => Buffer.from(bytes).toString("utf8")),
        ),
      );
      expect(apiDiff).toContain("### repo service-api (service-api)");
      expect(apiDiff).toContain("+exercise the journaled agent loop");
      expect(workerDiff).toContain("### repo service-worker (service-worker)");
      expect(workerDiff).toContain("+exercise the journaled agent loop");

      const checkpoints = journal.entries("checkpoint").map((entry) => entry.payload as Checkpoint);
      expect(checkpoints).toHaveLength(1);
      expect(Object.keys(checkpoints[0]!.gitCommits).sort()).toEqual(
        resolved.writable.map((repo) => repo.name).sort(),
      );
      expect(checkpoints[0]!.perRepoCommits).toEqual(checkpoints[0]!.gitCommits);
      for (const workspaceRepo of resolved.writable) {
        await expect(
          git(join(ws, workspaceRepo.relativePath), [
            "cat-file",
            "-t",
            checkpoints[0]!.gitCommits[workspaceRepo.name]!,
          ]),
        ).resolves.toBe("commit");
      }

      const run = journal.getRun();
      expect(run).toBeDefined();
      const trace = renderTrace(run!, journal.entries(), runTotals(journal));
      expect(trace).toContain("        repos 2");
      expect(trace).toContain(
        `          service-api: diff ${judgeEntries[0]!.evidenceRefs[0]!.bytes} bytes · commit ${checkpoints[0]!.gitCommits["service-api"]!.slice(0, 12)}`,
      );
      expect(trace).toContain(
        `          service-worker: diff ${judgeEntries[0]!.evidenceRefs[1]!.bytes} bytes · commit ${checkpoints[0]!.gitCommits["service-worker"]!.slice(0, 12)}`,
      );

      const statusOut: string[] = [];
      const statusCode = await main(
        ["status", handle.runId, "--data-dir", dataDir, "--address", address!],
        {
          out: (line) => statusOut.push(line),
          err: () => {},
        },
      );
      expect(statusCode).toBe(0);
      const statusText = statusOut.join("\n");
      expect(statusText).toContain("  repos        2");
      expect(statusText).toContain(
        `    service-api: diff ${judgeEntries[0]!.evidenceRefs[0]!.bytes} bytes · commit ${checkpoints[0]!.gitCommits["service-api"]!.slice(0, 12)}`,
      );
      expect(statusText).toContain(
        `    service-worker: diff ${judgeEntries[0]!.evidenceRefs[1]!.bytes} bytes · commit ${checkpoints[0]!.gitCommits["service-worker"]!.slice(0, 12)}`,
      );
    } finally {
      journal.close();
    }
  });

  test("live one-repo run still seals with the legacy checkpoint key and single diff evidence", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-one-repo-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));

    const repoUrl = await initSourceRepo(join(tmp, "src"), { claimsCompleteSteps: [1] });
    const dataDir = join(tmp, "data");
    const taskQueue = `tq-${randomUUID()}`;
    const wire = await startFakeJudgeWire([judgeForm({ criteria: { "AC-1": true } })]);
    cleanups.push(() => wire.close());

    const worker = await createRunnerWorker({
      adapters: scriptedRegistry,
      address: address!,
      taskQueue,
      dataDir,
      workflowBundlePath: bundlePath!,
      routerOptions: { baseUrls: { "openai-compat": wire.url } },
    });
    const workerDone = worker.run();
    const runner = createTemporalRunner({ address: address!, taskQueue, dataDir });
    cleanups.push(async () => {
      worker.shutdown();
      await workerDone;
      await runner.close();
    });

    const spec = makeJudgedSpec({ repoUrl, maxSteps: 3, cadence: 10 });
    const handle = await runner.start(spec);
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("SUCCESS");
    expect(report.currentStep).toBe(1);
    expect(wire.hits).toBe(1);

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const judgeEntries = journal.entries("judge").map((entry) => entry.payload as JudgePayload);
      expect(judgeEntries).toHaveLength(1);
      expect(judgeEntries[0]!.evidenceRefs).toHaveLength(1);
      expect(judgeEntries[0]!.evidenceRefs[0]!.summary).toContain("workspace diff since");
      expect(judgeEntries[0]!.evidenceRefs[0]!.summary).not.toContain("workspace diff for");

      const checkpoints = journal.entries("checkpoint").map((entry) => entry.payload as Checkpoint);
      expect(checkpoints).toHaveLength(1);
      expect(Object.keys(checkpoints[0]!.gitCommits)).toEqual([repoUrl]);
      expect("perRepoCommits" in checkpoints[0]!).toBe(false);
      await expect(
        git(workspaceDir(dataDir, handle.runId), [
          "cat-file",
          "-t",
          checkpoints[0]!.gitCommits[repoUrl]!,
        ]),
      ).resolves.toBe("commit");

      const run = journal.getRun();
      expect(run).toBeDefined();
      const trace = renderTrace(run!, journal.entries(), runTotals(journal));
      expect(trace).toContain("        injections 0 · checkpoints 1");
      expect(trace).not.toContain("        repos ");
      expect(trace).not.toContain(": diff ");

      const statusOut: string[] = [];
      const statusCode = await main(
        ["status", handle.runId, "--data-dir", dataDir, "--address", address!],
        {
          out: (line) => statusOut.push(line),
          err: () => {},
        },
      );
      expect(statusCode).toBe(0);
      const statusText = statusOut.join("\n");
      expect(statusText).not.toContain("  repos        ");
      expect(statusText).not.toContain(": diff ");
    } finally {
      journal.close();
    }
  });

  test("live chain handoff publishes every writable repo in a two-repo link", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-multi-repo-chain-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));

    const apiRepo = await initRepo(join(tmp, "service-api"), "api.txt", "api base\n");
    const workerRepo = await initRepo(join(tmp, "service-worker"), "worker.txt", "worker base\n");
    const spec = makeJudgedSpec({
      repoUrl: apiRepo,
      name: "multi-repo-chain-handoff-test",
      repos: [
        { url: apiRepo, writable: true },
        { url: workerRepo, writable: true },
      ],
      chainLink: {
        planId: "plan-multi-repo-chain",
        nodeId: "N-1",
        chainId: "chain-multi-repo",
      },
      maxSteps: 2,
      cadence: 10,
    });
    const resolved = collectWorkspaceRepos(spec.repos);
    const dataDir = join(tmp, "data");
    const taskQueue = `tq-${randomUUID()}`;
    const adapters: AdapterRegistry = {
      "multi-repo-scripted": (ctx) => multiRepoAdapter(spec, ctx.store),
    };
    const wire = await startFakeJudgeWire([judgeForm({ criteria: { "AC-1": true } })]);
    cleanups.push(() => wire.close());

    const worker = await createRunnerWorker({
      adapters,
      address: address!,
      taskQueue,
      dataDir,
      workflowBundlePath: bundlePath!,
      routerOptions: { baseUrls: { "openai-compat": wire.url } },
    });
    const workerDone = worker.run();
    const runner = createTemporalRunner({ address: address!, taskQueue, dataDir });
    cleanups.push(async () => {
      worker.shutdown();
      await workerDone;
      await runner.close();
    });

    const handle = await runner.start({
      ...spec,
      executor: { adapter: "multi-repo-scripted", family: "anthropic" },
    });
    const report = await awaitTerminal(handle);
    expect(report.status).toBe("SUCCESS");
    expect(wire.hits).toBe(1);

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const terminal = journal.entries("terminal").at(-1)!.payload as {
        status: string;
        handoff?: ChainNodeHandoff;
      };
      expect(terminal.status).toBe("SUCCESS");
      expect(terminal.handoff?.nodeId).toBe("N-1");
      expect(terminal.handoff?.runId).toBe(handle.runId);
      expect(terminal.handoff?.repos.map((repo) => repo.repoUrl).sort()).toEqual(
        [apiRepo, workerRepo].sort(),
      );
      expect(terminal.handoff?.repos.map((repo) => repo.changedPaths)).toEqual([
        ["step-output.txt"],
        ["step-output.txt"],
      ]);

      const checkpoints = journal.entries("checkpoint").map((entry) => entry.payload as Checkpoint);
      expect(checkpoints).toHaveLength(1);
      for (const handoffRepo of terminal.handoff!.repos) {
        const workspaceRepo = resolved.writable.find((repo) => repo.repo.url === handoffRepo.repoUrl);
        expect(workspaceRepo).toBeDefined();
        expect(handoffRepo.baseCommit).toBe(handoffRepo.sourceCommit);
        expect(handoffRepo.headCommit).toBe(checkpoints[0]!.gitCommits[workspaceRepo!.name]);
      }

      const store = createLocalArtifactStore(sharedArtifactsDir(dataDir));
      const bundleBytes = await Promise.all(
        terminal.handoff!.repos.map((repo) => store.get(repo.bundleRef)),
      );
      expect(bundleBytes.map((bytes) => bytes.length).every((length) => length > 0)).toBe(true);
    } finally {
      journal.close();
    }
  });

  test("live chain writeSet gate is repo-relative for cross-repo writes", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-multi-repo-writeset-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));

    const apiRepo = await initRepo(join(tmp, "service-api"), "api.txt", "api base\n");
    const workerRepo = await initRepo(join(tmp, "service-worker"), "worker.txt", "worker base\n");
    const spec = makeJudgedSpec({
      repoUrl: apiRepo,
      name: "multi-repo-writeset-test",
      repos: [
        { url: apiRepo, writable: true },
        { url: workerRepo, writable: true },
      ],
      chainLink: {
        planId: "plan-multi-repo-writeset",
        nodeId: "N-1",
        chainId: "chain-multi-repo-writeset",
        writeSet: ["api-output.txt", "worker-output.txt"],
      },
      maxSteps: 2,
      cadence: 10,
    });
    const dataDir = join(tmp, "data");
    const taskQueue = `tq-${randomUUID()}`;
    const adapters: AdapterRegistry = {
      "cross-repo-writeset-scripted": (ctx) => crossRepoWriteSetAdapter(spec, ctx.store),
    };
    const wire = await startFakeJudgeWire([judgeForm({ criteria: { "AC-1": true } })]);
    cleanups.push(() => wire.close());

    const worker = await createRunnerWorker({
      adapters,
      address: address!,
      taskQueue,
      dataDir,
      workflowBundlePath: bundlePath!,
      routerOptions: { baseUrls: { "openai-compat": wire.url } },
    });
    const workerDone = worker.run();
    const runner = createTemporalRunner({ address: address!, taskQueue, dataDir });
    cleanups.push(async () => {
      worker.shutdown();
      await workerDone;
      await runner.close();
    });

    const handle = await runner.start({
      ...spec,
      executor: { adapter: "cross-repo-writeset-scripted", family: "anthropic" },
    });
    const report = await awaitTerminal(handle);
    expect(report.status).toBe("SUCCESS");

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const terminal = journal.entries("terminal").at(-1)!.payload as {
        status: string;
        failure?: { reason?: string };
        handoff?: ChainNodeHandoff;
      };
      expect(terminal.status).toBe("SUCCESS");
      expect(terminal.failure?.reason).toBeUndefined();
      expect(terminal.handoff?.repos.map((repo) => repo.changedPaths)).toEqual([
        ["api-output.txt"],
        ["worker-output.txt"],
      ]);
    } finally {
      journal.close();
    }
  });

  test("live named-repo check runs from that repo workspace subdir", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-multi-repo-check-cwd-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));

    const apiRepo = await initRepo(join(tmp, "service-api"), "api.txt", "api base\n");
    const workerRepo = await initRepo(join(tmp, "service-worker"), "worker.txt", "worker base\n");
    const spec = makeJudgedSpec({
      repoUrl: apiRepo,
      name: "multi-repo-check-cwd-test",
      repos: [
        { url: apiRepo, writable: true },
        { url: workerRepo, writable: true },
      ],
      maxSteps: 2,
      cadence: 10,
    });
    spec.acceptanceCriteria = [
      {
        id: "AC-1",
        description: "repo B check runs in repo B",
        repo: "service-worker",
        check:
          "printf 'check-cwd:%s\\n' \"$PWD\" && test -f worker.txt && test ! -f service-worker/worker.txt && test ! -f api.txt",
      },
    ];

    const dataDir = join(tmp, "data");
    const taskQueue = `tq-${randomUUID()}`;
    const adapters: AdapterRegistry = {
      "multi-repo-scripted": (ctx) => multiRepoAdapter(spec, ctx.store),
    };
    const wire = await startFakeJudgeWire([judgeForm({ criteria: { "AC-1": true } })]);
    cleanups.push(() => wire.close());

    const worker = await createRunnerWorker({
      adapters,
      address: address!,
      taskQueue,
      dataDir,
      workflowBundlePath: bundlePath!,
      routerOptions: { baseUrls: { "openai-compat": wire.url } },
    });
    const workerDone = worker.run();
    const runner = createTemporalRunner({ address: address!, taskQueue, dataDir });
    cleanups.push(async () => {
      worker.shutdown();
      await workerDone;
      await runner.close();
    });

    const handle = await runner.start({
      ...spec,
      executor: { adapter: "multi-repo-scripted", family: "anthropic" },
    });
    const report = await awaitTerminal(handle);
    expect(report.status).toBe("SUCCESS");

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const judgeEntries = journal.entries("judge").map((entry) => entry.payload as JudgePayload);
      expect(judgeEntries).toHaveLength(1);
      expect(judgeEntries[0]!.form.criterionResults[0]).toMatchObject({
        id: "AC-1",
        pass: true,
      });
      const testResults = judgeEntries[0]!.evidenceRefs.find((ref) => ref.kind === "test_results");
      expect(testResults).toBeDefined();
      const store = createLocalArtifactStore(artifactsDir(dataDir, handle.runId));
      const output = Buffer.from(await store.get(testResults!)).toString("utf8");
      expect(output).toContain("check-cwd:");
      expect(output).toContain(join(workspaceDir(dataDir, handle.runId), "service-worker"));
      expect(output).not.toContain(join(workspaceDir(dataDir, handle.runId), "service-api"));
    } finally {
      journal.close();
    }
  });

  test("live resume rehydrates both writable repos to the sealed checkpoint without re-executing old steps", async () => {
    expect(collectPerRepoDiffs).toBeTypeOf("function");

    const tmp = await mkdtemp(join(tmpdir(), "chikory-multi-repo-resume-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));

    const apiRepo = await initRepo(join(tmp, "service-api"), "api.txt", "api base\n");
    const workerRepo = await initRepo(join(tmp, "service-worker"), "worker.txt", "worker base\n");
    const spec = makeJudgedSpec({
      repoUrl: apiRepo,
      name: "multi-repo-resume-test",
      repos: [
        { url: apiRepo, writable: true },
        { url: workerRepo, writable: true },
      ],
      maxSteps: 10,
      cadence: 1,
    });
    const resolved = collectWorkspaceRepos(spec.repos);
    const dataDir = join(tmp, "data");
    const taskQueue = `tq-${randomUUID()}`;
    const calls: number[] = [];
    const resumeProbes: ResumeProbe[] = [];
    const adapters: AdapterRegistry = {
      "multi-repo-resume-scripted": (ctx) =>
        resumableMultiRepoAdapter(spec, ctx.store, calls, resumeProbes),
    };
    const wire = await startFakeJudgeWire([
      judgeForm({ criteria: { "AC-1": false } }),
      judgeForm({ criteria: { "AC-1": false } }),
      judgeForm({ criteria: { "AC-1": false } }),
      judgeForm({ criteria: { "AC-1": false } }),
      judgeForm({ criteria: { "AC-1": false } }),
      judgeForm({ criteria: { "AC-1": true } }),
    ]);
    cleanups.push(() => wire.close());

    const worker = await createRunnerWorker({
      adapters,
      address: address!,
      taskQueue,
      dataDir,
      workflowBundlePath: bundlePath!,
      routerOptions: { baseUrls: { "openai-compat": wire.url } },
    });
    const workerDone = worker.run();
    const runner = createTemporalRunner({ address: address!, taskQueue, dataDir });
    cleanups.push(async () => {
      worker.shutdown();
      await workerDone;
      await runner.close();
    });

    const handle = await runner.start({
      ...spec,
      executor: { adapter: "multi-repo-resume-scripted", family: "anthropic" },
    });
    const failed = await awaitTerminal(handle);
    expect(failed.status).toBe("FAILED");
    expect(calls).toEqual([1, 2, 3, 4]);
    expect(wire.hits).toBe(4);

    const ws = workspaceDir(dataDir, handle.runId);
    const failedJournal = new Journal(journalPath(dataDir, handle.runId));
    let sealedCheckpoint: Checkpoint;
    try {
      const checkpoints = failedJournal.entries("checkpoint").map((entry) => entry.payload as Checkpoint);
      expect(checkpoints).toHaveLength(4);
      sealedCheckpoint = checkpoints[checkpoints.length - 1]!;
      expect(sealedCheckpoint.perRepoCommits).toEqual(sealedCheckpoint.gitCommits);
      expect(failedJournal.entries("terminal")).toHaveLength(1);
    } finally {
      failedJournal.close();
    }

    for (const repo of resolved.writable) {
      await writeFile(join(ws, repo.relativePath, "dirty-after-seal.txt"), `dirty ${repo.name}\n`);
    }

    const resumed = await runner.resume(handle.runId);
    const resumedReport = await awaitTerminal(resumed);
    expect(resumedReport.status).toBe("SUCCESS");

    expect(resumeProbes).toEqual([
      {
        apiDirtyExists: false,
        workerDirtyExists: false,
        apiHead: sealedCheckpoint.gitCommits["service-api"],
        workerHead: sealedCheckpoint.gitCommits["service-worker"],
      },
    ]);
    expect(calls).toEqual([1, 2, 3, 4, 5, 6]);
    expect(wire.hits).toBe(6);

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const steps = journal.entries("step").map((entry) => entry.payload as StepPayload);
      expect(steps.map((step) => step.stepIndex)).toEqual([0, 1, 2, 3, 4, 5]);
      expect(new Set(steps.map((step) => step.stepIndex))).toHaveLength(6);
      const checkpoints = journal.entries("checkpoint").map((entry) => entry.payload as Checkpoint);
      expect(checkpoints).toHaveLength(6);
      for (const checkpoint of checkpoints) {
        expect(Object.keys(checkpoint.gitCommits).sort()).toEqual(["service-api", "service-worker"]);
        expect(checkpoint.perRepoCommits).toEqual(checkpoint.gitCommits);
      }

      const judgeEntries = journal.entries("judge").map((entry) => entry.payload as JudgePayload);
      expect(judgeEntries).toHaveLength(6);
      for (const judgeEntry of judgeEntries) {
        expect(judgeEntry.evidenceRefs.map((ref) => ref.summary)).toEqual([
          expect.stringContaining("workspace diff for service-api"),
          expect.stringContaining("workspace diff for service-worker"),
        ]);
      }
      const store = createLocalArtifactStore(artifactsDir(dataDir, handle.runId));
      const [finalApiDiff, finalWorkerDiff] = await Promise.all(
        judgeEntries.at(-1)!.evidenceRefs.map((ref) =>
          store.get(ref).then((bytes) => Buffer.from(bytes).toString("utf8")),
        ),
      );
      expect(finalApiDiff).toContain("### repo service-api (service-api)");
      expect(finalApiDiff).toContain("+attempt 6");
      expect(finalWorkerDiff).toContain("### repo service-worker (service-worker)");
      expect(finalWorkerDiff).toContain("+attempt 6");

      const verdictKinds = journal
        .entries("verdict")
        .map((entry) => (entry.payload as VerdictPayload).verdict.kind);
      expect(verdictKinds).toEqual(["PROCEED", "PROCEED", "HALT", "HALT", "HALT", "PROCEED"]);
      const terminals = journal.entries("terminal");
      expect(terminals).toHaveLength(2);
      expect((terminals[0]!.payload as { status: string }).status).toBe("FAILED");
      expect((terminals[1]!.payload as { status: string }).status).toBe("SUCCESS");
      const reopens = journal.entries("control_event").filter((entry) => {
        const payload = entry.payload as { event?: string; source?: string };
        return payload.event === "resume" && payload.source === "failed_seal";
      });
      expect(reopens).toHaveLength(1);
    } finally {
      journal.close();
    }
  });
});
