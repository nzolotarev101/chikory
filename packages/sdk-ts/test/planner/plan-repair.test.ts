/**
 * Plan-time repair binding (WP-542/F-207) — classification of every plan-phase
 * rejection into repairable-or-not, and the brief built from the evidence the
 * gate already computed.
 *
 * The classification boundary is the safety-critical half: repairing a config
 * error or a substantive ESCALATE would defeat the gate instead of healing it,
 * so those two must stay unrepairable no matter how much budget is left.
 */
import { describe, expect, it } from "vitest";

import {
  buildPlanRepairBrief,
  describeRepairTarget,
  familyDiversityFailure,
  gateFailure,
  minNodesFailure,
  planOutline,
  plannerTransportFailure,
  writeSetFailure,
} from "../../src/planner/plan-repair.js";
import type { Plan, PlanVerdict } from "../../src/types.js";

const PLAN: Plan = {
  id: "plan-1",
  // The goal's backtick literals are the mandated ones the floor checks for.
  goal: "Ship the corpus with `status: pinned` and write `summary.json`",
  nodes: [
    {
      id: "N-1",
      goal: "author the tasks as `status: pinned`",
      acceptanceCriteria: [{ id: "AC-1", description: "tasks load", check: "node -e 'require(1)'" }],
      dependsOn: [],
      writeSet: ["tasks.yaml"],
      budgetUsd: 10,
    },
    {
      id: "N-2",
      goal: "publish the bundle",
      acceptanceCriteria: [{ id: "AC-2", description: "bundle lands", check: "test -f bundle.json" }],
      dependsOn: ["N-1"],
      writeSet: ["bundle.json"],
      budgetUsd: 10,
    },
  ],
  createdAt: "2026-07-28T00:00:00.000Z",
};

const revise = (rationale: string, uncovered: string[] = []): PlanVerdict => ({
  kind: "REVISE",
  rationale,
  uncoveredCriteria: uncovered,
});

describe("plan-phase failure classification (WP-542/F-207)", () => {
  it("treats a planner transport failure as repairable with no brief evidence", () => {
    const failure = plannerTransportFailure(
      "planner LLM call failed after 5 attempts: transport error: aborted due to timeout",
    );

    expect(failure).toMatchObject({ kind: "planner-transport", phase: "plan", repairable: true });
    expect(failure.machineGaps).toEqual([]);
    expect(failure.message).toContain("aborted due to timeout");
  });

  it("treats an unserializable write-set topology as repairable, quoting the error", () => {
    const failure = writeSetFailure("node N-2 declares no writeSet");

    expect(failure).toMatchObject({ kind: "write-set", phase: "plan", repairable: true });
    expect(failure.machineGaps[0]).toContain("node N-2 declares no writeSet");
    expect(failure.instruction).toContain("dependsOn");
  });

  it("turns the min_nodes shortfall into a countable gap and keeps the WP-509 message", () => {
    const failure = minNodesFailure(1, 3);

    expect(failure).toMatchObject({ kind: "min-nodes", phase: "plan", repairable: true });
    expect(failure.message).toContain("planner under-decomposed: 1 node(s) < min_nodes 3");
    expect(failure.machineGaps).toEqual(["the plan has 1 node(s); at least 3 are required"]);
    expect(failure.instruction).toContain("at least 3 nodes");
  });

  it("NEVER repairs a same-family plan-judge — it is a config error (invariant #2)", () => {
    const failure = familyDiversityFailure("plan-judge shares the planner family");

    expect(failure).toMatchObject({ kind: "family-diversity", repairable: false });
  });

  it("NEVER repairs a substantive ESCALATE — that verdict means a human decides", () => {
    const verdict: PlanVerdict = {
      kind: "ESCALATE",
      rationale: "the goal contradicts itself",
      uncoveredCriteria: [],
    };

    const failure = gateFailure(verdict, PLAN);

    expect(failure).toMatchObject({ kind: "gate-escalate", repairable: false });
  });

  it("repairs an unreachable meta-judge by re-asking, with no plan critique", () => {
    const verdict: PlanVerdict = {
      kind: "ESCALATE",
      rationale: "plan meta-judge LLM call failed after 5 attempts: transport error: fetch failed",
      uncoveredCriteria: [],
    };

    const failure = gateFailure(verdict, PLAN);

    expect(failure).toMatchObject({ kind: "gate-infra", repairable: true });
    // The gate said nothing about the plan, so there is nothing to revise.
    expect(failure.machineGaps).toEqual([]);
  });

  it("repairs a REVISE, harvesting the coverage and literal floors' own findings", () => {
    const failure = gateFailure(revise("N-2 omits the lint step", ["AC-3"]), PLAN);

    expect(failure).toMatchObject({ kind: "gate-revise", repairable: true });
    expect(failure.machineGaps).toEqual([
      expect.stringContaining("`AC-3`"),
      // `summary.json` is mandated by the plan goal and survives in no node goal.
      expect.stringContaining("`summary.json`"),
    ]);
    // `status: pinned` DOES survive in N-1, so it must not be reported as a gap.
    expect(failure.machineGaps.join(" ")).not.toContain("status: pinned");
  });
});

describe("buildPlanRepairBrief / planOutline (WP-542)", () => {
  it("renders the machine gaps, the rationale, and the rejected outline", () => {
    const failure = gateFailure(revise("N-2 omits the lint step", ["AC-3"]), PLAN);

    const brief = buildPlanRepairBrief({
      failure,
      attempt: 1,
      maxAttempts: 3,
      priorPlan: PLAN,
    });

    expect(brief).toContain("plan meta-judge gate");
    expect(brief).toContain("`AC-3`");
    expect(brief).toContain("`summary.json`");
    expect(brief).toContain("N-2 omits the lint step");
    expect(brief).toContain("N-2 (after N-1): publish the bundle");
  });

  it("omits the outline when no plan was produced (a transport failure)", () => {
    const brief = buildPlanRepairBrief({
      failure: plannerTransportFailure("transport error: timeout"),
      attempt: 1,
      maxAttempts: 3,
    });

    expect(brief).not.toContain("do not start over");
    expect(brief).toContain("Emit the plan again.");
  });

  it("renders the outline with dependency order, which is what the gate judges", () => {
    expect(planOutline(PLAN)).toEqual([
      "N-1: author the tasks as `status: pinned`",
      "N-2 (after N-1): publish the bundle",
    ]);
  });
});

describe("describeRepairTarget (WP-542)", () => {
  it("prefers the machine-checked defects — the actionable half", () => {
    const failure = gateFailure(revise("prose", ["AC-3"]), PLAN);

    expect(describeRepairTarget(failure)).toContain("`AC-3`");
  });

  it("falls back to the message, collapsed, when there are no gaps", () => {
    expect(
      describeRepairTarget(plannerTransportFailure("transport   error:\n timeout")),
    ).toBe("transport error: timeout");
  });
});
