import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  createRunnerActivities,
  describeEndpointCapability,
  Journal,
  journalPath,
  resolveEndpointCapabilities,
  type JournalEntry,
} from "../../src/index.js";
import type { CapabilityPayload } from "../../src/runner/activities.js";
import { initSourceRepo, makeSpec } from "./helpers.js";

describe("run-start endpoint capability journal", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  test("prepareRun journals resolved per-stage capabilities exactly once", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-capability-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const repoUrl = await initSourceRepo(join(tmp, "src"));
    const dataDir = join(tmp, "data");
    const spec = makeSpec({
      repoUrl,
      executor: { adapter: "codex", family: "openai" },
      routing: {
        stages: {
          plan: { provider: "anthropic", model: "claude-fable-5" },
          code: { provider: "openai", model: "gpt-fable-5" },
          review: { provider: "openai-compat", model: "review-model" },
          judge: { provider: "gemini", model: "gemini-2.5-pro" },
        },
      },
    });
    const activities = createRunnerActivities({ dataDir, adapters: {} });

    await expect(activities.prepareRun({ runId: "run-capability", spec })).resolves.toMatchObject({
      status: "SUCCESS",
    });
    await expect(activities.prepareRun({ runId: "run-capability", spec })).resolves.toMatchObject({
      status: "SUCCESS",
    });

    const journal = new Journal(journalPath(dataDir, "run-capability"));
    try {
      const entries = journal.entries("capability") as Array<JournalEntry & { payload: CapabilityPayload }>;
      expect(entries).toHaveLength(1);
      expect(entries[0]!.payload.capabilityIndex).toBe(0);
      expect(entries[0]!.payload.stages).toEqual(resolveEndpointCapabilities(spec));
      expect(entries[0]!.payload.stages.code).toEqual([describeEndpointCapability("codex")]);
    } finally {
      journal.close();
    }
  });
});
