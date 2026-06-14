import { describe, expect, it } from "vitest";

import {
  claimsCompleteFromSummary,
  COMPLETION_MARKER,
} from "../../src/executors/step.js";

describe("claimsCompleteFromSummary", () => {
  it("accepts a summary that is exactly the marker", () => {
    expect(claimsCompleteFromSummary(COMPLETION_MARKER)).toBe(true);
  });

  it("accepts the marker on its own line after other text", () => {
    expect(claimsCompleteFromSummary(`Implemented the feature.\n${COMPLETION_MARKER}`)).toBe(true);
  });

  it("accepts surrounding whitespace on the marker line", () => {
    expect(claimsCompleteFromSummary(`   ${COMPLETION_MARKER}  `)).toBe(true);
  });

  it("rejects an empty summary", () => {
    expect(claimsCompleteFromSummary("")).toBe(false);
  });

  it("rejects the marker as a substring inside a sentence", () => {
    expect(claimsCompleteFromSummary(`I will emit ${COMPLETION_MARKER} once tests pass`)).toBe(
      false,
    );
  });

  it("rejects a normal summary with no marker", () => {
    expect(claimsCompleteFromSummary("Implemented the feature and all tests pass.")).toBe(false);
  });
});
