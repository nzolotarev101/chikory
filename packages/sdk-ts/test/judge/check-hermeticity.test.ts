import { describe, expect, it } from "vitest";

import {
  parseDirtySnapshot,
  planCheckSideEffectCleanup,
} from "../../src/judge/hermeticity.js";

describe("planCheckSideEffectCleanup pure decision planner", () => {
  it("identical snapshots yield an empty plan", () => {
    const before = " M src/index.ts\n?? src/untracked.ts";
    const after = " M src/index.ts\n?? src/untracked.ts";

    const plan = planCheckSideEffectCleanup(before, after);

    expect(plan.toDelete).toEqual([]);
    expect(plan.toRestore).toEqual([]);
  });

  it("empty snapshots yield an empty plan", () => {
    const plan = planCheckSideEffectCleanup("", "");

    expect(plan.toDelete).toEqual([]);
    expect(plan.toRestore).toEqual([]);
  });

  it("check-created path becomes a delete", () => {
    const before = "";
    const after = "?? test/probe.ts";

    const plan = planCheckSideEffectCleanup(before, after);

    expect(plan.toDelete).toEqual(["test/probe.ts"]);
    expect(plan.toRestore).toEqual([]);
  });

  it("check-modified path becomes a restore", () => {
    const before = "";
    const after = " M src/existing.ts";

    const plan = planCheckSideEffectCleanup(before, after);

    expect(plan.toDelete).toEqual([]);
    expect(plan.toRestore).toEqual(["src/existing.ts"]);
  });

  it("executor-dirtied-but-check-untouched path yields NOTHING in plan", () => {
    const before = " M src/executor.ts\n?? src/executor-new.ts";
    const after = " M src/executor.ts\n?? src/executor-new.ts";

    const plan = planCheckSideEffectCleanup(before, after);

    expect(plan.toDelete).toEqual([]);
    expect(plan.toRestore).toEqual([]);
  });

  it("combines check-created, check-modified, and executor-dirtied paths correctly", () => {
    const before = " M src/executor-modified.ts\n?? src/executor-new.ts";
    const after =
      " M src/executor-modified.ts\n?? src/executor-new.ts\n?? test/probe-created.ts\n M src/baseline-modified.ts";

    const plan = planCheckSideEffectCleanup(before, after);

    expect(plan.toDelete).toEqual(["test/probe-created.ts"]);
    expect(plan.toRestore).toEqual(["src/baseline-modified.ts"]);
  });

  it("supports multiple snapshot types (string, Record, Map, GitDirtyEntry array)", () => {
    const beforeMap = new Map([["src/app.ts", " M"]]);
    const afterRecord: Record<string, string> = {
      "src/app.ts": " M",
      "test/created.ts": "??",
      "src/modified.ts": " M",
    };

    const plan = planCheckSideEffectCleanup(beforeMap, afterRecord);

    expect(plan.toDelete).toEqual(["test/created.ts"]);
    expect(plan.toRestore).toEqual(["src/modified.ts"]);
  });

  it("parseDirtySnapshot correctly parses git porcelain v1 format including quotes and renames", () => {
    const rawPorcelain = [
      " M src/app.ts",
      '?? "path with spaces/file.txt"',
      "R  old.ts -> new.ts",
    ].join("\n");

    const parsed = parseDirtySnapshot(rawPorcelain);

    expect(parsed.get("src/app.ts")?.status).toBe(" M");
    expect(parsed.get("path with spaces/file.txt")?.status).toBe("??");
    expect(parsed.get("new.ts")?.status).toBe("R ");
  });
});
