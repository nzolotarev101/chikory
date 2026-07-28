import { describe, expect, it } from "vitest";
import {
  verifyBaseGreen,
  findBaseVerificationCommand,
  parseTestSummary,
  type BaseVerifyRunner,
} from "../src/base-verify.js";
import type { ProvisioningDecision } from "../src/engine.js";
import type { BenchmarkTask } from "../src/task.js";

const GREEN_OUTPUT = "Test Files  9 passed (9)\n     Tests  1128 passed (1128)";
const RED_OUTPUT = "Test Files  4 failed | 5 passed (9)\n     Tests  354 failed | 774 passed (1128)";
const EMPTY_OUTPUT = "Test Files  no test files\n     Tests  0 passed (0)";
const JUNK_OUTPUT = "Segmentation fault (core dumped)";

function createMockRunner(code: number, output: string) {
  const calls: { command: string; cwd: string; env?: Record<string, string> }[] = [];
  const run: BaseVerifyRunner = async (input) => {
    calls.push(input);
    return { code, output };
  };
  return { run, calls };
}

describe("verifyBaseGreen", () => {
  const amb: ProvisioningDecision = { type: "ambient" };

  // Family 1: Green suite & negative
  it("family 1: returns green=true when suite passes all tests with exit 0", async () => {
    const mock = createMockRunner(0, GREEN_OUTPUT);
    const res = await verifyBaseGreen({ command: "pnpm test", cwd: "/w", provisioning: amb, run: mock.run });
    expect(res.green).toBe(true);
    expect(res.testsPassed).toBe(1128);
    expect(res.testsFailed).toBe(0);
    expect(res.reason).toContain("green");
  });

  // Family 2: Red suite (negative of green suite)
  it("family 2: returns green=false when suite has failing tests", async () => {
    const mock = createMockRunner(1, RED_OUTPUT);
    const res = await verifyBaseGreen({ command: "pnpm test", cwd: "/w", provisioning: amb, run: mock.run });
    expect(res.green).toBe(false);
    expect(res.testsPassed).toBe(774);
    expect(res.testsFailed).toBe(354);
    expect(res.reason).toBeDefined();
  });

  // Family 3 / Trap B: Zero tests collected & negative
  it("family 3 (trap B): returns green=false when 0 tests were collected even at exit 0", async () => {
    const mock = createMockRunner(0, EMPTY_OUTPUT);
    const res = await verifyBaseGreen({ command: "pnpm test", cwd: "/w", provisioning: amb, run: mock.run });
    expect(res.green).toBe(false);
    expect(res.testsPassed).toBe(0);
    expect(res.testsFailed).toBe(0);
    expect(res.reason).toContain("0 tests");
  });

  it("family 3 negative: returns green=true when >0 tests pass and 0 fail", async () => {
    const mock = createMockRunner(0, "Tests  1 passed (1)");
    const res = await verifyBaseGreen({ command: "pnpm test", cwd: "/w", provisioning: amb, run: mock.run });
    expect(res.green).toBe(true);
    expect(res.testsPassed).toBe(1);
    expect(res.testsFailed).toBe(0);
  });

  // Family 4: Unparseable output & negative
  it("family 4: returns green=false when output cannot be parsed", async () => {
    const mock = createMockRunner(0, JUNK_OUTPUT);
    const res = await verifyBaseGreen({ command: "pnpm test", cwd: "/w", provisioning: amb, run: mock.run });
    expect(res.green).toBe(false);
    expect(res.testsPassed).toBe(0);
    expect(res.testsFailed).toBe(0);
    expect(res.reason).toContain("Unparseable");
  });

  it("family 4 negative: parses valid output successfully", async () => {
    const parsed = parseTestSummary(GREEN_OUTPUT);
    expect(parsed).toEqual({ testsPassed: 1128, testsFailed: 0 });
  });

  // Family 5 / Trap C (provision): binDir prepended to PATH & negative (ambient)
  it("family 5 (trap C provision): prepends binDir to PATH in runner env", async () => {
    const prov: ProvisioningDecision = { type: "provision", binDir: "/custom/node24/bin" };
    const mock = createMockRunner(0, GREEN_OUTPUT);
    await verifyBaseGreen({ command: "pnpm test", cwd: "/w", provisioning: prov, run: mock.run });
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0].env?.PATH).toMatch(/^\/custom\/node24\/bin/);
  });

  // Family 6: Ambient decision (PATH untouched)
  it("family 6 (ambient): does not modify PATH prefix with binDir", async () => {
    const mock = createMockRunner(0, GREEN_OUTPUT);
    await verifyBaseGreen({ command: "pnpm test", cwd: "/w", provisioning: amb, run: mock.run });
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0].env?.PATH).not.toContain("/custom/node24/bin");
  });

  // F-199: provider credentials must not reach the target's own suite command.
  it("scrubs provider credentials from the env handed to the runner, keeping PATH", async () => {
    const priorKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-must-not-leak";
    try {
      const mock = createMockRunner(0, GREEN_OUTPUT);
      await verifyBaseGreen({ command: "pnpm test", cwd: "/w", provisioning: amb, run: mock.run });
      expect(mock.calls[0].env?.OPENAI_API_KEY).toBeUndefined();
      expect(mock.calls[0].env?.PATH).toBe(process.env.PATH);
    } finally {
      if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = priorKey;
    }
  });

  it("scrubs provider credentials on a provision decision too, with binDir still prepended", async () => {
    const priorKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-must-not-leak";
    try {
      const mock = createMockRunner(0, GREEN_OUTPUT);
      await verifyBaseGreen({
        command: "pnpm test",
        cwd: "/w",
        provisioning: { type: "provision", binDir: "/custom/node24/bin" },
        run: mock.run,
      });
      expect(mock.calls[0].env?.ANTHROPIC_API_KEY).toBeUndefined();
      expect(mock.calls[0].env?.PATH).toMatch(/^\/custom\/node24\/bin:/);
    } finally {
      if (priorKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = priorKey;
    }
  });

  // Family 7 / Trap C (unavailable): runner NEVER invoked & negative (provision/ambient invokes runner)
  it("family 7 (trap C unavailable): never invokes runner and returns non-green result", async () => {
    const unavail: ProvisioningDecision = {
      type: "unavailable",
      neededVersion: 24,
      available: ["v22.0.0"],
    };
    const mock = createMockRunner(0, GREEN_OUTPUT);
    const res = await verifyBaseGreen({ command: "pnpm test", cwd: "/w", provisioning: unavail, run: mock.run });
    expect(mock.calls).toHaveLength(0); // runner MUST NOT be invoked
    expect(res.green).toBe(false);
    expect(res.reason).toContain("24");
  });

  it("family 7 negative: invokes runner when provisioning is ambient or provision", async () => {
    const mock = createMockRunner(0, GREEN_OUTPUT);
    await verifyBaseGreen({ command: "pnpm test", cwd: "/w", provisioning: amb, run: mock.run });
    expect(mock.calls).toHaveLength(1);
  });

  // Trap A direct test: Nonzero exit with passed output text is NOT green & negative (exit 0 is green)
  it("trap A: returns green=false on nonzero exit code even if output claims all passed", async () => {
    const mock = createMockRunner(1, GREEN_OUTPUT);
    const res = await verifyBaseGreen({ command: "pnpm test", cwd: "/w", provisioning: amb, run: mock.run });
    expect(res.green).toBe(false);
    expect(res.testsPassed).toBe(1128);
    expect(res.testsFailed).toBe(0);
    expect(res.reason).toContain("exit code 1");
  });

  it("trap A negative: returns green=true when exit code is 0 for identical passed output", async () => {
    const mock = createMockRunner(0, GREEN_OUTPUT);
    const res = await verifyBaseGreen({ command: "pnpm test", cwd: "/w", provisioning: amb, run: mock.run });
    expect(res.green).toBe(true);
  });

  // Helper tests
  it("findBaseVerificationCommand extracts test check command from task", () => {
    const task: BenchmarkTask = {
      id: "brownfield-001",
      source: "authored",
      class: "brownfield",
      status: "pinned",
      goal: "test goal",
      requirements: [
        { id: "R1", description: "install", prerequisites: [], grading: { kind: "check", command: "npm install" } },
        { id: "R2", description: "full pre-existing test suite is green", prerequisites: [], grading: { kind: "check", command: "npx jest" } },
      ],
      preferences: [],
      tags: [],
      flags: {},
    };
    expect(findBaseVerificationCommand(task)).toBe("npx jest");
  });

  it("parseTestSummary strips ANSI codes and handles various Vitest/Jest output shapes", () => {
    const ansiOutput = "\u001b[32mTests  10 passed (10)\u001b[0m";
    expect(parseTestSummary(ansiOutput)).toEqual({ testsPassed: 10, testsFailed: 0 });

    const jestOutput = "Tests: 2 failed, 5 passed, 7 total";
    expect(parseTestSummary(jestOutput)).toEqual({ testsPassed: 5, testsFailed: 2 });
  });
});
