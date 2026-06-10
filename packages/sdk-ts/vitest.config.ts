import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Runner integration tests drive a real ephemeral Temporal dev server
    // (no LLM-layer mocks; transport/substrate is real — CLAUDE.md rule).
    globalSetup: ["./test/runner/global-setup.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
