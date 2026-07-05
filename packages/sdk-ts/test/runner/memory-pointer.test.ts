import { describe, expect, it, vi } from "vitest";

import {
  decideMemoryEviction,
  formatPointerReference,
  parsePointerReference,
  recallPointerExcerpt,
  resolveMemoryRecallRequest,
  shouldPointerize,
  type MemoryEvictionPolicy,
  type MemoryPointerPolicy,
} from "../../src/runner/memory-pointer.js";
import type { ArtifactRef } from "../../src/types.js";

describe("memory pointer pure helpers", () => {
  const policy: MemoryPointerPolicy = { maxInlineBytes: 1024 };
  const carriedRefs: ArtifactRef[] = [
    {
      id: "abc123def456ghi789",
      kind: "tool_output",
      bytes: 8192,
      summary: "test suite stdout, 412 lines",
    },
    {
      id: "fedcba654321xyz987",
      kind: "context_snapshot",
      bytes: 4096,
      summary: "compacted run journal excerpt",
    },
  ];

  it("pointerizes output above the threshold", () => {
    expect(shouldPointerize(2048, policy)).toBe(true);
  });

  it("keeps output inline at the threshold", () => {
    expect(shouldPointerize(1024, policy)).toBe(false);
  });

  it("keeps output inline below the threshold", () => {
    expect(shouldPointerize(512, policy)).toBe(false);
  });

  it("does not evict refs when no eviction policy is provided", () => {
    const result = decideMemoryEviction(carriedRefs);

    expect(result).toEqual({ keep: carriedRefs, evicted: [] });
    expect(result.keep).not.toBe(carriedRefs);
  });

  it("evicts the oldest refs when the max-count bound is exceeded", () => {
    const refs: ArtifactRef[] = [
      { id: "oldest000000", kind: "tool_output", bytes: 100, summary: "oldest" },
      { id: "middle000000", kind: "tool_output", bytes: 100, summary: "middle" },
      { id: "newest000000", kind: "tool_output", bytes: 100, summary: "newest" },
    ];

    expect(decideMemoryEviction(refs, { maxRefs: 2 })).toEqual({
      keep: [refs[1], refs[2]],
      evicted: [refs[0]],
    });
  });

  it("evicts the coldest refs until the max-bytes bound is satisfied", () => {
    const refs: ArtifactRef[] = [
      { id: "oldest000000", kind: "tool_output", bytes: 70, summary: "oldest" },
      { id: "middle000000", kind: "tool_output", bytes: 30, summary: "middle" },
      { id: "newest000000", kind: "tool_output", bytes: 20, summary: "newest" },
    ];

    expect(decideMemoryEviction(refs, { maxBytes: 50 })).toEqual({
      keep: [refs[1], refs[2]],
      evicted: [refs[0]],
    });
  });

  it("applies count and byte bounds together without evicting refs at an exact tie", () => {
    const refs: ArtifactRef[] = [
      { id: "oldest000000", kind: "tool_output", bytes: 10, summary: "oldest" },
      { id: "middle000000", kind: "tool_output", bytes: 20, summary: "middle" },
      { id: "newest000000", kind: "tool_output", bytes: 30, summary: "newest" },
    ];
    const exactPolicy: MemoryEvictionPolicy = { maxRefs: 3, maxBytes: 60 };

    expect(decideMemoryEviction(refs, exactPolicy)).toEqual({ keep: refs, evicted: [] });
    expect(decideMemoryEviction(refs, { maxRefs: 2, maxBytes: 50 })).toEqual({
      keep: [refs[1], refs[2]],
      evicted: [refs[0]],
    });
  });

  it("handles empty ref lists", () => {
    expect(decideMemoryEviction([], { maxRefs: 1, maxBytes: 1 })).toEqual({ keep: [], evicted: [] });
  });

  it("does not mutate the input refs while deciding eviction", () => {
    const refs: ArtifactRef[] = [
      { id: "oldest000000", kind: "tool_output", bytes: 10, summary: "oldest" },
      { id: "middle000000", kind: "tool_output", bytes: 20, summary: "middle" },
      { id: "newest000000", kind: "tool_output", bytes: 30, summary: "newest" },
    ];
    const originalArray = refs.slice();
    const originalRefs = refs.map((ref) => ({ ...ref }));

    const result = decideMemoryEviction(refs, { maxRefs: 1 });

    expect(refs).toEqual(originalArray);
    expect(refs).toEqual(originalRefs);
    expect(result.keep).toEqual([refs[2]]);
    expect(result.evicted).toEqual([refs[0], refs[1]]);
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

  it("resolves a well-formed executor recall marker to a carried artifact ref", () => {
    expect(resolveMemoryRecallRequest("Need fuller context.\n[memory recall abc123def456]", carriedRefs)).toBe(
      carriedRefs[0],
    );
    expect(resolveMemoryRecallRequest("[memory recall fedcba654321xyz987]", carriedRefs)).toBe(carriedRefs[1]);
  });

  it("returns null when executor text contains no recall marker", () => {
    expect(resolveMemoryRecallRequest("No external memory needed for this step.", carriedRefs)).toBeNull();
  });

  it("returns null when the recall marker names an unknown pointer id", () => {
    expect(resolveMemoryRecallRequest("[memory recall 000000000000]", carriedRefs)).toBeNull();
  });

  it("returns null for malformed executor recall markers", () => {
    expect(resolveMemoryRecallRequest("[memory recall]", carriedRefs)).toBeNull();
    expect(resolveMemoryRecallRequest("[memory recall abc123def456 extra]", carriedRefs)).toBeNull();
    expect(resolveMemoryRecallRequest("memory recall abc123def456", carriedRefs)).toBeNull();
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
