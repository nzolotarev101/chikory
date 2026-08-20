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
      "!! dist/ignored.js",
    ].join("\n");

    const parsed = parseDirtySnapshot(rawPorcelain);

    expect(parsed.get("src/app.ts")?.status).toBe(" M");
    expect(parsed.get("path with spaces/file.txt")?.status).toBe("??");
    expect(parsed.get("new.ts")?.status).toBe("R ");
    expect(parsed.get("dist/ignored.js")?.status).toBe("!!");
  });

  it("check-created ignored path becomes a delete", () => {
    const before = "";
    const after = "!! dist/leak.js";

    const plan = planCheckSideEffectCleanup(before, after);

    expect(plan.toDelete).toEqual(["dist/leak.js"]);
    expect(plan.toRestore).toEqual([]);
  });

  it("pre-existing ignored path untouched yields NOTHING in plan", () => {
    const before = "!! dist/keep.js\n!! node_modules/pkg/index.js";
    const after = "!! dist/keep.js\n!! node_modules/pkg/index.js";

    const plan = planCheckSideEffectCleanup(before, after);

    expect(plan.toDelete).toEqual([]);
    expect(plan.toRestore).toEqual([]);
  });

  it("check-modified ignored path with preserved content yields a restore", () => {
    const before = [
      { path: "dist/bundle.js", status: "!!", hash: "hash-original", content: "const a = 1;" },
    ];
    const after = [
      { path: "dist/bundle.js", status: "!!", hash: "hash-modified", content: "const a = 2;" },
    ];

    const plan = planCheckSideEffectCleanup(before, after);

    expect(plan.toDelete).toEqual([]);
    expect(plan.toRestore).toEqual(["dist/bundle.js"]);
  });

  it("check-deleted ignored path with preserved content yields a restore", () => {
    const before = [
      { path: "dist/bundle.js", status: "!!", hash: "hash-original", content: "const a = 1;" },
    ];
    const after: { path: string; status: string; hash?: string; content?: string }[] = [];

    const plan = planCheckSideEffectCleanup(before, after);

    expect(plan.toDelete).toEqual([]);
    expect(plan.toRestore).toEqual(["dist/bundle.js"]);
  });

  it("check-modified unpreserved ignored path yields a restore and unrestored entry", () => {
    const before = [{ path: "dist/large.bin", status: "!!", hash: "hash-stat-1" }];
    const after = [{ path: "dist/large.bin", status: "!!", hash: "hash-stat-2" }];

    const plan = planCheckSideEffectCleanup(before, after);

    expect(plan.toDelete).toEqual([]);
    expect(plan.toRestore).toEqual(["dist/large.bin"]);
    expect(plan.unrestored).toEqual(["dist/large.bin"]);
  });

  it("check-deleted unpreserved ignored path yields a restore and unrestored entry", () => {
    const before = [{ path: "dist/large.bin", status: "!!", hash: "hash-stat-1" }];
    const after: { path: string; status: string; hash?: string }[] = [];

    const plan = planCheckSideEffectCleanup(before, after);

    expect(plan.toDelete).toEqual([]);
    expect(plan.toRestore).toEqual(["dist/large.bin"]);
    expect(plan.unrestored).toEqual(["dist/large.bin"]);
  });

  it("check-modified zero-byte empty ignored file yields a restore", () => {
    const before = [
      { path: "dist/empty.log", status: "!!", hash: "hash-empty", content: "" },
    ];
    const after = [
      { path: "dist/empty.log", status: "!!", hash: "hash-written", content: "log output\n" },
    ];

    const plan = planCheckSideEffectCleanup(before, after);

    expect(plan.toDelete).toEqual([]);
    expect(plan.toRestore).toEqual(["dist/empty.log"]);
  });

  it("check-truncated non-empty ignored file yields a restore", () => {
    const before = [
      { path: "dist/app.log", status: "!!", hash: "hash-data", content: "server logs..." },
    ];
    const after = [
      { path: "dist/app.log", status: "!!", hash: "hash-empty", content: "" },
    ];

    const plan = planCheckSideEffectCleanup(before, after);

    expect(plan.toDelete).toEqual([]);
    expect(plan.toRestore).toEqual(["dist/app.log"]);
  });

  it("preserves binary Uint8Array/Buffer content across snapshot and plan", () => {
    const binaryData = new Uint8Array([0xff, 0xfe, 0x00, 0x01, 0x80, 0xc0]);
    const before = [
      { path: "dist/binary.dat", status: "!!", hash: "hash-bin-1", content: binaryData },
    ];
    const after = [
      { path: "dist/binary.dat", status: "!!", hash: "hash-bin-2", content: new Uint8Array([0x00]) },
    ];

    const plan = planCheckSideEffectCleanup(before, after);

    expect(plan.toDelete).toEqual([]);
    expect(plan.toRestore).toEqual(["dist/binary.dat"]);
    expect(plan.unrestored).toEqual([]);
  });
});

describe("the preservation budget line must not read as a change (F-406)", () => {
  it("an untouched ignored file that crossed the budget line yields nothing", () => {
    // The BEFORE snapshot kept this file's bytes; by the AFTER snapshot some other preserved
    // file shrank, the budget re-partitioned, and this one fell outside it. Nothing about the
    // file itself changed, so `statHash` is identical and the planner must stay silent.
    const before = [
      { path: "node_modules/.pnpm/dep/index.js", status: "!!", hash: "sha-of-content", statHash: "stat-abc", content: "module.exports = 1;" },
    ];
    const after = [
      { path: "node_modules/.pnpm/dep/index.js", status: "!!", hash: "stat-abc", statHash: "stat-abc" },
    ];

    const plan = planCheckSideEffectCleanup(before, after);

    expect(plan.toRestore).toEqual([]);
    expect(plan.unrestored).toEqual([]);
  });

  it("a REAL change to a file that also crossed the budget line is still caught", () => {
    const before = [
      { path: "dist/app.js", status: "!!", hash: "sha-of-content", statHash: "stat-abc", content: "original" },
    ];
    const after = [{ path: "dist/app.js", status: "!!", hash: "stat-xyz", statHash: "stat-xyz" }];

    const plan = planCheckSideEffectCleanup(before, after);

    expect(plan.toRestore).toEqual(["dist/app.js"]);
    expect(plan.unrestored).toEqual([]);
  });
});
