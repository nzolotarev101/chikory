import { describe, expect, it } from "vitest";
import { resolveTargetNodeEngine, planNodeProvisioning } from "../src/engine.js";

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
