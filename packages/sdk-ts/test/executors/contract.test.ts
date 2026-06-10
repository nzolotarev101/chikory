/**
 * Step-contract doc test (WP-111) — executors.md's interface block and the
 * frozen contracts must not drift (doc-follows-code drift is a bug,
 * TASK-PROTOCOL.md §3). Extracts field names from the doc's ts block and
 * checks them against the zod schema shapes.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { StepInputSchema, StepRecordSchema } from "../../src/schemas.js";

const DOC_URL = new URL("../../../../docs/components/executors.md", import.meta.url);

function docInterfaceFields(doc: string, name: string): string[] {
  const match = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(doc);
  if (!match) throw new Error(`interface ${name} not found in executors.md`);
  return [...match[1].matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]);
}

describe("step contract ↔ executors.md (WP-111)", () => {
  it("doc interfaces list exactly the schema fields", async () => {
    const doc = await readFile(fileURLToPath(DOC_URL), "utf8");
    expect(docInterfaceFields(doc, "StepInput").sort()).toEqual(
      Object.keys(StepInputSchema.shape).sort(),
    );
    expect(docInterfaceFields(doc, "StepRecord").sort()).toEqual(
      Object.keys(StepRecordSchema.shape).sort(),
    );
  });
});
