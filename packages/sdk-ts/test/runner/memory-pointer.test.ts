import { describe, expect, it, vi } from "vitest";

import {
  formatPointerReference,
  parsePointerReference,
  recallPointerExcerpt,
  shouldPointerize,
  type MemoryPointerPolicy,
} from "../../src/runner/memory-pointer.js";
import type { ArtifactRef } from "../../src/types.js";

describe("memory pointer pure helpers", () => {
  const policy: MemoryPointerPolicy = { maxInlineBytes: 1024 };

  it("pointerizes output above the threshold", () => {
    expect(shouldPointerize(2048, policy)).toBe(true);
  });

  it("keeps output inline at the threshold", () => {
    expect(shouldPointerize(1024, policy)).toBe(false);
  });

  it("keeps output inline below the threshold", () => {
    expect(shouldPointerize(512, policy)).toBe(false);
  });

  it("formats the context-facing pointer reference", () => {
    const ref: ArtifactRef = {
      id: "abc123def456ghi789",
      kind: "tool_output",
      bytes: 8192,
      summary: "test suite stdout, 412 lines",
    };

    expect(formatPointerReference(ref)).toBe(
      "[memory tool_output abc123def456] 8192B — test suite stdout, 412 lines",
    );
  });

  it("does not mutate the artifact reference", () => {
    const ref: ArtifactRef = {
      id: "abc123def456ghi789",
      kind: "tool_output",
      bytes: 8192,
      summary: "test suite stdout, 412 lines",
    };
    const original = { ...ref };

    formatPointerReference(ref);

    expect(ref).toEqual(original);
  });

  it("parses a formatted pointer reference back into its fields", () => {
    const ref: ArtifactRef = {
      id: "abc123def456ghi789",
      kind: "tool_output",
      bytes: 8192,
      summary: "test suite stdout, 412 lines",
    };

    expect(parsePointerReference(formatPointerReference(ref))).toEqual({
      kind: ref.kind,
      idPrefix: ref.id.slice(0, 12),
      bytes: ref.bytes,
      summary: ref.summary,
    });
  });

  it("parses a hand-written valid pointer reference with a multi-word summary", () => {
    expect(parsePointerReference("[memory digest abc123def456] 4096B — compacted run journal excerpt")).toEqual({
      kind: "digest",
      idPrefix: "abc123def456",
      bytes: 4096,
      summary: "compacted run journal excerpt",
    });
  });

  it("returns null for malformed pointer references", () => {
    expect(parsePointerReference("[memory tool_output abc123def456] 8192 — missing byte suffix")).toBeNull();
    expect(parsePointerReference("memory tool_output abc123def456 8192B — missing prefix")).toBeNull();
    expect(parsePointerReference("[memory tool_output abc123def456] 8192B - wrong separator")).toBeNull();
  });

  it("recalls an excerpt through the injected excerpt function", async () => {
    const excerptFn = vi.fn(async () => "stored excerpt");

    await expect(recallPointerExcerpt("[memory tool_output abc123def456] 8192B — test output", excerptFn)).resolves.toBe(
      "stored excerpt",
    );
    expect(excerptFn).toHaveBeenCalledTimes(1);
    expect(excerptFn).toHaveBeenCalledWith("abc123def456", 8192);
  });

  it("returns null without calling the excerpt function for malformed input", async () => {
    const excerptFn = vi.fn(async () => "stored excerpt");

    await expect(recallPointerExcerpt("[memory tool_output abc123def456] 8192 - test output", excerptFn)).resolves.toBe(
      null,
    );
    expect(excerptFn).not.toHaveBeenCalled();
  });
});
