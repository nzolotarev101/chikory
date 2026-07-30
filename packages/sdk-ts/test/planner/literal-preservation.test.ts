import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  extractGoalLiterals,
  isMandatedLiteral,
  literalCarrier,
  mandatedGoalLiterals,
  planLiteralGaps,
} from "../../src/planner/literal-preservation.js";
import { parseTaskSpec } from "../../src/taskspec.js";
import type { AcceptanceCriterion, Plan } from "../../src/types.js";

function planWith(goal: string, nodeGoals: string[]): Plan {
  return {
    id: "plan-literals",
    goal,
    nodes: nodeGoals.map((nodeGoal, i) => ({
      id: `N-${i + 1}`,
      goal: nodeGoal,
      acceptanceCriteria: [],
      dependsOn: [],
      budgetUsd: 1,
    })),
    createdAt: "2026-06-30T00:00:00.000Z",
  };
}

function planWithCriteria(goal: string, nodeGoal: string, criteria: AcceptanceCriterion[]): Plan {
  const plan = planWith(goal, [nodeGoal]);
  return { ...plan, nodes: [{ ...plan.nodes[0]!, acceptanceCriteria: criteria }] };
}

describe("extractGoalLiterals", () => {
  it("deduplicates backtick literals in first-seen order", () => {
    expect(
      extractGoalLiterals("Preserve `parseWpStatus`, then `Plan`, then `parseWpStatus` again."),
    ).toEqual(["parseWpStatus", "Plan"]);
  });

  it("returns an empty list when the goal has no backtick literal", () => {
    expect(extractGoalLiterals("Ship the planner verifier without pinned literals.")).toEqual([]);
  });
});

/**
 * F-225 — the mandate must name deliverables, not prose.
 *
 * dogfood-121's plan gate spent $0.62 over three repair attempts on four
 * "missing" literals; three of them (`devbox run`, `any`, and a narrative id)
 * were never artifacts a node could own.
 */
describe("isMandatedLiteral (F-225)", () => {
  it("mandates repo artifacts: paths, identifiers, filenames, flags, assertions", () => {
    for (const literal of [
      "rawResultsDir",
      "benchmarks/",
      "benchmarks/reports/p3-rung-4/brownfield-004.md",
      "summary.json",
      "base_verification_command",
      "chikory-bench compare",
      ".is_fixed",
      "node_modules",
      "repo.ref",
      "status: pinned",
      "tasksVerified === tasks === 5",
      "parseWpStatus",
      "WP-25",
      "Plan",
    ]) {
      expect(isMandatedLiteral(literal), literal).toBe(true);
    }
  });

  it("exempts plain prose, elided fragments, and narrative ids", () => {
    for (const literal of [
      "any",
      "check",
      "command",
      "git",
      "npx",
      "devbox run",
      "docs/reports/…",
      "7ad4bd3",
      "chain-0723ac0b-4eba-413a-933f-2d1646a4f643",
      "",
    ]) {
      expect(isMandatedLiteral(literal), literal).toBe(false);
    }
  });
});

describe("mandatedGoalLiterals over the real dogfood-121 goal (F-225)", () => {
  const spec = parseTaskSpec(
    readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "examples",
        "dogfood",
        "dogfood-121-wp302-wp304-five-task-baseline-range.yaml",
      ),
      "utf8",
    ),
    { env: { OPENAI_COMPAT_BASE_URL: "http://unused.invalid" } },
  );

  it("still mandates every deliverable identifier the goal names", () => {
    const mandated = mandatedGoalLiterals(spec.goal);

    for (const literal of [
      "rawResultsDir",
      "benchmarks/",
      "summary.json",
      "base_verification_command",
      "unverifiedTasks",
    ]) {
      expect(mandated, literal).toContain(literal);
    }
  });

  it("drops the prose the gate actually halted on", () => {
    const mandated = mandatedGoalLiterals(spec.goal);

    for (const literal of ["any", "devbox run", "git", "npx", "check", "command"]) {
      expect(mandated, literal).not.toContain(literal);
    }
  });

  it("mandates strictly fewer literals than the goal backticks", () => {
    const all = extractGoalLiterals(spec.goal);
    const mandated = mandatedGoalLiterals(spec.goal);

    expect(all.length).toBeGreaterThan(mandated.length);
    expect(mandated.every((literal) => all.includes(literal))).toBe(true);
  });
});

describe("planLiteralGaps", () => {
  it("returns no gaps when all mandated literals are preserved by node goals", () => {
    const plan = planWith(
      "Preserve `parseWpStatus` and `assessSpecStaleness` in the decomposition.",
      [
        "Implement parseWpStatus from the plan table.",
        "Use assessSpecStaleness to report stale targets.",
      ],
    );

    expect(planLiteralGaps(plan)).toEqual([]);
  });

  it("returns a dropped mandated literal in goal order", () => {
    const plan = planWith("The node must keep `assessSpecStaleness` verbatim.", [
      "Implement stale-target detection without naming the required function.",
    ]);

    expect(planLiteralGaps(plan)).toEqual(["assessSpecStaleness"]);
  });

  it("enforces the dogfood-066 discriminator: WP-25 is not preserved by a WP-255-only node goal", () => {
    const plan = planWith("Keep `WP-25` grep-pinned for the exact-token check.", [
      "Implement the WP-255 cleanup only.",
    ]);

    expect(planLiteralGaps(plan)).toEqual(["WP-25"]);
  });

  it("requires exact token boundaries around mandated literals", () => {
    const plan = planWith("Keep `WP-25`, `F-49`, and `grep-pinned` intact.", [
      "Mention XWP-25, WP-25a, WP-25_extra, F-490, and grep-pinned-extra only.",
    ]);

    expect(planLiteralGaps(plan)).toEqual(["WP-25", "F-49", "grep-pinned"]);
  });

  it("is satisfied by a path UNDER a declared directory literal (F-224)", () => {
    const plan = planWith("Writes stay within `benchmarks/` and nowhere else.", [
      "Author the task under benchmarks/tasks/brownfield-004.yaml.",
    ]);

    expect(planLiteralGaps(plan)).toEqual([]);
  });

  it("is not satisfied by a different directory that merely starts the same way", () => {
    const plan = planWith("Writes stay within `benchmarks/` and nowhere else.", [
      "Author the task under benchmarksX/tasks/brownfield-004.yaml.",
    ]);

    expect(planLiteralGaps(plan)).toEqual(["benchmarks/"]);
  });

  it("counts a literal carried by a node's acceptance check, not just its goal (F-224)", () => {
    const plan = planWithCriteria(
      "Emit each arm's `rawResultsDir` in the comparison output.",
      "Generate the comparison bundle from both suite summaries.",
      [
        {
          id: "AC-4",
          description: "the publication reports each arm's raw results directory",
          check: 'node -e \'if(!r.arms.every((x)=>x.rawResultsDir))process.exit(1)\'',
        },
      ],
    );

    expect(planLiteralGaps(plan)).toEqual([]);
    expect(literalCarrier(plan, "rawResultsDir")).toBe("N-1");
  });

  it("keeps its F-64 teeth: a paraphrase with no criterion carrying it is still a gap", () => {
    const plan = planWithCriteria(
      "Emit each arm's `rawResultsDir` in the comparison output.",
      "Report the raw results directory for each arm.",
      [{ id: "AC-4", description: "the publication reports both arms", check: "true" }],
    );

    expect(planLiteralGaps(plan)).toEqual(["rawResultsDir"]);
    expect(literalCarrier(plan, "rawResultsDir")).toBeUndefined();
  });

  it("does not mutate the plan or its nodes", () => {
    const plan = planWith("Preserve `parseWpStatus` in one node.", [
      "Implement parseWpStatus exactly.",
    ]);
    const before = JSON.stringify(plan);

    expect(planLiteralGaps(plan)).toEqual([]);
    expect(JSON.stringify(plan)).toBe(before);
  });
});
