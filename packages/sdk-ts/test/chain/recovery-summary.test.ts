import { describe, expect, it } from "vitest";

import {
  MAX_NODE_RECOVERY_REASON_CHARS,
  summarizeNodeRecovery,
} from "../../src/chain/recovery-summary.js";
import type { NodeOutcome } from "../../src/types.js";

describe("summarizeNodeRecovery", () => {
  const recovered: NodeOutcome = { status: "SUCCESS", verdict: "PROCEED" };

  it("formats the same recovery facts deterministically", () => {
    const summary = summarizeNodeRecovery("node-A", recovered, 2, "AC-1 failed");

    expect(summary).toBe("node-A · SUCCESS · attempts 2 · last failure: AC-1 failed");
    expect(summarizeNodeRecovery("node-A", recovered, 2, "AC-1 failed")).toBe(summary);
  });

  it.each([1, 2, 4])("renders an attempt count of %i", (attempts) => {
    expect(summarizeNodeRecovery("node-A", recovered, attempts, "retry reason")).toContain(
      `· attempts ${attempts} ·`,
    );
  });

  it("caps a long last-failure reason with an ellipsis", () => {
    const reason = "x".repeat(MAX_NODE_RECOVERY_REASON_CHARS + 20);
    const summary = summarizeNodeRecovery("node-A", recovered, 3, reason);
    const expectedReason = `${"x".repeat(MAX_NODE_RECOVERY_REASON_CHARS - 1)}…`;

    expect(summary).toBe(`node-A · SUCCESS · attempts 3 · last failure: ${expectedReason}`);
    expect(expectedReason).toHaveLength(MAX_NODE_RECOVERY_REASON_CHARS);
  });

  it("normalizes whitespace into bounded one-line output", () => {
    const failed: NodeOutcome = { status: "FAILED", verdict: "HALT" };
    const reason = `${"failure ".repeat(80)}\r\nfinal detail`;
    const summary = summarizeNodeRecovery(" node-A\nretry ", failed, 4, reason);
    const prefix = "node-A retry · FAILED · attempts 4 · last failure: ";

    expect(summary).not.toMatch(/[\r\n]/);
    expect(summary.startsWith(prefix)).toBe(true);
    expect(summary).toHaveLength(prefix.length + MAX_NODE_RECOVERY_REASON_CHARS);
  });
});
