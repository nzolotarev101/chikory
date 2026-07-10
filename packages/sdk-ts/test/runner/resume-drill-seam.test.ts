import { describe, expect, it } from "vitest";

import { shouldCrashForResumeDrill } from "../../src/runner/activities.js";

describe("shouldCrashForResumeDrill (F-127 durable-resume drill guard)", () => {
  it("crashes only at the exact armed step", () => {
    expect(shouldCrashForResumeDrill("6", 6)).toBe(true);
    expect(shouldCrashForResumeDrill("6", 5)).toBe(false);
    expect(shouldCrashForResumeDrill("6", 7)).toBe(false);
  });

  it("no-ops when the env is unset or empty (the resuming worker → clean continue)", () => {
    expect(shouldCrashForResumeDrill(undefined, 6)).toBe(false);
    expect(shouldCrashForResumeDrill("", 6)).toBe(false);
  });

  it("no-ops for a non-integer env value", () => {
    expect(shouldCrashForResumeDrill("abc", 6)).toBe(false);
    expect(shouldCrashForResumeDrill("6.5", 6)).toBe(false);
  });
});
