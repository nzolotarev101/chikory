import { describe, expect, it } from "vitest";

import { rightFanInFixture } from "../../src/chain/fan-in-right.js";

describe("rightFanInFixture", () => {
  it("returns the right artifact", () => {
    expect(rightFanInFixture()).toBe("right-artifact");
  });
});
