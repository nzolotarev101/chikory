import { describe, expect, it } from "vitest";

import type { TaskSpec } from "../../src/types.js";
import {
  CONTEXT_WINDOW_TABLE,
  lookupContextWindow,
  resolveContextWindowForSpec,
} from "../../src/runner/context-window.js";

describe("context-window lookup (WP-252)", () => {
  it("resolves exact model families", () => {
    expect(lookupContextWindow("gpt-5.5")).toBe(400_000);
    expect(lookupContextWindow("claude-opus-4-8")).toBe(200_000);
    expect(lookupContextWindow("gemini-3.1-pro-preview")).toBe(1_000_000);
  });

  it("resolves dated snapshot ids by longest prefix", () => {
    expect(lookupContextWindow("gpt-5.5-2026-06-01")).toBe(400_000);
  });

  it("returns fallback values for unknown models", () => {
    expect(lookupContextWindow("mystery-model", 123_456)).toBe(123_456);
    expect(lookupContextWindow("mystery-model")).toBe(200_000);
  });

  it("exports the static context-window table", () => {
    expect(CONTEXT_WINDOW_TABLE["gpt-5.5"]).toBe(400_000);
  });

  it("resolves the executor code-stage model from a task spec", () => {
    const spec = {
      routing: { stages: { code: { model: "gpt-5.5" } } },
    } as TaskSpec;

    expect(resolveContextWindowForSpec(spec, 200_000)).toBe(400_000);
  });

  it("returns the resolver fallback for unknown or empty code-stage models", () => {
    const unknownModelSpec = {
      routing: { stages: { code: { model: "mystery-model" } } },
    } as TaskSpec;
    const emptyModelSpec = {
      routing: { stages: { code: { model: "" } } },
    } as TaskSpec;

    expect(resolveContextWindowForSpec(unknownModelSpec, 123_456)).toBe(123_456);
    expect(resolveContextWindowForSpec(emptyModelSpec, 123_456)).toBe(123_456);
  });
});
