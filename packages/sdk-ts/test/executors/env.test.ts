import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createClaudeCodeAdapter } from "../../src/executors/claude-code.js";
import { createCodexAdapter } from "../../src/executors/codex.js";
import {
  PROVIDER_ENV_VARS,
  scrubExecutorEnv,
} from "../../src/executors/env.js";
import { makeStepInput, makeWorkspace, TOY_STEPS } from "./conformance.js";

const FAKE_BIN = fileURLToPath(new URL("./fake-bins/fake-cli.cjs", import.meta.url));

const ALL_PROVIDER_ENV = {
  ANTHROPIC_API_KEY: "anthropic-key",
  OPENAI_API_KEY: "openai-key",
  GEMINI_API_KEY: "gemini-key",
  OPENAI_COMPAT_BASE_URL: "https://example.invalid",
  OPENAI_COMPAT_API_KEY: "compat-key",
} as const;

describe("scrubExecutorEnv", () => {
  it("keeps the selected provider variable and drops the other four", () => {
    const scrubbed = scrubExecutorEnv(ALL_PROVIDER_ENV, ["OPENAI_API_KEY"]);

    expect(scrubbed.OPENAI_API_KEY).toBe("openai-key");
    for (const name of PROVIDER_ENV_VARS) {
      if (name !== "OPENAI_API_KEY") {
        expect(scrubbed).not.toHaveProperty(name);
      }
    }
  });

  it("returns a new object without mutating the input and preserves unrelated variables", () => {
    const base: Record<string, string | undefined> = {
      ...ALL_PROVIDER_ENV,
      PATH: "/test/bin",
      HOME: "/test/home",
      FAKE_MODE: "ok",
    };

    const scrubbed = scrubExecutorEnv(base, ["ANTHROPIC_API_KEY"]);

    expect(scrubbed).not.toBe(base);
    expect(base).toEqual({
      ...ALL_PROVIDER_ENV,
      PATH: "/test/bin",
      HOME: "/test/home",
      FAKE_MODE: "ok",
    });
    expect(scrubbed.PATH).toBe("/test/bin");
    expect(scrubbed.HOME).toBe("/test/home");
    expect(scrubbed.FAKE_MODE).toBe("ok");
  });
});

describe("executor provider environment scrubbing", () => {
  it("passes only OPENAI_API_KEY to the Codex child process", async () => {
    const ws = await makeWorkspace();
    const adapter = createCodexAdapter({
      store: ws.store,
      binPath: FAKE_BIN,
      env: {
        ...process.env,
        ...ALL_PROVIDER_ENV,
        FAKE_DIALECT: "codex",
        FAKE_MODE: "ok",
        FAKE_ECHO_ENV: "1",
      },
    });

    const record = await adapter.runStep(makeStepInput(ws, TOY_STEPS[0].instruction, 30));

    expect(record.status).toBe("SUCCESS");
    expect(record.summary).toMatch(/provider_env=OPENAI_API_KEY$/);
  });

  it("passes only ANTHROPIC_API_KEY to the Claude Code child process", async () => {
    const ws = await makeWorkspace();
    const adapter = createClaudeCodeAdapter({
      store: ws.store,
      binPath: FAKE_BIN,
      env: {
        ...process.env,
        ...ALL_PROVIDER_ENV,
        FAKE_DIALECT: "claude",
        FAKE_MODE: "ok",
        FAKE_ECHO_ENV: "1",
      },
    });

    const record = await adapter.runStep(makeStepInput(ws, TOY_STEPS[0].instruction, 30));

    expect(record.status).toBe("SUCCESS");
    expect(record.summary).toMatch(/provider_env=ANTHROPIC_API_KEY$/);
  });
});
