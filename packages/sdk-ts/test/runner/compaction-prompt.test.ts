import { describe, expect, it } from "vitest";

import {
  buildDigestMessages,
  DIGEST_SYSTEM_PROMPT,
} from "../../src/runner/compaction-prompt.js";
import type { Message } from "../../src/types.js";

describe("compaction digest prompt (WP-203, ADR-006, CM-1)", () => {
  it("builds the system and user message shape", () => {
    const input: readonly string[] = ["a", "b"];
    const messages: Message[] = buildDigestMessages(input);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: "system", content: DIGEST_SYSTEM_PROMPT });
    expect(messages[1]?.role).toBe("user");
  });

  it("renders summaries oldest to newest with numbering", () => {
    const input: readonly string[] = ["oldest", "newest"];
    const messages: Message[] = buildDigestMessages(input);
    const userContent = messages[1]?.content ?? "";

    expect(userContent.indexOf("oldest")).toBeLessThan(userContent.indexOf("newest"));
    expect(userContent.indexOf("1.")).toBeLessThan(userContent.indexOf("2."));
  });

  it("returns both messages for empty input", () => {
    const input: readonly string[] = [];
    const messages: Message[] = buildDigestMessages(input);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: "system", content: DIGEST_SYSTEM_PROMPT });
    expect(messages[1]?.role).toBe("user");
  });

  it("does not mutate the input summaries", () => {
    const input: string[] = ["older decision", "newer follow-up"];
    const beforeLength = input.length;
    const beforeElements = [...input];

    buildDigestMessages(input);

    expect(input).toHaveLength(beforeLength);
    expect(input).toEqual(beforeElements);
  });
});
