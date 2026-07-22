import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { isRunnable, parseAuthoredTask, validateAuthoredTask } from "../src/task.js";

const TASKS_DIR = join(import.meta.dirname, "..", "..", "tasks");

const VALID_PINNED = `
id: brownfield-004
class: brownfield
status: pinned
repo:
  url: https://github.com/example/app
  ref: 0123456789abcdef0123456789abcdef01234567
horizon: 4-8h
goal: |
  Upgrade the dep.
requirements:
  - id: R1
    description: lockfile at target major
    check: grep -q dep-at-5 package-lock.json
  - id: R2
    description: suite green
    check: npm test
    prerequisites: [R1]
`;

describe("authored task format v1 (WP-301 freeze)", () => {
  it("loads every real task in benchmarks/tasks/", () => {
    const files = readdirSync(TASKS_DIR).filter((f) => f.endsWith(".yaml"));
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const file of files) {
      const { task, issues } = validateAuthoredTask(readFileSync(join(TASKS_DIR, file), "utf8"), file);
      expect(issues, `${file}: ${issues.join("; ")}`).toEqual([]);
      expect(task!.status).toBe("pinned");
      expect(isRunnable(task!)).toBe(true);
    }
  });

  it("accepts a pinned task with sha ref and executable checks", () => {
    const task = parseAuthoredTask(VALID_PINNED, "test.yaml");
    expect(isRunnable(task)).toBe(true);
    expect(task.requirements[1]!.prerequisites).toEqual(["R1"]);
    expect(task.repo).toEqual({
      url: "https://github.com/example/app",
      ref: "0123456789abcdef0123456789abcdef01234567",
    });
  });

  it("rejects a pinned task with TBD check or short ref", () => {
    const bad = VALID_PINNED.replace("check: npm test", "check: TBD").replace(
      "0123456789abcdef0123456789abcdef01234567",
      "main",
    );
    const { task, issues } = validateAuthoredTask(bad, "bad.yaml");
    expect(task).toBeUndefined();
    expect(issues.join("\n")).toMatch(/check TBD/);
    expect(issues.join("\n")).toMatch(/40-hex commit sha/);
  });

  it("rejects id/class mismatch, unknown prerequisite, and cycles", () => {
    const mismatch = VALID_PINNED.replace("class: brownfield", "class: greenfield");
    expect(validateAuthoredTask(mismatch, "m.yaml").issues.join()).toMatch(/does not match class/);

    const unknownDep = VALID_PINNED.replace("prerequisites: [R1]", "prerequisites: [R9]");
    expect(validateAuthoredTask(unknownDep, "u.yaml").issues.join()).toMatch(/unknown prerequisite/);

    const cycle = VALID_PINNED.replace(
      "  - id: R1\n    description: lockfile at target major\n    check: grep -q dep-at-5 package-lock.json",
      '  - id: R1\n    description: lockfile at target major\n    check: "true"\n    prerequisites: [R2]',
    );
    expect(validateAuthoredTask(cycle, "c.yaml").issues.join()).toMatch(/cycle/);
  });

  it("rejects a brownfield task without a repo block", () => {
    const noRepo = VALID_PINNED.replace(/repo:\n.*\n.*\n/, "");
    expect(validateAuthoredTask(noRepo, "r.yaml").issues.join()).toMatch(/requires repo/);
  });
});
