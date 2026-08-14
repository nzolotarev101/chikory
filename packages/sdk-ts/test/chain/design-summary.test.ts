import { describe, expect, it } from "vitest";

import {
  MAX_NODE_DESIGN_REASON_CHARS,
  summarizeNodeDesign,
} from "../../src/chain/design-summary.js";
import type { NodeOutcome } from "../../src/types.js";

describe("summarizeNodeDesign", () => {
  it("renders the same node id, status, and reason deterministically", () => {
    const outcome: NodeOutcome = { status: "SUCCESS", verdict: "PROCEED" };

    expect(summarizeNodeDesign("node-A", outcome, "Adds the pure summary primitive.")).toBe(
      "node-A · SUCCESS · Adds the pure summary primitive.",
    );
  });

  it("collapses newlines and other whitespace into a single line", () => {
    const outcome: NodeOutcome = { status: "FAILED", verdict: "HALT" };
    const summary = summarizeNodeDesign(
      "node-A",
      outcome,
      "First line.\r\nSecond line.\n\tThird line.",
    );

    expect(summary).toBe("node-A · FAILED · First line. Second line. Third line.");
    expect(summary).not.toMatch(/[\r\n]/);
  });

  it("caps a long normalized reason with an ellipsis", () => {
    const outcome: NodeOutcome = { status: "SUCCESS", verdict: "PROCEED" };
    const reason = "x".repeat(MAX_NODE_DESIGN_REASON_CHARS + 20);
    const summary = summarizeNodeDesign("node-A", outcome, reason);
    const expectedReason = `${"x".repeat(MAX_NODE_DESIGN_REASON_CHARS - 1)}…`;

    expect(summary).toBe(`node-A · SUCCESS · ${expectedReason}`);
    expect(expectedReason).toHaveLength(MAX_NODE_DESIGN_REASON_CHARS);
  });
});

