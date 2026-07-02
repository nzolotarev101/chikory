import { describe, expect, it } from "vitest";

import { parseWpStatus } from "../../src/cli/wp-status.js";

describe("parseWpStatus", () => {
  // F-81: the REAL plan.md §6 schema is `| WP | Title | Tag | Notes |`, where
  // `Tag` is COMPLEXITY (🔴/🟡/🟢) and completion lives in Notes prose. The old
  // parser demanded a `| Status |` column that production never had, so the gate
  // was a silent no-op. These fixtures use the production schema.
  describe("plan.md §6 Tag/Notes schema (F-81)", () => {
    const plan = `
| WP | Title | Tag | Notes |
| --- | --- | --- | --- |
| WP-220 | \`chikory land\` | 🟢 | ✅ **Done** (dogfood-005 run \`run-34926e85\`, landed \`abc123\`). |
| WP-256 | Spec staleness gate | 🟢 | **REOPENED 2026-07-02 (F-81): the gate is a SILENT NO-OP against production plan.md. |
| WP-218 | Token budget | 🟡 | **Slice 1 done** (dogfood-004): the denominator wire remains. |
| WP-212 | Mid-run correction injection | 🟡 | Queued — rung-1 host; the CLI \`chikory inject\` surface is the open gap. |
| WP-264 | Judge-check tree-reap | 🟢 | **LANDED dogfood-074 (\`run-6063231c\`), F-78 closed. _Below: original build record._ **Queued — Next up (dogfood-073 F-78).** |
`;

    it("reads a completed WP (Notes leads with a done-marker) as green/stale", () => {
      expect(parseWpStatus(plan, "WP-220")).toBe("green");
    });

    it("reads a REOPENED WP as red/fresh even though its Tag is 🟢 (the inversion trap)", () => {
      // The whole point of F-81: 🟢 in Tag means "mechanical", NOT "done".
      expect(parseWpStatus(plan, "WP-256")).toBe("red");
    });

    it("reads a partially-done (**Slice N done**) WP as red/fresh", () => {
      expect(parseWpStatus(plan, "WP-218")).toBe("red");
    });

    it("reads a Queued WP as red/fresh", () => {
      expect(parseWpStatus(plan, "WP-212")).toBe("red");
    });

    it("honors the LEADING done-marker over a preserved historical 'Queued' tail", () => {
      expect(parseWpStatus(plan, "WP-264")).toBe("green");
    });

    it("returns null for a WP id absent from the table", () => {
      expect(parseWpStatus(plan, "WP-999")).toBeNull();
    });

    it("uses exact id matching (WP-25 ≠ WP-255) on the Tag/Notes schema", () => {
      const shortId = `
| WP | Title | Tag | Notes |
| --- | --- | --- | --- |
| WP-25 | Older short id | 🔴 | Queued. |
| WP-255 | Step deadline | 🟢 | ✅ **Done**. |
`;
      expect(parseWpStatus(shortId, "WP-255")).toBe("green");
      expect(parseWpStatus(shortId, "WP-25")).toBe("red");
    });
  });

  describe("explicit Status column (back-compat)", () => {
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

    it("reads only the Status column, not prose icons elsewhere in the row", () => {
      const markdown = `
| WP | Notes | Status |
| --- | --- | --- |
| WP-256 | prose says 🔴 but the status is closed | 🟢 |
`;

      expect(parseWpStatus(markdown, "WP-256")).toBe("green");
    });

    it("returns null for prose mentions or absent ids", () => {
      const markdown = `
WP-257 is 🔴 in prose, outside the table.

| WP | Title | Status |
| --- | --- | --- |
| WP-258 | No icon yet | Queued |
`;

      expect(parseWpStatus(markdown, "WP-257")).toBeNull();
      expect(parseWpStatus(markdown, "WP-999")).toBeNull();
      // A Status-column cell with no icon still yields null (no Tag/Notes fallback
      // here — this table has an explicit Status column).
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
});
