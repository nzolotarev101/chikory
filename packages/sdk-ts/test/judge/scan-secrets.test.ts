import { describe, expect, it } from "vitest";

import { scanDiffForSecrets } from "../../src/judge/scan-secrets.js";

describe("scanDiffForSecrets (WP-215)", () => {
  it("detects an added AWS access key", () => {
    expect(scanDiffForSecrets('+const k = "AKIAIOSFODNN7EXAMPLE";')).toEqual(["aws-access-key"]);
  });

  it("detects an added OpenAI-style key", () => {
    expect(scanDiffForSecrets('+const o = "sk-abcdefghijklmnopqrstuvwxyzABCD";')).toEqual(["openai-key"]);
  });

  it("ignores removed lines", () => {
    expect(scanDiffForSecrets('-const k = "AKIAIOSFODNN7EXAMPLE";')).toEqual([]);
  });

  it("ignores benign added lines", () => {
    expect(scanDiffForSecrets('+const greeting = "hello world";')).toEqual([]);
  });

  it("returns sorted de-duplicated labels for multi-line diffs", () => {
    const diff = [
      '+++ b/example.ts',
      '+const k = "AKIAIOSFODNN7EXAMPLE";',
      '+const o = "sk-abcdefghijklmnopqrstuvwxyzABCD";',
      '+const duplicate = "AKIAIOSFODNN7EXAMPLE";',
    ].join("\n");

    expect(scanDiffForSecrets(diff)).toEqual(["aws-access-key", "openai-key"]);
  });
});
