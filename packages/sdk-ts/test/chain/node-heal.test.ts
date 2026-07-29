/**
 * F-214 — the chain re-enters a resumable child before it rewrites the node.
 */
import { describe, expect, it } from "vitest";

import { MAX_CHILD_RESUMES_PER_NODE, decideNodeHeal } from "../../src/index.js";

describe("decideNodeHeal (F-214)", () => {
  it("resumes a child that sealed resumable — the work is preserved", () => {
    const decision = decideNodeHeal({
      childStatus: "FAILED",
      childResumable: true,
      resumesUsed: 0,
    });

    expect(decision).toMatchObject({ action: "resume_child", attempt: 1 });
    expect(decision.reason).toContain("preserved");
  });

  it("replans instead when the child sealed a DEAD failed — nothing to re-enter", () => {
    const decision = decideNodeHeal({
      childStatus: "FAILED",
      childResumable: false,
      resumesUsed: 0,
    });

    expect(decision).toMatchObject({ action: "replan_node" });
    expect(decision.reason).toContain("dead FAILED");
  });

  it("is bounded — a spent budget falls through to the replan tier (CG-1)", () => {
    const decision = decideNodeHeal({
      childStatus: "FAILED",
      childResumable: true,
      resumesUsed: MAX_CHILD_RESUMES_PER_NODE,
    });

    expect(decision).toMatchObject({ action: "replan_node" });
    expect(decision.reason).toContain("budget spent");
  });

  it("grants more than one when the caller widens the bound", () => {
    expect(
      decideNodeHeal({ childStatus: "FAILED", childResumable: true, resumesUsed: 1 }, 2),
    ).toMatchObject({ action: "resume_child", attempt: 2 });
  });

  it("never fires for a node that succeeded", () => {
    expect(
      decideNodeHeal({ childStatus: "SUCCESS", childResumable: true, resumesUsed: 0 }),
    ).toMatchObject({ action: "replan_node", reason: "node did not fail" });
  });
});
