import { describe, expect, it } from "vitest";

import { resumeFixtureA } from "../../src/chain/resume-fixture-a.js";

describe("resumeFixtureA", () => {
  it("returns the resume A fixture", () => {
    expect(resumeFixtureA()).toBe("resume-a");
  });
});
