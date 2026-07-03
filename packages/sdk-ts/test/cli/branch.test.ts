import { describe, expect, it } from "vitest";

import { cmdBranch } from "../../src/cli/commands.js";
import { main } from "../../src/cli/main.js";
import type { BranchTarget } from "../../src/cli/branch-target.js";

describe("cmdBranch", () => {
  it("parses run-id@step targets with parseBranchTarget and returns the child run", async () => {
    const out: string[] = [];
    const err: string[] = [];
    let seen: BranchTarget | undefined;
    const code = await cmdBranch(
      { target: "run-parent@7", json: true, dataDir: "/tmp/chikory-test" },
      {
        out: (line) => out.push(line),
        err: (line) => err.push(line),
        branchRun: async (target) => {
          seen = target;
          return { runId: "branch-run-parent-step-7-child" };
        },
      },
    );

    expect(code).toBe(0);
    expect(err).toEqual([]);
    expect(seen).toEqual({ runId: "run-parent", step: 7, checkpointId: "run-parent@7" });
    expect(JSON.parse(out[0]!)).toEqual({
      parentRunId: "run-parent",
      forkCheckpoint: "run-parent@7",
      childRunId: "branch-run-parent-step-7-child",
    });
  });

  it("fails malformed branch targets before calling the branch dependency", async () => {
    const err: string[] = [];
    let called = false;
    const code = await cmdBranch(
      { target: "run-parent", json: false, dataDir: "/tmp/chikory-test" },
      {
        err: (line) => err.push(line),
        branchRun: async () => {
          called = true;
          return { runId: "unused" };
        },
      },
    );

    expect(code).toBe(1);
    expect(called).toBe(false);
    expect(err.join("\n")).toContain("Expected <run-id>@<step|base>");
  });

  it("surfaces unknown checkpoints as actionable nonzero failures", async () => {
    const err: string[] = [];
    const code = await cmdBranch(
      { target: "run-parent@99", json: false, dataDir: "/tmp/chikory-test" },
      {
        err: (line) => err.push(line),
        branchRun: async () => {
          throw new Error(
            "checkpoint 'run-parent@99' was not found in run 'run-parent' (inspect checkpoints: chikory status run-parent)",
          );
        },
      },
    );

    expect(code).toBe(1);
    expect(err.join("\n")).toContain("chikory: branch failed");
    expect(err.join("\n")).toContain("chikory status run-parent");
  });

  it("wires the branch verb through CLI dispatch", async () => {
    const out: string[] = [];
    const code = await main(["branch", "run-parent@base", "--json"], {
      out: (line) => out.push(line),
      branchRun: async () => ({ runId: "branch-run-parent-base-child" }),
    });

    expect(code).toBe(0);
    expect(JSON.parse(out[0]!)).toMatchObject({
      parentRunId: "run-parent",
      forkCheckpoint: "run-parent@base",
      childRunId: "branch-run-parent-base-child",
    });
  });
});
