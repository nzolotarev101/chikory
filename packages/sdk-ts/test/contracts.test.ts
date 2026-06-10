/**
 * WP-002 contract conformance: every fixture in fixtures/contracts/ must
 * round-trip parse → validate → re-serialize to byte-identical canonical
 * JSON (CONTRACTS.md §10). Python (WP-201) runs the same fixtures.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { canonicalJson } from "../src/canonical-json.js";
import { contractSchemas, type ContractName } from "../src/schemas.js";

const fixturesDir = join(__dirname, "..", "..", "..", "fixtures", "contracts");
const files = readdirSync(fixturesDir).filter((f) => f.endsWith(".json"));

function schemaFor(file: string) {
  const name = file.split(".")[0] as ContractName;
  const schema = contractSchemas[name];
  if (!schema) throw new Error(`fixture ${file} names unknown contract '${name}'`);
  return schema;
}

const validFiles = files.filter((f) => f.includes(".valid"));
const invalidFiles = files.filter((f) => f.includes(".invalid"));

describe("contract fixtures", () => {
  it("exist for every serializable contract (valid set)", () => {
    const covered = new Set(validFiles.map((f) => f.split(".")[0]));
    for (const name of Object.keys(contractSchemas)) {
      expect(covered, `missing valid fixture for ${name}`).toContain(name);
    }
    expect(invalidFiles.length).toBeGreaterThan(0);
  });

  describe.each(validFiles)("%s", (file) => {
    const raw = readFileSync(join(fixturesDir, file), "utf8");

    it("validates against its schema", () => {
      const result = schemaFor(file).safeParse(JSON.parse(raw));
      expect(result.success, JSON.stringify(result.success ? "" : result.error.issues)).toBe(true);
    });

    it("round-trips to byte-identical canonical JSON", () => {
      const parsed = schemaFor(file).parse(JSON.parse(raw));
      expect(canonicalJson(parsed)).toBe(raw);
    });
  });

  describe.each(invalidFiles)("%s", (file) => {
    it("is rejected by its schema", () => {
      const raw = readFileSync(join(fixturesDir, file), "utf8");
      const result = schemaFor(file).safeParse(JSON.parse(raw));
      expect(result.success).toBe(false);
    });
  });
});
