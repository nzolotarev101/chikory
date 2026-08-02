import { describe, expect, it } from "vitest";
import {
  verifyBaseGreen,
  parseTestSummary,
  outputTail,
  DEFAULT_BASE_VERIFY_TIMEOUT_MS,
  type BaseVerifyRunner,
} from "../src/base-verify.js";
import type { ProvisioningDecision } from "../src/engine.js";

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

  // F-238 (dogfood-122): every scored task reported the same
  // "Unparseable suite output: could not find test summary" whether the suite
  // ran and printed something odd or never started at all. The exit code is
  // the discriminator and it was being checked second, then discarded.
  describe("F-238: a suite that never ran must not be reported as unparseable", () => {
    const INSTALL_FAILURE =
      "Progress: resolved 0, reused 0\nERR_PNPM_LOCKFILE_CONFIG_MISMATCH  Cannot install with frozen-lockfile\nERROR  Command failed with exit code 1";

    it("names the exit code and the real output when the command failed", async () => {
      const mock = createMockRunner(1, INSTALL_FAILURE);
      const res = await verifyBaseGreen({ command: "pnpm install && pnpm test", cwd: "/w", provisioning: amb, run: mock.run });
      expect(res.green).toBe(false);
      expect(res.reason).toContain("exit code 1");
      expect(res.reason).toContain("ERR_PNPM_LOCKFILE_CONFIG_MISMATCH");
      // The parser is NOT blamed for a suite that never got to print a summary.
      expect(res.reason).not.toContain("Unparseable");
    });

    it("still says unparseable when the command SUCCEEDED but printed no summary", async () => {
      const mock = createMockRunner(0, JUNK_OUTPUT);
      const res = await verifyBaseGreen({ command: "pnpm test", cwd: "/w", provisioning: amb, run: mock.run });
      expect(res.reason).toContain("Unparseable");
      expect(res.reason).toContain("Segmentation fault");
    });

    it("keeps the plain exit-code reason when the failing suite DID print counts", async () => {
      const mock = createMockRunner(1, RED_OUTPUT);
      const res = await verifyBaseGreen({ command: "pnpm test", cwd: "/w", provisioning: amb, run: mock.run });
      expect(res.reason).toBe("Verification command failed with exit code 1");
      expect(res.testsFailed).toBe(354);
    });

    it("survives a command that printed nothing at all", async () => {
      const mock = createMockRunner(127, "");
      const res = await verifyBaseGreen({ command: "pnpm test", cwd: "/w", provisioning: amb, run: mock.run });
      expect(res.reason).toContain("exit code 127");
      expect(res.reason).toContain("no output at all");
    });
  });

  // F-241 (dogfood-122): base verification borrowed DEFAULT_CHECK_TIMEOUT_MS —
  // the 120 s cap for a single judge assertion — for a job that installs a real
  // target's dependencies and runs its entire suite. It could never pass, so
  // AC-7/AC-8 (`baseVerification.green === true` on all five tasks) made P3
  // rung 4 unreachable, and no message said why.
  describe("F-241: base verification gets a timeout sized for install + suite", () => {
    function capturingRunner(code: number, output: string) {
      const calls: { timeoutMs?: number }[] = [];
      const run: BaseVerifyRunner = async (input) => {
        calls.push({ ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}) });
        return { code, output };
      };
      return { run, calls };
    }

    it("defaults to far more than the 120 s judge-check cap", async () => {
      const mock = capturingRunner(0, GREEN_OUTPUT);
      await verifyBaseGreen({ command: "pnpm test", cwd: "/w", provisioning: amb, run: mock.run });
      expect(mock.calls[0]?.timeoutMs).toBe(DEFAULT_BASE_VERIFY_TIMEOUT_MS);
      expect(DEFAULT_BASE_VERIFY_TIMEOUT_MS).toBeGreaterThan(120_000);
    });

    it("honours an explicit cap", async () => {
      const mock = capturingRunner(0, GREEN_OUTPUT);
      await verifyBaseGreen({
        command: "pnpm test",
        cwd: "/w",
        provisioning: amb,
        run: mock.run,
        timeoutMs: 90 * 60_000,
      });
      expect(mock.calls[0]?.timeoutMs).toBe(5_400_000);
    });

    it("reports a timeout as a timeout, not as unparseable output", async () => {
      // What the real runner produces when the cap is hit: partial output plus
      // the marker, and a non-zero code.
      const mock = createMockRunner(1, "Progress: resolved 812\n[base verification timed out after 120000ms]");
      const res = await verifyBaseGreen({ command: "pnpm test", cwd: "/w", provisioning: amb, run: mock.run });
      expect(res.green).toBe(false);
      expect(res.reason).toContain("timed out");
      expect(res.reason).not.toContain("Unparseable");
    });
  });

  // F-243 (dogfood-122): a HOME-level ~/.yarnrc.yml with `yarnPath` made Yarn 1
  // re-exec Yarn Berry from any directory, so brownfield-001's base verification
  // failed with a Berry lockfile error that looked like a defect in the target.
  it("F-243: neutralises a HOME-level yarnPath so a pinned yarn means that yarn", async () => {
    const mock = createMockRunner(0, GREEN_OUTPUT);
    await verifyBaseGreen({
      command: "npx -y yarn@1.22.22 install --frozen-lockfile",
      cwd: "/w",
      provisioning: amb,
      run: mock.run,
    });
    expect(mock.calls[0]?.env?.YARN_IGNORE_PATH).toBe("1");
  });

  describe("outputTail", () => {
    it("strips ANSI, drops blank lines, and keeps the last five", () => {
      const tail = outputTail("[32mone[0m\n\n two \n three\nfour\nfive\nsix\n");
      expect(tail).toBe("two ⏎ three ⏎ four ⏎ five ⏎ six");
    });

    it("bounds a runaway line to the limit, keeping its END", () => {
      const tail = outputTail(`${"a".repeat(50)}FINAL`, 20);
      expect(tail.length).toBeLessThanOrEqual(21); // 20 + the ellipsis marker
      expect(tail.endsWith("FINAL")).toBe(true);
    });
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
  it("parseTestSummary strips ANSI codes and handles various Vitest/Jest output shapes", () => {
    const ansiOutput = "\u001b[32mTests  10 passed (10)\u001b[0m";
    expect(parseTestSummary(ansiOutput)).toEqual({ testsPassed: 10, testsFailed: 0 });

    const jestOutput = "Tests: 2 failed, 5 passed, 7 total";
    expect(parseTestSummary(jestOutput)).toEqual({ testsPassed: 5, testsFailed: 2 });
  });

  it("parseTestSummary returns null for output without test summary", () => {
    expect(parseTestSummary("Random log output line")).toBeNull();
  });

  it("verifyBaseGreen handles null exit code by treating as exit 1 failure", async () => {
    const mock = createMockRunner(null as unknown as number, GREEN_OUTPUT);
    const res = await verifyBaseGreen({ command: "pnpm test", cwd: "/w", provisioning: amb, run: mock.run });
    expect(res.green).toBe(false);
    expect(res.reason).toContain("exit code 1");
  });
});
