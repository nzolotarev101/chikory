/**
 * Minimal artifact store (WP-111 slice of artifacts.md P1) — content
 * addressing, ref stability, summary cap, and P1 excerpt semantics, verified
 * identically for the local-FS and in-memory implementations.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createLocalArtifactStore, createMemoryArtifactStore, MAX_SUMMARY_CHARS } from "../src/artifacts/index.js";
import { ArtifactRefSchema } from "../src/schemas.js";
import type { ArtifactStore } from "../src/types.js";

const CASES: Array<{ name: string; make: () => Promise<ArtifactStore> }> = [
  {
    name: "local-fs",
    make: async () => createLocalArtifactStore(await mkdtemp(join(tmpdir(), "chikory-artifacts-"))),
  },
  { name: "memory", make: () => Promise.resolve(createMemoryArtifactStore()) },
];

for (const { name, make } of CASES) {
  describe(`artifact store: ${name}`, () => {
    it("round-trips content and produces a contract-valid, content-addressed ref", async () => {
      const store = await make();
      const ref = await store.put("diff --git a/x b/x\n+hello\n", {
        kind: "diff",
        summary: "toy diff",
      });
      ArtifactRefSchema.parse(ref);
      expect(ref.bytes).toBeGreaterThan(0);
      expect(new TextDecoder().decode(await store.get(ref))).toContain("+hello");
      // Content-addressed: same bytes ⇒ same id, stable across resume/branch (AR-1).
      const again = await store.put("diff --git a/x b/x\n+hello\n", {
        kind: "diff",
        summary: "different summary",
      });
      expect(again.id).toBe(ref.id);
    });

    it("caps summaries at the CM-3 context budget", async () => {
      const store = await make();
      const ref = await store.put("x", { kind: "tool_output", summary: "s".repeat(500) });
      expect(ref.summary.length).toBe(MAX_SUMMARY_CHARS);
    });

    it("excerpts by 1-based line range and by query", async () => {
      const store = await make();
      const ref = await store.put("one\ntwo\nthree\nfour", {
        kind: "transcript",
        summary: "lines",
      });
      expect(await store.excerpt(ref, { range: [2, 3] })).toBe("two\nthree");
      expect(await store.excerpt(ref, { query: "ree" })).toBe("3: three");
    });
  });
}
