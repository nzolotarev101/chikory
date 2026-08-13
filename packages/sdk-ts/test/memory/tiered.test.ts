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

  it("supports maxEntries = 1 as the minimum capacity and evicts immediately on subsequent puts", () => {
    const memory = new TieredMemory<string>({ maxEntries: 1 });

    memory.put("a", "first", writeFromSource("step:a"));
    expect(memory.list().map((r) => r.id)).toEqual(["a"]);
    expect(memory.listArchival()).toEqual([]);

    memory.put("b", "second", writeFromSource("step:b"));
    expect(memory.list().map((r) => r.id)).toEqual(["b"]);
    expect(memory.listArchival().map((r) => r.id)).toEqual(["a"]);
  });

  it("retains exactly maxEntries in core and spills the rest to archival when adding many items in a loop", () => {
    const maxEntries = 10;
    const memory = new TieredMemory<number>({ maxEntries });

    for (let i = 0; i < 100; i++) {
      memory.put(`id-${i}`, i, writeFromSource(`step:${i}`));
    }

    const coreList = memory.list();
    expect(coreList).toHaveLength(maxEntries);
    expect(coreList.map((r) => r.id)).toEqual(
      Array.from({ length: maxEntries }, (_, i) => `id-${100 - maxEntries + i}`),
    );

    const archivalList = memory.listArchival();
    expect(archivalList).toHaveLength(100 - maxEntries);
    expect(archivalList.map((r) => r.id)).toEqual(
      Array.from({ length: 100 - maxEntries }, (_, i) => `id-${i}`),
    );

    for (const record of coreList) {
      expect(record.tier).toBe(CORE_MEMORY_TIER);
    }
    for (const record of archivalList) {
      expect(record.tier).toBe(ARCHIVAL_MEMORY_TIER);
    }
  });

  it("rejects non-integer, negative, or invalid type maxEntries options", () => {
    // @ts-expect-error maxEntries must be a number
    expect(() => new TieredMemory<string>({ maxEntries: "ten" })).toThrow(RangeError);
    expect(() => new TieredMemory<string>({ maxEntries: -5 })).toThrow(RangeError);
    expect(() => new TieredMemory<string>({ maxEntries: NaN })).toThrow(RangeError);
    expect(() => new TieredMemory<string>({ maxEntries: 1.5 })).toThrow(RangeError);
  });

  it("rejects whitespace-only ids", () => {
    const memory = new TieredMemory<string>();
    expect(() => memory.put("   ", "value", writeFromSource("step:a"))).toThrow(TypeError);
    expect(() => memory.get("   ")).toThrow(TypeError);
    expect(() => memory.getArchival("   ")).toThrow(TypeError);
  });

  it("rejects invalid recall queries and limits", () => {
    const memory = new TieredMemory<string>();
    // limit less than 0
    expect(() => memory.recall({ text: "test", limit: -1 })).toThrow(RangeError);
    // limit non-integer
    expect(() => memory.recall({ text: "test", limit: 2.5 })).toThrow(RangeError);
  });

  it("supports both sourceRef and origin in provenance simultaneously", () => {
    const memory = new TieredMemory<string>();
    const record = memory.put("a", "value", {
      provenance: { sourceRef: "step:a", origin: "runner" },
    });
    expect(record.provenance).toEqual({ sourceRef: "step:a", origin: "runner" });
  });

  it("resolves equal score query matches by falling back to most-recent sequence order in best-match mode", () => {
    const memory = new TieredMemory<string>();

    memory.put("r1", "same score search text", writeFromSource("step:r1"));
    memory.put("r2", "same score search text", writeFromSource("step:r2"));

    const recalled = memory.recall({ text: "search" });
    expect(recalled).toHaveLength(2);
    // "r2" is more recent than "r1", so it must come first despite identical match scores
    expect(recalled[0]?.id).toBe("r2");
    expect(recalled[1]?.id).toBe("r1");
  });

  it("handles various value types, including circular references, bigints, and booleans during stringification", () => {
    const memory = new TieredMemory<unknown>();

    const circularObj: Record<string, unknown> = { tag: "circular" };
    circularObj.self = circularObj;

    memory.put("r-circular", circularObj, writeFromSource("step:circular"));
    memory.put("r-bigint", 98765432109876543210n, writeFromSource("step:bigint"));
    memory.put("r-boolean", true, writeFromSource("step:boolean"));
    memory.put("r-null", null, writeFromSource("step:null"));
    memory.put("r-undefined", undefined, writeFromSource("step:undefined"));

    // Circular reference should catch JSON.stringify error and fallback to String() -> "[object Object]"
    expect(memory.recall({ text: "[object Object]" }).map((r) => r.id)).toContain("r-circular");
    // BigInt serialization check
    expect(memory.recall({ text: "98765432109876543210" }).map((r) => r.id)).toContain("r-bigint");
    // Boolean serialization check
    expect(memory.recall({ text: "true" }).map((r) => r.id)).toContain("r-boolean");
    // Null serialization check
    expect(memory.recall({ text: "null" }).map((r) => r.id)).toContain("r-null");
    // Undefined serialization check
    expect(memory.recall({ text: "undefined" }).map((r) => r.id)).toContain("r-undefined");
  });

  it("returns an empty array when getArchival is called for an ID with no archival entries", () => {
    const memory = new TieredMemory<string>();
    memory.put("a", "value", writeFromSource("step:a"));
    expect(memory.getArchival("a")).toEqual([]);
    expect(memory.getArchival("non-existent")).toEqual([]);
  });

  it("handles recall query limits and non-matching searches correctly", () => {
    const memory = new TieredMemory<string>();
    memory.put("a", "hello world", writeFromSource("step:a"));
    memory.put("b", "hello world 2", writeFromSource("step:b"));

    // limit = 0 should return empty list
    expect(memory.recall({ text: "hello", limit: 0 })).toEqual([]);
    // limit larger than matching records should return all matches
    expect(memory.recall({ text: "hello", limit: 10 })).toHaveLength(2);
    // non-matching queries should return empty list
    expect(memory.recall({ text: "non-existent" })).toEqual([]);
  });
});
