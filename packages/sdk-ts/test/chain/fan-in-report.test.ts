import { describe, expect, it } from "vitest";

import { formatFanInReport } from "../../src/chain/fan-in-report.js";

describe("formatFanInReport", () => {
  it("combines the left and right artifacts", () => {
    expect(formatFanInReport()).toBe("left-artifact + right-artifact");
  });
});
