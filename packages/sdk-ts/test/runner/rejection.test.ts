import { describe, expect, it } from "vitest";
import { decideRejection, REJECTION_BRIEF_MAX_CHARS } from "../../src/workflow/rejection.js";

describe("decideRejection (WP-602 AC-1)", () => {
  const REASON = "untrack the 8 mode-160000 gitlinks under benchmarks/results; keep the ledger";

  it("heals a reasoned reject under budget and carries the reason verbatim", () => {
    const heal = decideRejection({ reason: REASON, strikesSpent: 0, maxStrikes: 2 });
    expect(heal.action).toBe("heal");
    if (heal.action === "heal") {
      expect(heal.brief).toContain(REASON);
    }
  });

  it("seals dead when budget is spent or exceeded and names rejection as cause", () => {
    for (const spent of [2, 3, 7]) {
      const d = decideRejection({ reason: REASON, strikesSpent: spent, maxStrikes: 2 });
      expect(d.action).toBe("seal_dead");
      if (d.action === "seal_dead") {
        expect(d.failureReason).toMatch(/reject/i);
      }
    }
  });

  it("seals dead when maxStrikes is 0 (opt-out)", () => {
    const optOut = decideRejection({ reason: REASON, strikesSpent: 0, maxStrikes: 0 });
    expect(optOut.action).toBe("seal_dead");
    if (optOut.action === "seal_dead") {
      expect(optOut.failureReason).toMatch(/reject/i);
    }
  });

  it("seals dead when reason is missing, empty, or whitespace-only", () => {
    const inputs: Array<[string, string | undefined]> = [
      ["absent", undefined],
      ["empty", ""],
      ["whitespace", "   \t\n  "],
    ];
    for (const [_label, reason] of inputs) {
      const d = decideRejection({ reason, strikesSpent: 0, maxStrikes: 2 });
      expect(d.action).toBe("seal_dead");
      if (d.action === "seal_dead") {
        expect(d.failureReason).toMatch(/reject/i);
      }
    }
  });

  it("bounds an oversized reason while keeping it recognisable at its start", () => {
    const longReason = "REASON_START_" + "x".repeat(3000) + "_REASON_END";
    const heal = decideRejection({ reason: longReason, strikesSpent: 0, maxStrikes: 2 });
    expect(heal.action).toBe("heal");
    if (heal.action === "heal") {
      expect(heal.brief.length).toBeLessThanOrEqual(REJECTION_BRIEF_MAX_CHARS);
      expect(heal.brief).toContain("REASON_START_");
    }
  });
});
