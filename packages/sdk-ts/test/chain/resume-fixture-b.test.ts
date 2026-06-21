import { describe, expect, it } from "vitest";

import { formatResumeReport } from "../../src/chain/resume-fixture-b.js";

describe("formatResumeReport", () => {
  it("combines the resume A and resume B fixtures", () => {
    expect(formatResumeReport()).toBe("resume-a + resume-b");
  });
});
