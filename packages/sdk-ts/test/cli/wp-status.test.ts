import { describe, expect, it } from "vitest";

import { parseWpStatus } from "../../src/cli/wp-status.js";

describe("parseWpStatus", () => {
  it("returns the red/yellow/green status from the matching WP table row", () => {
    const markdown = `
| WP | Title | Status |
| --- | --- | --- |
| WP-253 | Secret override | 🔴 |
| WP-254 | Pacing numerator | 🟡 |
| WP-255 | Step deadline | 🟢 |
`;

    expect(parseWpStatus(markdown, "WP-253")).toBe("red");
    expect(parseWpStatus(markdown, "WP-254")).toBe("yellow");
    expect(parseWpStatus(markdown, "WP-255")).toBe("green");
  });

  it("uses exact id matching for the F-49 WP-25 discriminator", () => {
    const markdown = `
| WP | Title | Status |
| --- | --- | --- |
| WP-25 | Older short id | 🔴 |
| WP-255 | Step deadline | 🟢 |
`;

    expect(parseWpStatus(markdown, "WP-255")).toBe("green");
  });

  it("reads only the Status column, not prose icons elsewhere in the row", () => {
    const markdown = `
| WP | Notes | Status |
| --- | --- | --- |
| WP-256 | prose says 🔴 but the status is closed | 🟢 |
`;

    expect(parseWpStatus(markdown, "WP-256")).toBe("green");
  });

  it("returns null for prose mentions, absent ids, or rows without status icons", () => {
    const markdown = `
WP-257 is 🔴 in prose, outside the table.

| WP | Title | Status |
| --- | --- | --- |
| WP-258 | No icon yet | Queued |
`;

    expect(parseWpStatus(markdown, "WP-257")).toBeNull();
    expect(parseWpStatus(markdown, "WP-999")).toBeNull();
    expect(parseWpStatus(markdown, "WP-258")).toBeNull();
  });

  it("supports markdown-formatted ids in table cells", () => {
    const markdown = `
| Work package | Status |
| --- | --- |
| \`WP-259\` | 🟡 |
| [WP-260](docs/spec/example.md) | 🟢 |
`;

    expect(parseWpStatus(markdown, "WP-259")).toBe("yellow");
    expect(parseWpStatus(markdown, "WP-260")).toBe("green");
  });
});
