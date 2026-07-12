import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseDevAITask } from "../src/devai.js";

const FIXTURE = readFileSync(join(import.meta.dirname, "fixtures", "devai-01.json"), "utf8");

describe("DevAI instance loader", () => {
  it("maps the upstream shape to the unified BenchmarkTask", () => {
    const task = parseDevAITask(FIXTURE, "devai-01.json");
    expect(task.id).toBe("01_Image_Classification_ResNet18_Fashion_MNIST_DL");
    expect(task.source).toBe("devai");
    expect(task.class).toBe("greenfield");
    expect(task.status).toBe("pinned"); // DevAI originals are runnable as-is
    expect(task.requirements).toHaveLength(5);
    // requirement DAG: R3 depends on R0..R2 upstream
    const r3 = task.requirements.find((r) => r.id === "R3")!;
    expect(r3.prerequisites).toEqual(["R0", "R1", "R2"]);
    expect(r3.grading.kind).toBe("judge");
    expect(task.preferences.map((p) => p.id)).toEqual(["P0", "P1", "P2"]);
    expect(task.flags["is_training_needed"]).toBe(true);
    expect(task.flags["is_kaggle_api_needed"]).toBe(false);
  });

  it("rejects malformed JSON and missing fields", () => {
    expect(() => parseDevAITask("not json", "x.json")).toThrow(/JSON parse error/);
    expect(() => parseDevAITask("{}", "x.json")).toThrow(/name/);
    expect(() => parseDevAITask(JSON.stringify({ name: "t", query: "q", requirements: [] }), "x.json")).toThrow(
      /requirements/,
    );
  });
});
