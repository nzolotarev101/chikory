/**
 * Executor-adapter conformance suite (WP-111) — every adapter (WP-112/113,
 * later WP-216) must pass identically, per executors.md:
 *   (1) completes a 3-step toy task
 *   (2) respects maxSeconds (hang → killed → FAILED, workspace intact)
 *   (3) never writes outside workspaceDir
 *   (4) StepRecord fields populated (schema-valid)
 *   (5) FAILED on nonzero exit with stderr captured
 * plus the §8 telemetry contract: a chikory.step span per runStep, asserted
 * via an in-memory exporter.
 */
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createLocalArtifactStore } from "../../src/artifacts/index.js";
import { SPAN_STEP } from "../../src/executors/step.js";
import { StepRecordSchema } from "../../src/schemas.js";
import type { ArtifactStore, ExecutorAdapter, StepInput } from "../../src/types.js";

const execFileAsync = promisify(execFile);

export type Scenario = "ok" | "hang" | "hang-trap-term" | "hang-grandchild" | "fail";

export interface ExecutorHarness {
  label: string;
  /** Build the adapter under test, pointed at the given scenario. */
  make(opts: { store: ArtifactStore; scenario: Scenario; killGraceMs?: number }): ExecutorAdapter;
  /** Real agents need generous time; fakes don't. */
  okStepMaxSeconds?: number;
}

export interface Workspace {
  /** Temp parent — workspace plus a sibling canary dir. */
  parentDir: string;
  workspaceDir: string;
  outsideDir: string;
  store: ArtifactStore;
}

export async function makeWorkspace(): Promise<Workspace> {
  const parentDir = await mkdtemp(join(tmpdir(), "chikory-conformance-"));
  const workspaceDir = join(parentDir, "ws");
  const outsideDir = join(parentDir, "outside");
  await mkdir(workspaceDir);
  await mkdir(outsideDir);
  await mkdir(join(parentDir, "artifacts")); // store root, pre-created so (3) sees a stable parent
  await writeFile(join(outsideDir, "canary.txt"), "untouched\n");
  const g = (args: string[]) => execFileAsync("git", ["-C", workspaceDir, ...args]);
  await g(["init", "-q"]);
  await g(["config", "user.email", "conformance@chikory.dev"]);
  await g(["config", "user.name", "chikory-conformance"]);
  await writeFile(join(workspaceDir, "README.md"), "# toy workspace\n");
  await g(["add", "-A"]);
  await g(["commit", "-q", "-m", "step-start checkpoint"]);
  return { parentDir, workspaceDir, outsideDir, store: createLocalArtifactStore(join(parentDir, "artifacts")) };
}

export function makeStepInput(
  ws: Workspace,
  instruction: string,
  maxSeconds: number,
): StepInput {
  return {
    workspaceDir: ws.workspaceDir,
    instruction,
    context: {
      goal: "Toy task: create and edit small text files exactly as instructed.",
      acceptanceCriteria: [
        { id: "AC-1", description: "Files exist with the exact requested contents." },
      ],
      planItem: instruction,
      notes: {},
      recentSteps: [],
      injections: [],
      memoryRefs: [],
    },
    limits: { maxSeconds, maxTurns: 5 },
  };
}

/** The 3-step toy task — phrased so real agents and the fake both execute it. */
export const TOY_STEPS = [
  { instruction: "Create a file named alpha.txt containing exactly: alpha-1", file: "alpha.txt", content: "alpha-1" },
  { instruction: "Create a file named beta.txt containing exactly: beta-1", file: "beta.txt", content: "beta-1" },
  { instruction: "Replace the contents of the file named alpha.txt with exactly: alpha-2", file: "alpha.txt", content: "alpha-2" },
] as const;

export function executorConformanceSuite(h: ExecutorHarness): void {
  const exporter = new InMemorySpanExporter();
  const okSeconds = h.okStepMaxSeconds ?? 30;

  describe(`executor conformance: ${h.label}`, () => {
    beforeAll(() => {
      trace.setGlobalTracerProvider(
        new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }),
      );
      context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    });
    afterAll(() => {
      trace.disable();
      context.disable();
    });
    beforeEach(() => exporter.reset());

    it("(1)(4) completes a 3-step toy task with schema-valid StepRecords", async () => {
      const ws = await makeWorkspace();
      const adapter = h.make({ store: ws.store, scenario: "ok" });
      for (const step of TOY_STEPS) {
        const record = await adapter.runStep(makeStepInput(ws, step.instruction, okSeconds));
        // (4) every field populated and contract-valid.
        StepRecordSchema.parse(record);
        expect(record.status).toBe("SUCCESS");
        expect(record.durationMs).toBeGreaterThan(0);
        const file = await readFile(join(ws.workspaceDir, step.file), "utf8");
        expect(file.trim()).toBe(step.content);
        // Diff artifact is real evidence: retrievable and mentions the file.
        const diff = new TextDecoder().decode(await ws.store.get(record.diffRef));
        expect(diff).toContain(step.file);
        // Transcript stored outside context (CM-3), retrievable by ref.
        expect((await ws.store.get(record.transcriptRef)).byteLength).toBeGreaterThan(0);
        // Commit the step so the next diff is against this step's end state,
        // mirroring the checkpointer (WP-122).
        await execFileAsync("git", ["-C", ws.workspaceDir, "add", "-A"]);
        await execFileAsync("git", ["-C", ws.workspaceDir, "commit", "-q", "-m", "checkpoint"]);
      }
      // §8: one chikory.step span per runStep with the observability.md attrs.
      const spans = exporter.getFinishedSpans().filter((s) => s.name === SPAN_STEP);
      expect(spans).toHaveLength(TOY_STEPS.length);
      for (const span of spans) {
        expect(span.attributes.status).toBe("SUCCESS");
        expect(span.attributes["instruction.hash"]).toBeTruthy();
        expect(span.attributes["duration.ms"]).toBeGreaterThan(0);
        expect(span.attributes["cost.usd"]).toBeGreaterThanOrEqual(0);
      }
    }, 600_000);

    it("(3) never writes outside workspaceDir", async () => {
      const ws = await makeWorkspace();
      const adapter = h.make({ store: ws.store, scenario: "ok" });
      const before = (await readdir(ws.parentDir)).sort();
      const record = await adapter.runStep(
        makeStepInput(ws, TOY_STEPS[0].instruction, okSeconds),
      );
      expect(record.status).toBe("SUCCESS");
      expect((await readdir(ws.parentDir)).sort()).toEqual(before);
      expect(await readFile(join(ws.outsideDir, "canary.txt"), "utf8")).toBe("untouched\n");
    }, 600_000);

    it("(2) hang → killed at maxSeconds → FAILED(retriable), workspace intact", async () => {
      const ws = await makeWorkspace();
      const adapter = h.make({ store: ws.store, scenario: "hang" });
      const record = await adapter.runStep(makeStepInput(ws, "irrelevant", 1));
      StepRecordSchema.parse(record);
      expect(record.status).toBe("FAILED");
      expect(record.failure?.retriable).toBe(true);
      expect(record.failure?.reason).toMatch(/maxSeconds/);
      expect(await readFile(join(ws.workspaceDir, "README.md"), "utf8")).toBe("# toy workspace\n");
      const span = exporter.getFinishedSpans().find((s) => s.name === SPAN_STEP);
      expect(span?.attributes.status).toBe("FAILED");
    }, 30_000);

    it("(2b) SIGTERM-ignoring hang dies via SIGKILL", async () => {
      const ws = await makeWorkspace();
      const adapter = h.make({ store: ws.store, scenario: "hang-trap-term", killGraceMs: 100 });
      const record = await adapter.runStep(makeStepInput(ws, "irrelevant", 1));
      expect(record.status).toBe("FAILED");
      expect(record.failure?.retriable).toBe(true);
    }, 30_000);

    it("(2c) hang spawning a pipe-holding grandchild is reaped near maxSeconds (WP-255)", async () => {
      // The grandchild inherits the runner's stdout pipe and outlives a kill to the
      // DIRECT child, so without a process-group reap `close` never fires and the
      // step runs ~2.45× its cap (F-59). The group kill (process.kill(-pid)) bounds it.
      const ws = await makeWorkspace();
      const adapter = h.make({ store: ws.store, scenario: "hang-grandchild", killGraceMs: 100 });
      const record = await adapter.runStep(makeStepInput(ws, "irrelevant", 1));
      expect(record.status).toBe("FAILED");
      expect(record.failure?.retriable).toBe(true);
      expect(record.failure?.reason).toMatch(/maxSeconds/);
      // 1s cap + grace + slack; pre-fix this hangs until the 60s grandchild interval.
      expect(record.durationMs).toBeLessThan(10_000);
    }, 30_000);

    it("(5) FAILED on nonzero exit with stderr captured", async () => {
      const ws = await makeWorkspace();
      const adapter = h.make({ store: ws.store, scenario: "fail" });
      const record = await adapter.runStep(makeStepInput(ws, "irrelevant", okSeconds));
      StepRecordSchema.parse(record);
      expect(record.status).toBe("FAILED");
      expect(record.failure?.reason).toContain("boom: fake agent crashed");
      // stderr also lands in the transcript artifact for forensics.
      const transcript = new TextDecoder().decode(await ws.store.get(record.transcriptRef));
      expect(transcript).toContain("boom: fake agent crashed");
    }, 30_000);
  });
}
