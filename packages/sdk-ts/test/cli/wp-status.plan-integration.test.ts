import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseWpStatus } from "../../src/cli/wp-status.js";

// F-81 lesson: the staleness gate shipped "wired live" but had only ever been
// exercised against fixture markdown with a `Status` column that production
// plan.md never has — a silent no-op for 14+ runs. This test parses the REAL
// plan.md, so any future §6 schema drift (renamed columns, new table shape)
// breaks the suite instead of silently disarming the gate again.
const PLAN_PATH = join(dirname(fileURLToPath(import.meta.url)), "../../../../plan.md");

describe("parseWpStatus against production plan.md (F-81)", () => {
  const plan = readFileSync(PLAN_PATH, "utf8");

  it("finds the §6 table at all — a schema drift that hides every WP fails here", () => {
    // Anchor WPs from different §6 tables; null for all would mean the parser
    // no longer recognizes the production schema (the F-81 failure mode).
    expect(parseWpStatus(plan, "WP-220")).not.toBeNull();
    expect(parseWpStatus(plan, "WP-301")).not.toBeNull();
  });

  it("reads a long-done WP (Notes lead with ✅ **Done**) as green/stale", () => {
    // WP-220 (`chikory land`) landed dogfood-005; its Notes cell has led with
    // the done-marker ever since. If this flips, either the row was reworded
    // away from a DONE_MARKER or the Notes fallback regressed.
    expect(parseWpStatus(plan, "WP-220")).toBe("green");
  });

  it("reads an untouched P3 WP as red/fresh despite its 🟡/🟢 complexity Tag", () => {
    // WP-301 (DevAI harness) is unstarted; its Tag emoji encodes complexity,
    // not completion — reading it as done would re-invert the gate.
    expect(parseWpStatus(plan, "WP-301")).toBe("red");
  });
});
