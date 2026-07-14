import { describe, expect, it } from "vitest";

import { decideChainCompletionReview, MIN_CHAIN_NODES_FOR_REVIEW } from "../../src/index.js";

describe("decideChainCompletionReview (WP-311)", () => {
  it("reviews a multi-node all-SUCCESS chain", () => {
    expect(
      decideChainCompletionReview({ nodeCount: 3, succeededCount: 3, alreadyReviewed: false }),
    ).toEqual({ action: "review" });
  });

  it(`skips a chain with fewer than ${MIN_CHAIN_NODES_FOR_REVIEW} nodes`, () => {
    const decision = decideChainCompletionReview({
      nodeCount: 1,
      succeededCount: 1,
      alreadyReviewed: false,
    });
    expect(decision.action).toBe("skip");
  });

  it("skips when not every node sealed SUCCESS", () => {
    const decision = decideChainCompletionReview({
      nodeCount: 3,
      succeededCount: 2,
      alreadyReviewed: false,
    });
    expect(decision.action).toBe("skip");
  });

  it("skips a resumed re-seal that already carries a review", () => {
    const decision = decideChainCompletionReview({
      nodeCount: 3,
      succeededCount: 3,
      alreadyReviewed: true,
    });
    expect(decision.action).toBe("skip");
  });
});
