import { mkdtempSync, writeFileSync } from "node:fs";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi, afterEach } from "vitest";
import { resolveTargetNodeEngine, planNodeProvisioning, decideTargetNode, loadTargetEngineSource, pinnedNodeProvisioning, satisfiesRange, getTargetPackageJson } from "../src/engine.js";
import type { BenchmarkTask } from "../src/task.js";

// Vitest allows variables starting with "mock" to be referenced inside vi.mock factory
const mockExecFileSync = vi.fn();

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    execFileSync: (...args: unknown[]) => {
      if (mockExecFileSync.getMockImplementation()) {
        return mockExecFileSync(...args);
      }
      const fn = original.execFileSync as (...args: unknown[]) => unknown;
      return fn(...args);
    },
  };
});

describe("resolveTargetNodeEngine", () => {
  it("handles >=24", () => {
    const pkg = { engines: { node: ">=24" } };
    expect(resolveTargetNodeEngine(pkg)).toBe(24);
  });

  it("handles >=24.0.0", () => {
    const pkg = { engines: { node: ">=24.0.0" } };
    expect(resolveTargetNodeEngine(pkg)).toBe(24);
  });

  it("handles ^24.1.0", () => {
    const pkg = { engines: { node: "^24.1.0" } };
    expect(resolveTargetNodeEngine(pkg)).toBe(24);
  });

  it("handles 24.x", () => {
    const pkg = { engines: { node: "24.x" } };
    expect(resolveTargetNodeEngine(pkg)).toBe(24);
  });

  it("handles 22 || 24", () => {
    const pkg = { engines: { node: "22 || 24" } };
    expect(resolveTargetNodeEngine(pkg)).toBe(22);
  });

  it("handles no constraint", () => {
    expect(resolveTargetNodeEngine({})).toBe("no constraint");
    expect(resolveTargetNodeEngine({ engines: {} })).toBe("no constraint");
    expect(resolveTargetNodeEngine({ engines: { node: "" } })).toBe("no constraint");
  });

  it("handles unparseable case without throwing", () => {
    const pkg = { engines: { node: "some-garbage-version-format" } };
    expect(resolveTargetNodeEngine(pkg)).toBe("no constraint");
  });

  it("returns 24 when handed the real engines constraint that blocks brownfield-002 today", () => {
    // Gitify package.json has "engines": { "node": ">=24" }
    const pkg = {
      name: "gitify",
      engines: {
        node: ">=24"
      }
    };
    expect(resolveTargetNodeEngine(pkg)).toBe(24);
  });
});

describe("planNodeProvisioning", () => {
  const toolchains = [
    { version: "20.19.1", binDir: "/nix/store/20/bin" },
    { version: "24.15.0", binDir: "/nix/store/24/bin" },
  ];

  it("yields ambient no-op when requirement is already satisfied", () => {
    // requirement major matches ambient major
    const decision = planNodeProvisioning(22, toolchains, "v22.11.0");
    expect(decision).toEqual({ type: "ambient" });
  });

  it("yields ambient no-op when there is no constraint", () => {
    const decision = planNodeProvisioning("no constraint", toolchains, "v22.11.0");
    expect(decision).toEqual({ type: "ambient" });
  });

  it("yields right toolchain directory when requirement is satisfiable", () => {
    const decision = planNodeProvisioning(24, toolchains, "v22.11.0");
    expect(decision).toEqual({
      type: "provision",
      binDir: "/nix/store/24/bin",
    });
  });

  it("yields UNAVAILABLE when requirement is unsatisfiable", () => {
    const decision = planNodeProvisioning(26, toolchains, "v22.11.0");
    expect(decision).toEqual({
      type: "unavailable",
      neededVersion: 26,
      available: ["20.19.1", "24.15.0"],
    });
  });
});

describe("decideTargetNode & loadTargetEngineSource", () => {
  it("ambient strictly newer yields ambient no-op", () => {
    const available = [{ version: "18.0.0", binDir: "/path/18" }];
    const decision18 = decideTargetNode({ engines: { node: ">=18" } }, available, "v22.22.3");
    expect(decision18).toEqual({ type: "ambient" });
    const decision20 = decideTargetNode({ engines: { node: ">=20" } }, available, "v22.22.3");
    expect(decision20).toEqual({ type: "ambient" });
  });

  it("requirement satisfied by newer toolchain", () => {
    const available = [
      { version: "26.0.0", binDir: "/path/26" }
    ];
    const decision = decideTargetNode({ engines: { node: ">=24" } }, available, "v22.0.0");
    expect(decision).toEqual({ type: "provision", binDir: "/path/26" });
  });

  it("deterministic selection selects the newest satisfying one", () => {
    const available = [
      { version: "24.0.0", binDir: "/path/24" },
      { version: "26.0.0", binDir: "/path/26" },
      { version: "25.0.0", binDir: "/path/25" }
    ];
    const decision = decideTargetNode({ engines: { node: ">=24" } }, available, "v22.0.0");
    expect(decision).toEqual({ type: "provision", binDir: "/path/26" });
  });

  it("unavailable outcome names the constraint and available versions", () => {
    const available = [
      { version: "18.0.0", binDir: "/path/18" },
      { version: "20.0.0", binDir: "/path/20" }
    ];
    const decision = decideTargetNode({ engines: { node: ">=24" } }, available, "v22.0.0");
    expect(decision).toEqual({
      type: "unavailable",
      neededVersion: ">=24",
      available: ["18.0.0", "20.0.0"]
    });
  });

  it("loadTargetEngineSource fails loud with structured reason", () => {
    const task = {
      id: "test-task",
      class: "brownfield",
      repo: { url: "https://invalid.example/repo", ref: "main" }
    } as unknown as BenchmarkTask;
    const result = loadTargetEngineSource(task, "/invalid-workspace-path-does-not-exist");
    expect(result.type).toBe("error");
    expect(result.type === "error" ? result.error : "").toBeDefined();
  });

  it("no-constraint and unparseable cases resolve to ambient without throwing", () => {
    const available = [{ version: "24.0.0", binDir: "/path/24" }];
    expect(decideTargetNode({}, available, "v22.0.0")).toEqual({ type: "ambient" });
    expect(decideTargetNode({ engines: { node: "some garbage" } }, available, "v22.0.0")).toEqual({ type: "ambient" });
    expect(decideTargetNode({ engines: { node: "" } }, available, "v22.0.0")).toEqual({ type: "ambient" });
  });
});

/**
 * F-187 (dogfood-114 review): comparators joined by WHITESPACE are an AND-range,
 * and `>`/`<`/`<=`/`~` are as common in the wild as `>=`. Treating them as
 * unparseable resolved a satisfiable range to the ambient toolchain — a silent
 * wrong-node run, and a regression against the legacy major-only resolver.
 */
describe("satisfiesRange — comparator coverage (F-187)", () => {
  it("evaluates whitespace-joined comparators as a conjunction", () => {
    expect(satisfiesRange("22.22.3", ">=18 <21")).toBe(false);
    expect(satisfiesRange("20.19.6", ">=18 <21")).toBe(true);
    expect(satisfiesRange("22.22.3", ">=24 <26")).toBe(false);
    expect(satisfiesRange("24.15.0", ">=24 <26")).toBe(true);
    expect(satisfiesRange("26.0.0", ">=24 <26")).toBe(false);
    expect(satisfiesRange("22.22.3", ">=20.0.0 <23")).toBe(true);
  });

  it("evaluates the strict and upper-bound comparators", () => {
    expect(satisfiesRange("22.22.3", ">18")).toBe(true);
    expect(satisfiesRange("18.0.0", ">18")).toBe(false);
    expect(satisfiesRange("22.22.3", "<=24")).toBe(true);
    expect(satisfiesRange("24.15.0", "<=24")).toBe(false);
    expect(satisfiesRange("24.0.0", "<=24")).toBe(true);
  });

  it("evaluates tilde ranges against the minor it pins", () => {
    expect(satisfiesRange("24.1.5", "~24.1")).toBe(true);
    expect(satisfiesRange("24.2.0", "~24.1")).toBe(false);
    expect(satisfiesRange("24.1.0", "~24.1.3")).toBe(false);
  });

  it("tolerates a space between operator and operand", () => {
    expect(satisfiesRange("24.15.0", ">= 24")).toBe(true);
    expect(satisfiesRange("22.22.3", ">= 24")).toBe(false);
  });

  it("keeps the OR, caret, x-range and bare forms working", () => {
    expect(satisfiesRange("22.22.3", "22 || 24")).toBe(true);
    expect(satisfiesRange("24.15.0", "22 || 24")).toBe(true);
    expect(satisfiesRange("20.19.6", "22 || 24")).toBe(false);
    expect(satisfiesRange("24.15.0", "^24.1.0")).toBe(true);
    expect(satisfiesRange("25.0.0", "^24.1.0")).toBe(false);
    expect(satisfiesRange("24.15.0", "24.x")).toBe(true);
    expect(satisfiesRange("24.15.0", ">=18.19.1 <19 || >=20.11.1")).toBe(true);
    expect(satisfiesRange("19.5.0", ">=18.19.1 <19 || >=20.11.1")).toBe(false);
  });

  it("treats a fully-specified bare version as an exact pin, not a major range", () => {
    expect(satisfiesRange("24.15.0", "24.15.0")).toBe(true);
    expect(satisfiesRange("24.14.1", "24.15.0")).toBe(false);
    expect(satisfiesRange("24.14.1", "24")).toBe(true);
  });

  it("reports an unmodelled comparator as unsatisfied, not as satisfied", () => {
    expect(satisfiesRange("22.22.3", "lts/*")).toBe(false);
    expect(satisfiesRange("22.22.3", ">=20 lts/*")).toBe(false);
  });
});

describe("decideTargetNode — AND-range provisioning (F-187)", () => {
  const available = [
    { version: "20.19.6", binDir: "/n20" },
    { version: "24.14.1", binDir: "/n24a" },
    { version: "24.15.0", binDir: "/n24b" },
  ];

  it("provisions the newest toolchain inside a bounded range", () => {
    expect(decideTargetNode({ engines: { node: ">=24 <26" } }, available, "v22.22.3")).toEqual({
      type: "provision",
      binDir: "/n24b",
    });
  });

  it("does not fall back to an ambient node the upper bound excludes", () => {
    expect(decideTargetNode({ engines: { node: ">=18 <21" } }, available, "v22.22.3")).toEqual({
      type: "provision",
      binDir: "/n20",
    });
  });

  it("reports a bounded range nothing satisfies as unavailable, never ambient", () => {
    expect(decideTargetNode({ engines: { node: ">=30 <32" } }, available, "v22.22.3")).toEqual({
      type: "unavailable",
      neededVersion: ">=30 <32",
      available: ["20.19.6", "24.14.1", "24.15.0"],
    });
  });
});

/**
 * F-188 (dogfood-114 review): a target with NO package.json declares no engine
 * constraint. Reading it as an unreadable-repo error skipped every non-Node
 * target — shrinking the corpus the WP exists to grow.
 */
describe("loadTargetEngineSource — absent vs unreadable (F-188)", () => {
  it("treats a greenfield task with no repo and no workspace package.json as no constraint", () => {
    const task = { id: "greenfield-x", class: "greenfield" } as unknown as BenchmarkTask;
    const result = loadTargetEngineSource(task, mkdtempSync(join(tmpdir(), "engine-noconstraint-")));
    expect(result).toEqual({ type: "success", content: "{}" });
  });

  it("reads a workspace package.json when one is present", () => {
    const dir = mkdtempSync(join(tmpdir(), "engine-localpkg-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ engines: { node: ">=24 <26" } }));
    const result = loadTargetEngineSource({ id: "local-x" } as unknown as BenchmarkTask, dir);
    expect(result.type).toBe("success");
    expect(result.type === "success" ? JSON.parse(result.content).engines.node : "").toBe(">=24 <26");
  });

  it("reports a repo it cannot reach as a structured error", () => {
    const task = {
      id: "unreachable-x",
      class: "brownfield",
      repo: { url: "https://invalid.example/repo", ref: "main" },
    } as unknown as BenchmarkTask;
    const result = loadTargetEngineSource(task, mkdtempSync(join(tmpdir(), "engine-unreachable-")));
    expect(result.type).toBe("error");
  });
});


/**
 * F-254 (WP-586) — an exact `node_version` pin overrides the repo's `engines`.
 *
 * `brownfield-002` at ref `a061eaa1` declares `engines.node: ">=24"`, so the
 * harness took the newest installed toolchain. Measured on a clean clone:
 * node 24.14.1 runs 1128/1128 green; node 24.15.0 SIGABRTs vitest 4.1.9 before
 * a single test executes. p3-rung-4 drew 24.15.0 and lost the task.
 */
describe("secure execFileSync invocation", () => {
  afterEach(() => {
    mockExecFileSync.mockReset();
  });

  it("ensures git is executed with execFileSync as an array to prevent shell injection", () => {
    mockExecFileSync.mockImplementation(() => {
      return "package.json";
    });

    const task = {
      id: "sec-task",
      class: "brownfield",
      repo: { url: "https://github.com/org/repo; rm -rf /", ref: "main; injection" },
    } as unknown as BenchmarkTask;

    loadTargetEngineSource(task, "/nonexistent-workspace");

    // Expect git commands to be called via execFileSync without shell involvement
    expect(mockExecFileSync).toHaveBeenCalled();
    const calls = mockExecFileSync.mock.calls;

    // Verify git clone args
    expect(calls[0]?.[0]).toBe("git");
    const cloneArgs = calls[0]?.[1];
    expect(cloneArgs).toContain("clone");
    expect(cloneArgs).toContain("https://github.com/org/repo; rm -rf /");

    // Verify git fetch args
    expect(calls[1]?.[0]).toBe("git");
    const fetchArgs = calls[1]?.[1];
    expect(fetchArgs).toContain("fetch");
    expect(fetchArgs).toContain("main; injection");

    // Verify git ls-tree args
    expect(calls[2]?.[0]).toBe("git");
    const lsTreeArgs = calls[2]?.[1];
    expect(lsTreeArgs).toContain("ls-tree");

    // Verify git checkout args
    expect(calls[3]?.[0]).toBe("git");
    const checkoutArgs = calls[3]?.[1];
    expect(checkoutArgs).toContain("checkout");
  });

  it("ensures getTargetPackageJson also executes git with execFileSync securely", () => {
    mockExecFileSync.mockImplementation(() => {
      return "package.json";
    });

    const task = {
      id: "sec-task-2",
      class: "brownfield",
      repo: { url: "https://github.com/org/repo; rm -rf /", ref: "main; injection" },
    } as unknown as BenchmarkTask;

    getTargetPackageJson(task, "/nonexistent-workspace");

    expect(mockExecFileSync).toHaveBeenCalled();
    const calls = mockExecFileSync.mock.calls;

    expect(calls[0]?.[0]).toBe("git");
    expect(calls[0]?.[1]).toContain("clone");
    expect(calls[0]?.[1]).toContain("https://github.com/org/repo; rm -rf /");
  });
});

describe("pinnedNodeProvisioning (F-254)", () => {
  const toolchains = [
    { version: "22.22.3", binDir: "/nix/store/n22/bin" },
    { version: "24.14.1", binDir: "/nix/store/n24a/bin" },
    { version: "24.15.0", binDir: "/nix/store/n24b/bin" },
  ];

  it("provisions the pinned version, not the newest one the range allows", () => {
    // What `engines: ">=24"` resolves to on this machine — the broken one.
    expect(decideTargetNode({ engines: { node: ">=24" } }, toolchains, "v20.0.0")).toEqual({
      type: "provision",
      binDir: "/nix/store/n24b/bin",
    });
    // What the pin resolves to.
    expect(pinnedNodeProvisioning("24.14.1", toolchains)).toEqual({
      type: "provision",
      binDir: "/nix/store/n24a/bin",
    });
  });

  it("pins even when the ambient runtime would satisfy the range", () => {
    // `decideTargetNode` short-circuits to ambient here; the pin must not.
    expect(decideTargetNode({ engines: { node: ">=24" } }, toolchains, "v24.15.0").type).toBe(
      "ambient",
    );
    expect(pinnedNodeProvisioning("24.14.1", toolchains).type).toBe("provision");
  });

  it("fails closed and names the missing version when the toolchain is absent", () => {
    const decision = pinnedNodeProvisioning("24.14.1", [toolchains[0]!]);
    expect(decision).toMatchObject({
      type: "unavailable",
      neededVersion: "24.14.1",
      available: ["22.22.3"],
    });
    expect((decision as { error: string }).error).toContain("node_version");
  });
});

describe("security vulnerability secure cleanup check", () => {
  it("loadTargetEngineSource cleans up temp directory securely", () => {
    const task = {
      id: "security-cleanup-test",
      class: "brownfield",
      repo: { url: "https://invalid.example/repo", ref: "main" },
    } as unknown as BenchmarkTask;

    // Trigger cleanup via an execution that fails clone (hence entering the finally block)
    const result = loadTargetEngineSource(task, "/invalid-workspace-path");
    expect(result.type).toBe("error");

    // The temporary directory should have been cleaned up and must not exist anymore
    const tempDirPrefix = "temp-git-security-cleanup-test-";
    const files = fs.readdirSync(tmpdir());
    const matchingDirs = files.filter(f => f.startsWith(tempDirPrefix));
    expect(matchingDirs.length).toBe(0);
  });

  it("getTargetPackageJson cleans up temp directory securely on failure", () => {
    const task = {
      id: "security-pkg-cleanup-test",
      class: "brownfield",
      repo: { url: "https://invalid.example/repo", ref: "main" },
    } as unknown as BenchmarkTask;

    const dummyWorkspace = mkdtempSync(join(tmpdir(), "workspace-pkg-cleanup-test-"));
    const result = getTargetPackageJson(task, dummyWorkspace);
    expect(result).toBeNull();

    // The temporary directory created next to dummyWorkspace should have been cleaned up
    const parentDir = join(dummyWorkspace, "..");
    const tempDirPrefix = "temp-git-security-pkg-cleanup-test-";
    const files = fs.readdirSync(parentDir);
    const matchingDirs = files.filter(f => f.startsWith(tempDirPrefix));
    expect(matchingDirs.length).toBe(0);
  });

  it("ensures no shell execution of rm -rf is present in engine.ts", () => {
    const engineSrcPath = join(import.meta.dirname, "..", "src", "engine.ts");
    const content = fs.readFileSync(engineSrcPath, "utf8");
    expect(content).not.toContain("rm -rf");
    expect(content).not.toContain("execSync(`rm -rf");
    expect(content).toContain("rmSync");
  });
});
