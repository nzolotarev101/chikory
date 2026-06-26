import { describe, expect, it } from "vitest";

import { scanDiffForRealSecrets, scanDiffForSecrets } from "../../src/judge/scan-secrets.js";
import { EXAMPLE_SECRET_VALUES, isExampleSecret } from "../../src/judge/secret-allowlist.js";

describe("secret example allowlist (WP-253)", () => {
  it("recognizes the canonical AWS example key only as an example secret", () => {
    const exampleAwsKey = "AKIA" + "IOSFODNN7EXAMPLE";
    const nonExampleAwsKey = "AKIA" + "1234567890ABCDEF";

    expect(EXAMPLE_SECRET_VALUES.has(exampleAwsKey)).toBe(true);
    expect(isExampleSecret(exampleAwsKey)).toBe(true);
    expect(isExampleSecret(nonExampleAwsKey)).toBe(false);
  });

  it("keeps example keys in evidence scan while excluding them from real-secret scan", () => {
    const diff = '+const k = "' + "AKIA" + 'IOSFODNN7EXAMPLE";';

    expect(scanDiffForSecrets(diff)).toEqual(["aws-access-key"]);
    expect(scanDiffForRealSecrets(diff)).toEqual([]);
  });

  it("flags non-example AWS and OpenAI-shaped keys as real secrets", () => {
    const nonExampleAwsKey = "AKIA" + "1234567890ABCDEF";
    const openAiKey = "sk-" + "abcdefghijklmnopqrstuvwx";
    const diff = [
      '+const k = "' + nonExampleAwsKey + '";',
      '+const o = "' + openAiKey + '";',
    ].join("\n");

    expect(scanDiffForRealSecrets(diff)).toEqual(["aws-access-key", "openai-key"]);
  });
});
