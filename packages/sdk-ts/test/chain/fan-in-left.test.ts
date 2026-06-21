import { describe, expect, it } from "vitest";

import { leftFanInFixture } from "../../src/chain/fan-in-left.js";

describe("leftFanInFixture", () => {
  it("returns the left artifact", () => {
    expect(leftFanInFixture()).toBe("left-artifact");
  });
});
