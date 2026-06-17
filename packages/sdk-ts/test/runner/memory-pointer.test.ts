import { describe, expect, it } from "vitest";

import {
  formatPointerReference,
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
});
