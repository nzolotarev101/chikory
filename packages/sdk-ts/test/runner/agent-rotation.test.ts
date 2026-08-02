/**
 * Agent rotation, end to end through the real `executeStep` activity
 * (WP-566/WP-568/WP-572/WP-573).
 *
 * No LLM is mocked: the seam under test is `ExecutorAdapter`, and the scripted
 * adapter returns the SAME `limitSignal` shape a real CLI produces — the stderr
 * here is the wall harvested verbatim from a run journal.
 *
 * What the unit tests cannot reach and this can: that a wall on step 1 leaves a
 * cooldown in the CROSS-RUN ledger, that step 2 then actually runs on a
 * different adapter, that the judge moved in lockstep, and that none of it
 * spends a rule-3 strike.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  createRunnerActivities,
  endpointLedgerPath,
  Journal,
  journalPath,
  type AdapterRegistry,
  type AgentClassRegistry,
  type StepPayload,
  type TaskSpec,
} from "../../src/index.js";
import type { AgentRotationPayload } from "../../src/runner/activities.js";
import { AGY_QUOTA_WALL } from "../agents/fixtures/cli-failures.js";
import { initSourceRepo, makeSpec, scriptedRegistry } from "./helpers.js";

/**
 * Two interchangeable executors and two judges on different vendors. The
 * adapters are both the scripted one under different names — this test is about
 * SELECTION, and using the real CLIs would make it neither hermetic nor fast.
 */
const TEST_REGISTRY: AgentClassRegistry = {
  version: 1,
  classes: {
    "test-exec": {
      id: "test-exec",
      role: "executor",
      primary: {
        id: "exec-gemini",
        role: "executor",
        adapter: "scripted",
        family: "gemini",
        backend: "gemini",
        model: "gemini-3.6-flash-high",
      },
      adjacent: [
        {
          id: "exec-openai",
          role: "executor",
          adapter: "scripted-peer",
          family: "openai",
          backend: "openai",
          model: "gpt-5.6-terra",
        },
      ],
    },
    "test-judge": {
      id: "test-judge",
      role: "judge",
      primary: {
        id: "judge-openai",
        role: "judge",
        transport: "openai-compat",
        backend: "openai",
        model: "gpt-5.6-sol xhigh",
      },
      adjacent: [
        {
          id: "judge-anthropic",
          role: "judge",
          transport: "openai-compat",
          backend: "anthropic",
          model: "claude-opus-5",
        },
      ],
    },
  },
};

const ADAPTERS: AdapterRegistry = {
  ...scriptedRegistry,
  "scripted-peer": scriptedRegistry["scripted"]!,
};

const STEP_CONTEXT = {
  notes: {},
  recentSteps: [],
  injections: [],
  memoryRefs: [],
};

describe("agent rotation through executeStep", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  async function prepared(
    runId: string,
    opts: {
      scripted?: Parameters<typeof initSourceRepo>[1];
      classes?: boolean;
      registry?: AgentClassRegistry;
    } = {},
  ) {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-agent-rotation-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const repoUrl = await initSourceRepo(join(tmp, "src"), opts.scripted ?? {});
    const dataDir = join(tmp, "data");

    const overrides: Partial<TaskSpec> =
      opts.classes === false
        ? {}
        : {
            agentClasses: { executor: "test-exec", judge: "test-judge" },
            executor: { adapter: "scripted", family: "gemini" },
            judge: { family: "openai-compat", model: "gpt-5.6-sol xhigh", cadence: 99 },
            routing: {
              stages: {
                plan: { provider: "openai-compat", model: "gpt-5.6-sol xhigh" },
                code: { provider: "gemini", model: "gemini-3.6-flash-high" },
                review: { provider: "openai-compat", model: "gpt-5.6-sol xhigh" },
                judge: { provider: "openai-compat", model: "gpt-5.6-sol xhigh" },
              },
            },
          };

    const spec = makeSpec({ repoUrl, ...overrides });
    const activities = createRunnerActivities({
      dataDir,
      adapters: ADAPTERS,
      ...(opts.classes === false ? {} : { registry: opts.registry ?? TEST_REGISTRY }),
    });
    await activities.prepareRun({ runId, spec });
    return { activities, dataDir, spec };
  }

  const step = (runId: string, spec: TaskSpec, stepIndex: number) => ({
    runId,
    stepIndex,
    instruction: spec.goal,
    context: {
      goal: spec.goal,
      acceptanceCriteria: spec.acceptanceCriteria,
      planItem: spec.goal,
      ...STEP_CONTEXT,
    },
    limits: { maxSeconds: 600 },
  });

  function rotations(dataDir: string, runId: string): AgentRotationPayload[] {
    const journal = new Journal(journalPath(dataDir, runId));
    try {
      return journal.entries("agent_rotation").map((e) => e.payload as AgentRotationPayload);
    } finally {
      journal.close();
    }
  }

  function cooldowns(dataDir: string) {
    const db = new DatabaseSync(endpointLedgerPath(dataDir), { readOnly: true });
    try {
      return db
        .prepare(`SELECT member_id, reason, cooldown_until_ms FROM member_cooldown`)
        .all() as Array<{ member_id: string; reason: string; cooldown_until_ms: number }>;
    } finally {
      db.close();
    }
  }

  function consumptionTargets(dataDir: string) {
    const db = new DatabaseSync(endpointLedgerPath(dataDir), { readOnly: true });
    try {
      return (
        db
          .prepare(`SELECT step_index, endpoint_target FROM consumption ORDER BY step_index`)
          .all() as Array<{ step_index: number; endpoint_target: string }>
      ).map((r) => `${r.step_index}:${r.endpoint_target}`);
    } finally {
      db.close();
    }
  }

  it("a walled member is cooled, and the NEXT step runs on the peer", async () => {
    const runId = "run-rotate-1";
    const { activities, dataDir, spec } = await prepared(runId, {
      // The verbatim `agy` wall harvested from a run journal.
      scripted: { cliLimitSteps: [1], cliLimitStderr: AGY_QUOTA_WALL.stderr },
    });

    const walled = await activities.executeStep(step(runId, spec, 0));

    // 1. The wall does NOT park — the whole point. A park here would sleep 4h.
    expect(walled.status).toBe("FAILED");
    expect(walled.limitParkResponse).toBeUndefined();
    // 2. …and it spends no rule-3 strike: a wall says nothing about the code.
    expect(walled.infraFailed).toBe(true);
    expect(walled.failure?.retriable).toBe(true);
    expect(walled.failure?.reason).toMatch(/rotating to 'exec-openai'/);

    // 3. The cooldown is in the CROSS-RUN ledger, keyed by member id.
    expect(cooldowns(dataDir)).toEqual([
      expect.objectContaining({ member_id: "exec-gemini", reason: "limit" }),
    ]);

    // 4. The rotation is journaled, naming both sides.
    const wallRotation = rotations(dataDir, runId).find((r) => r.trigger === "wall");
    expect(wallRotation).toMatchObject({
      atStep: 0,
      cooledMemberId: "exec-gemini",
      cooledReason: "limit",
      toExecutor: "exec-openai",
    });

    // 5. The next step actually RUNS on the peer — selection, not just intent.
    const next = await activities.executeStep(step(runId, spec, 1));
    expect(next.status).toBe("SUCCESS");
    const selection = rotations(dataDir, runId).find(
      (r) => r.trigger === "selection" && r.atStep === 1,
    );
    expect(selection).toMatchObject({
      toExecutor: "exec-openai",
      executorAdapter: "scripted-peer",
      executorModel: "gpt-5.6-terra",
    });

    // 6. Consumption is attributed to the agent that actually did the work,
    //    so the cross-run quota ledger stays honest after a swap.
    expect(consumptionTargets(dataDir)).toEqual(["0:scripted", "1:scripted-peer"]);
  });

  it("rotates the JUDGE in lockstep when the executor enters its vendor", async () => {
    const runId = "run-rotate-judge";
    const { activities, dataDir, spec } = await prepared(runId, {
      scripted: { cliLimitSteps: [1], cliLimitStderr: AGY_QUOTA_WALL.stderr },
    });

    await activities.executeStep(step(runId, spec, 0));
    await activities.executeStep(step(runId, spec, 1));

    // The peer executor is OpenAI, and so is the primary judge — leaving the
    // judge put would break invariant #2 silently, because both ride the same
    // `openai-compat` transport and every declared-family check would pass.
    const selection = rotations(dataDir, runId).find(
      (r) => r.trigger === "selection" && r.atStep === 1,
    );
    expect(selection?.toJudge).toBe("judge-anthropic");
    expect(selection?.judgeModel).toBe("claude-opus-5");
  });

  it("keeps working after the rotation instead of re-hitting the wall", async () => {
    const runId = "run-rotate-continues";
    const { activities, dataDir, spec } = await prepared(runId, {
      scripted: { cliLimitSteps: [1], cliLimitStderr: AGY_QUOTA_WALL.stderr },
    });

    await activities.executeStep(step(runId, spec, 0));
    for (const index of [1, 2]) {
      const record = await activities.executeStep(step(runId, spec, index));
      expect(record.status, `step ${index}`).toBe("SUCCESS");
    }

    const journal = new Journal(journalPath(dataDir, runId));
    try {
      const steps = journal.entries("step").map((e) => (e.payload as StepPayload).record.status);
      expect(steps).toEqual(["FAILED", "SUCCESS", "SUCCESS"]);
    } finally {
      journal.close();
    }
    // Exactly one member was benched; the peer was never cooled.
    expect(cooldowns(dataDir).map((c) => c.member_id)).toEqual(["exec-gemini"]);
  });

  it("a LATER RUN in the same dataDir inherits the wall (the chain-node property)", async () => {
    // A chain node is a separate run sharing one `.chikory`, so this is exactly
    // what stops node N+1 walking back into the wall node N just found. Unit
    // tests cannot reach it: the carrier is the cross-run ledger on disk.
    const runId = "run-node-1";
    const { activities, dataDir, spec } = await prepared(runId, {
      scripted: { cliLimitSteps: [1], cliLimitStderr: AGY_QUOTA_WALL.stderr },
    });
    await activities.executeStep(step(runId, spec, 0));
    expect(cooldowns(dataDir).map((c) => c.member_id)).toEqual(["exec-gemini"]);

    // A brand-new run, same dataDir, same classes — as the next node would be.
    const nextRunId = "run-node-2";
    await activities.prepareRun({ runId: nextRunId, spec });
    const first = await activities.executeStep(step(nextRunId, spec, 0));

    expect(first.status).toBe("SUCCESS");
    const selection = rotations(dataDir, nextRunId).find((r) => r.trigger === "selection");
    // Its very FIRST step already runs on the peer — it never pays for the wall.
    expect(selection).toMatchObject({
      atStep: 0,
      toExecutor: "exec-openai",
      executorAdapter: "scripted-peer",
    });
    expect(consumptionTargets(dataDir)).toContain("0:scripted-peer");
  });

  it("an ordinary FAILED step cools nobody", async () => {
    // Rotating on a plain failure would spend a second subscription
    // reproducing the same broken build.
    const runId = "run-no-rotate";
    const { activities, dataDir, spec } = await prepared(runId, { scripted: { failSteps: [1] } });

    const record = await activities.executeStep(step(runId, spec, 0));
    expect(record.status).toBe("FAILED");
    expect(record.infraFailed).toBeUndefined();
    expect(cooldowns(dataDir)).toEqual([]);
    expect(rotations(dataDir, runId)).toEqual([]);
  });

  it("leaves the pre-WP-566 limit path completely untouched for a spec with NO classes", async () => {
    const runId = "run-legacy-limit";
    const { activities, dataDir, spec } = await prepared(runId, {
      classes: false,
      scripted: { cliLimitSteps: [1], cliLimitStderr: AGY_QUOTA_WALL.stderr },
    });

    const record = await activities.executeStep(step(runId, spec, 0));

    // The existing scheduler still owns this wall: it finds a declared-failover
    // target in the routing policy and retries there (hence SUCCESS on the
    // second attempt). What matters for WP-566 is that NOTHING new fires —
    // a class of one has no peer to yield to, so cooling a member would only
    // bench the single agent the run has.
    expect(record.status).toBe("SUCCESS");
    expect(cooldowns(dataDir)).toEqual([]);
    expect(rotations(dataDir, runId)).toEqual([]);

    const journal = new Journal(journalPath(dataDir, runId));
    try {
      // …and the legacy machinery demonstrably DID run.
      expect(journal.entries("limit_signal")).toHaveLength(1);
    } finally {
      journal.close();
    }
  });
});
