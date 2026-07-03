import { describe, expect, it } from "vitest";

import {
  ARCHIVAL_MEMORY_TIER,
  CORE_MEMORY_TIER,
  DEFAULT_CORE_MEMORY_MAX_ENTRIES,
  TieredMemory,
  recall,
} from "../../src/memory/index.js";

function writeFromSource(sourceRef: string): { readonly provenance: { readonly sourceRef: string } } {
  return { provenance: { sourceRef } };
}

function writeFromOrigin(origin: string): { readonly provenance: { readonly origin: string } } {
  return { provenance: { origin } };
}

describe("TieredMemory", () => {
  it("stores and retrieves typed CORE records", () => {
    interface Value {
      readonly role: "executor" | "judge";
      readonly content: string;
    }

    const memory = new TieredMemory<Value>();
    const record = memory.put(
      "step-1",
      {
        role: "executor",
        content: "created patch",
      },
      writeFromSource("step:executor-1"),
    );

    expect(record).toEqual({
      id: "step-1",
      tier: CORE_MEMORY_TIER,
      value: { role: "executor", content: "created patch" },
      provenance: { sourceRef: "step:executor-1" },
      sequence: 0,
      updatedSequence: 0,
    });
    expect(memory.get("step-1")).toEqual(record);
  });

  it("stores writes with origin provenance", () => {
    const memory = new TieredMemory<string>();

    expect(memory.put("run-note", "created by runner", writeFromOrigin("runner"))).toEqual({
      id: "run-note",
      tier: CORE_MEMORY_TIER,
      value: "created by runner",
      provenance: { origin: "runner" },
      sequence: 0,
      updatedSequence: 0,
    });
  });

  it("lists records in deterministic insertion order", () => {
    const memory = new TieredMemory<string>();

    memory.put("a", "first", writeFromSource("step:a"));
    memory.put("b", "second", writeFromSource("step:b"));
    memory.put("c", "third", writeFromSource("step:c"));

    expect(memory.list().map((record) => record.id)).toEqual(["a", "b", "c"]);
  });

  it("updates an existing record without changing its list position", () => {
    const memory = new TieredMemory<string>();

    memory.put("a", "first", writeFromSource("step:a"));
    memory.put("b", "second", writeFromSource("step:b"));
    const updated = memory.put("a", "updated", writeFromSource("step:a-update"));

    expect(updated).toEqual({
      id: "a",
      tier: CORE_MEMORY_TIER,
      value: "updated",
      provenance: { sourceRef: "step:a-update" },
      sequence: 0,
      updatedSequence: 2,
    });
    expect(memory.list().map((record) => [record.id, record.value])).toEqual([
      ["a", "updated"],
      ["b", "second"],
    ]);
  });

  it("spills the oldest core record into archival memory when the configured bound is exceeded", () => {
    const memory = new TieredMemory<string>({ maxEntries: 2 });

    memory.put("a", "first", writeFromSource("step:a"));
    memory.put("b", "second", writeFromSource("step:b"));
    memory.put("c", "third", writeFromSource("step:c"));

    expect(memory.get("a")).toBeUndefined();
    expect(memory.list().map((record) => record.id)).toEqual(["b", "c"]);
    expect(memory.listArchival()).toEqual([
      {
        id: "a",
        tier: ARCHIVAL_MEMORY_TIER,
        value: "first",
        provenance: { sourceRef: "step:a" },
        sequence: 0,
        updatedSequence: 0,
      },
    ]);
  });

  it("keeps archival records append-only across repeated overflows", () => {
    const memory = new TieredMemory<string>({ maxEntries: 1 });

    memory.put("a", "first", writeFromSource("step:a"));
    memory.put("b", "second", writeFromSource("step:b"));
    memory.put("a", "third", writeFromSource("step:a-again"));
    memory.put("c", "fourth", writeFromSource("step:c"));

    expect(memory.list()).toEqual([
      {
        id: "c",
        tier: CORE_MEMORY_TIER,
        value: "fourth",
        provenance: { sourceRef: "step:c" },
        sequence: 3,
        updatedSequence: 3,
      },
    ]);
    expect(memory.listArchival()).toEqual([
      {
        id: "a",
        tier: ARCHIVAL_MEMORY_TIER,
        value: "first",
        provenance: { sourceRef: "step:a" },
        sequence: 0,
        updatedSequence: 0,
      },
      {
        id: "b",
        tier: ARCHIVAL_MEMORY_TIER,
        value: "second",
        provenance: { sourceRef: "step:b" },
        sequence: 1,
        updatedSequence: 1,
      },
      {
        id: "a",
        tier: ARCHIVAL_MEMORY_TIER,
        value: "third",
        provenance: { sourceRef: "step:a-again" },
        sequence: 2,
        updatedSequence: 2,
      },
    ]);
    expect(memory.getArchival("a").map((record) => record.value)).toEqual(["first", "third"]);
  });

  it("recalls best matches across core and archival memory", () => {
    const memory = new TieredMemory<string>({ maxEntries: 2 });

    memory.put("step-1", "executor patched tiered memory recall", writeFromSource("node:recall-1"));
    memory.put("step-2", "judge checked router invariants", writeFromSource("node:recall-2"));
    memory.put("step-3", "executor wrote recall recall tests", writeFromSource("node:recall-3"));

    expect(memory.recall({ text: "recall" })).toEqual([
      {
        id: "step-3",
        tier: CORE_MEMORY_TIER,
        value: "executor wrote recall recall tests",
        provenance: { sourceRef: "node:recall-3" },
        sequence: 2,
        updatedSequence: 2,
      },
      {
        id: "step-1",
        tier: ARCHIVAL_MEMORY_TIER,
        value: "executor patched tiered memory recall",
        provenance: { sourceRef: "node:recall-1" },
        sequence: 0,
        updatedSequence: 0,
      },
    ]);
  });

  it("recalls matches in most-recent order across core and archival memory", () => {
    const memory = new TieredMemory<string>({ maxEntries: 2 });

    memory.put("step-1", "recall from archived setup", writeFromSource("node:recent-1"));
    memory.put("step-2", "no match here", writeFromSource("node:recent-2"));
    memory.put("step-3", "recall from core followup", writeFromSource("node:recent-3"));

    expect(memory.recall({ text: "recall", order: "most-recent" }).map((record) => record.id)).toEqual([
      "step-3",
      "step-1",
    ]);
  });

  it("limits recall results and supports explicit searchable text", () => {
    interface Value {
      readonly title: string;
      readonly notes: string;
    }

    const memory = new TieredMemory<Value>({ maxEntries: 2 });

    memory.put("a", { title: "router", notes: "first recall candidate" }, writeFromSource("step:a"));
    memory.put(
      "b",
      { title: "recall", notes: "not searchable through title extractor" },
      writeFromSource("step:b"),
    );
    memory.put("c", { title: "router", notes: "second recall candidate" }, writeFromSource("step:c"));

    expect(
      memory.recall({
        text: "router",
        limit: 1,
        toText: (record) => record.value.title,
      }),
    ).toEqual([
      {
        id: "c",
        tier: CORE_MEMORY_TIER,
        value: { title: "router", notes: "second recall candidate" },
        provenance: { sourceRef: "step:c" },
        sequence: 2,
        updatedSequence: 2,
      },
    ]);
  });

  it("exposes recall as a pure memory primitive", () => {
    expect(
      recall(
        [
          {
            id: "archived",
            tier: ARCHIVAL_MEMORY_TIER,
            value: "durable recall history",
            provenance: { sourceRef: "step:archived" },
            sequence: 0,
            updatedSequence: 0,
          },
          {
            id: "core",
            tier: CORE_MEMORY_TIER,
            value: "current recall history",
            provenance: { origin: "runner" },
            sequence: 1,
            updatedSequence: 1,
          },
        ],
        { text: "current recall" },
      ),
    ).toEqual([
      {
        id: "core",
        tier: CORE_MEMORY_TIER,
        value: "current recall history",
        provenance: { origin: "runner" },
        sequence: 1,
        updatedSequence: 1,
      },
      {
        id: "archived",
        tier: ARCHIVAL_MEMORY_TIER,
        value: "durable recall history",
        provenance: { sourceRef: "step:archived" },
        sequence: 0,
        updatedSequence: 0,
      },
    ]);
  });

  it("uses a bounded default capacity", () => {
    const memory = new TieredMemory<number>();

    expect(memory.maxEntries).toBe(DEFAULT_CORE_MEMORY_MAX_ENTRIES);
  });

  it("rejects invalid ids", () => {
    const memory = new TieredMemory<string>();

    expect(() => memory.put("", "value", writeFromSource("step:a"))).toThrow(TypeError);
    expect(() => memory.get("   ")).toThrow(TypeError);
    expect(() => memory.recall({ text: "" })).toThrow(TypeError);
  });

  it("rejects writes without provenance", () => {
    const memory = new TieredMemory<string>();

    // @ts-expect-error provenance is required for every memory write.
    expect(() => memory.put("a", "value")).toThrow(TypeError);
    expect(() => memory.put("b", "value", { provenance: { sourceRef: "   " } })).toThrow(TypeError);
    expect(() => memory.put("c", "value", { provenance: { origin: "" } })).toThrow(TypeError);
  });

  it("rejects invalid capacities", () => {
    expect(() => new TieredMemory<string>({ maxEntries: 0 })).toThrow(RangeError);
    expect(() => new TieredMemory<string>({ maxEntries: 1.5 })).toThrow(RangeError);
  });

  it("returns record copies so callers cannot mutate stored metadata", () => {
    const memory = new TieredMemory<string>();
    const record = memory.put("a", "first", writeFromSource("step:a"));

    Object.assign(record, { id: "changed", provenance: { sourceRef: "changed" }, sequence: 99 });

    expect(memory.get("a")).toEqual({
      id: "a",
      tier: CORE_MEMORY_TIER,
      value: "first",
      provenance: { sourceRef: "step:a" },
      sequence: 0,
      updatedSequence: 0,
    });
  });

  it("returns archival record copies so callers cannot mutate stored metadata", () => {
    const memory = new TieredMemory<string>({ maxEntries: 1 });

    memory.put("a", "first", writeFromSource("step:a"));
    memory.put("b", "second", writeFromSource("step:b"));

    const [record] = memory.listArchival();
    if (record === undefined) {
      throw new Error("Expected an archival record");
    }
    Object.assign(record, { id: "changed", provenance: { sourceRef: "changed" }, sequence: 99 });

    expect(memory.listArchival()).toEqual([
      {
        id: "a",
        tier: ARCHIVAL_MEMORY_TIER,
        value: "first",
        provenance: { sourceRef: "step:a" },
        sequence: 0,
        updatedSequence: 0,
      },
    ]);
  });

  it("returns recall record copies so callers cannot mutate stored metadata", () => {
    const memory = new TieredMemory<string>();

    memory.put("a", "first recall", writeFromSource("step:a"));

    const [record] = memory.recall({ text: "recall" });
    if (record === undefined) {
      throw new Error("Expected a recall record");
    }
    Object.assign(record, { id: "changed", provenance: { sourceRef: "changed" }, sequence: 99 });

    expect(memory.recall({ text: "recall" })).toEqual([
      {
        id: "a",
        tier: CORE_MEMORY_TIER,
        value: "first recall",
        provenance: { sourceRef: "step:a" },
        sequence: 0,
        updatedSequence: 0,
      },
    ]);
  });
});
