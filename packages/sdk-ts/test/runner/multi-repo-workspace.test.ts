import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, inject, test } from "vitest";

import {
  artifactsDir,
  collectWorkspaceRepos,
  createLocalArtifactStore,
  createRunnerWorker,
  createTemporalRunner,
  Journal,
  journalPath,
  workspaceDir,
  type AdapterRegistry,
  type ArtifactStore,
  type Checkpoint,
  type ExecutorAdapter,
  type JudgePayload,
  type RunStatusReport,
  type StepRecord,
  type TaskSpec,
} from "../../src/index.js";
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
      expect(apiDiff).toContain("+exercise the journaled agent loop");
      expect(workerDiff).toContain("+exercise the journaled agent loop");

      const checkpoints = journal.entries("checkpoint").map((entry) => entry.payload as Checkpoint);
      expect(checkpoints).toHaveLength(1);
      expect(Object.keys(checkpoints[0]!.gitCommits).sort()).toEqual(
        resolved.writable.map((repo) => repo.name).sort(),
      );
      for (const workspaceRepo of resolved.writable) {
        await expect(
          git(join(ws, workspaceRepo.relativePath), [
            "cat-file",
            "-t",
            checkpoints[0]!.gitCommits[workspaceRepo.name]!,
          ]),
        ).resolves.toBe("commit");
      }
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
      await expect(
        git(workspaceDir(dataDir, handle.runId), [
          "cat-file",
          "-t",
          checkpoints[0]!.gitCommits[repoUrl]!,
        ]),
      ).resolves.toBe("commit");
    } finally {
      journal.close();
    }
  });
});
