import { describe, expect, it } from "vitest";

import { assessSpecStaleness } from "../../src/cli/spec-staleness.js";

describe("assessSpecStaleness", () => {
  it("marks a 🟢 target row as stale", () => {
    const planText = `
| WP | Title | Status |
| --- | --- | --- |
| WP-255 | Step deadline | 🟢 |
`;

    const report = assessSpecStaleness({ targetWpId: "WP-255", planText });

    expect(report.targetWpId).toBe("WP-255");
    expect(report.status).toBe("green");
    expect(report.stale).toBe(true);
    expect(report.reason).toBe("target WP-255 already done (🟢) — spec is stale");
  });

  it("marks a 🟡 target row as fresh", () => {
    const planText = `
| WP | Title | Status |
| --- | --- | --- |
| WP-256 | Spec staleness gate | 🟡 |
`;

    const report = assessSpecStaleness({ targetWpId: "WP-256", planText });

    expect(report.status).toBe("yellow");
    expect(report.stale).toBe(false);
    expect(report.reason).toBe("target WP-256 is yellow — spec is fresh");
  });

  it("marks an absent target as fresh with null status", () => {
    const planText = `
| WP | Title | Status |
| --- | --- | --- |
| WP-256 | Spec staleness gate | 🔴 |
`;

    const report = assessSpecStaleness({ targetWpId: "WP-999", planText });

    expect(report.status).toBeNull();
    expect(report.stale).toBe(false);
    expect(report.reason).toBe("target WP-999 not found in plan");
  });

  it("does not mutate the input object", () => {
    const input = {
      targetWpId: "WP-256",
      planText: `
| WP | Title | Status |
| --- | --- | --- |
| WP-256 | Spec staleness gate | 🔴 |
`,
    };
    const snapshot = { ...input };

    assessSpecStaleness(input);

    expect(input).toEqual(snapshot);
  });
});
