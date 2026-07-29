/**
 * The gate-repair tier (WP-542/F-207, ADR-009 D1) — the bounded heal tier for
 * artifacts a gate rejects before any durable execution exists. Both halves are
 * pure, so these tests need no router, no Temporal, and no fixtures: the
 * decision is arithmetic over a state, and the brief is a deterministic string.
 *
 * The properties under test are the ones that keep a repair loop from becoming
 * either a dead end (the F-207 defect) or a runaway cost sink (CG-1).
 */
import { describe, expect, it } from "vitest";

import {
  buildGateRepairBrief,
  decideGateRepair,
  gateRepairCostCap,
  GATE_REPAIR_BRIEF_MAX_CHARS,
  GATE_REPAIR_COST_SHARE,
  MAX_GATE_REPAIR_ATTEMPTS,
} from "../../src/heal/gate-repair.js";

const BOUNDS = { maxAttempts: MAX_GATE_REPAIR_ATTEMPTS, costCapUsd: 8 };

describe("decideGateRepair (WP-542, ADR-009 D1)", () => {
  it("grants the first repair attempt for a repairable failure", () => {
    const decision = decideGateRepair(
      { attemptsUsed: 0, costUsdSpent: 0.05, repairable: true },
      BOUNDS,
    );

    expect(decision).toEqual({ action: "repair", attempt: 1 });
  });

  it("counts attempts up to the bound and then stops", () => {
    for (let used = 0; used < MAX_GATE_REPAIR_ATTEMPTS; used += 1) {
      expect(
        decideGateRepair({ attemptsUsed: used, costUsdSpent: 0, repairable: true }, BOUNDS),
      ).toEqual({ action: "repair", attempt: used + 1 });
    }

    const exhausted = decideGateRepair(
      { attemptsUsed: MAX_GATE_REPAIR_ATTEMPTS, costUsdSpent: 0, repairable: true },
      BOUNDS,
    );

    expect(exhausted.action).toBe("stop");
    if (exhausted.action === "stop") {
      expect(exhausted.reason).toContain("repair budget exhausted");
    }
  });

  it("never repairs an unrepairable class, however much budget is left", () => {
    const decision = decideGateRepair(
      { attemptsUsed: 0, costUsdSpent: 0, repairable: false },
      BOUNDS,
    );

    expect(decision).toEqual({ action: "stop", reason: "failure class is not repairable" });
  });

  it("stops on the cost cap before the attempt budget runs out", () => {
    const decision = decideGateRepair(
      { attemptsUsed: 1, costUsdSpent: 8.5, repairable: true },
      BOUNDS,
    );

    expect(decision.action).toBe("stop");
    if (decision.action === "stop") {
      expect(decision.reason).toContain("repair cost cap reached");
      expect(decision.reason).toContain("8.5000");
    }
  });

  it("treats a zero cost cap as no cost stop", () => {
    const decision = decideGateRepair(
      { attemptsUsed: 0, costUsdSpent: 999, repairable: true },
      { maxAttempts: 3, costCapUsd: 0 },
    );

    expect(decision).toEqual({ action: "repair", attempt: 1 });
  });

  it("stops immediately when repair is disabled (0 attempts)", () => {
    const decision = decideGateRepair(
      { attemptsUsed: 0, costUsdSpent: 0, repairable: true },
      { maxAttempts: 0, costCapUsd: 8 },
    );

    expect(decision).toEqual({ action: "stop", reason: "repair is disabled (0 attempts)" });
  });
});

describe("gateRepairCostCap (WP-542)", () => {
  it("caps the loop at its share of the artifact's own budget", () => {
    expect(gateRepairCostCap(80)).toBeCloseTo(80 * GATE_REPAIR_COST_SHARE);
  });

  it("returns 0 (no cost stop) for a budget of 0", () => {
    expect(gateRepairCostCap(0)).toBe(0);
  });
});

describe("buildGateRepairBrief (WP-542)", () => {
  const INPUT = {
    gate: "plan meta-judge gate",
    attempt: 2,
    maxAttempts: 3,
    machineGaps: ["mandated goal literal `summary.json` appears in no node goal"],
    rationale: "the   decomposition\n is close but N-2 omits the lint step",
    instruction: "Fix every machine-checked defect above.",
    priorOutline: ["N-1: build the comparison CLI", "N-2 (after N-1): author brownfield-004"],
  };

  it("leads with the machine-checked defects, not the prose", () => {
    const brief = buildGateRepairBrief(INPUT);
    const gapsAt = brief.indexOf("Machine-checked defects");
    const rationaleAt = brief.indexOf("Gate rationale");

    expect(gapsAt).toBeGreaterThan(-1);
    expect(rationaleAt).toBeGreaterThan(gapsAt);
    expect(brief).toContain("`summary.json`");
  });

  it("names the attempt budget so the retry knows what is at stake", () => {
    expect(buildGateRepairBrief(INPUT)).toContain("repair attempt 2 of 3");
  });

  it("carries the rejected outline so the retry revises instead of re-rolling", () => {
    const brief = buildGateRepairBrief(INPUT);

    expect(brief).toContain("do not start over");
    expect(brief).toContain("N-2 (after N-1): author brownfield-004");
  });

  it("collapses rationale whitespace and is byte-identical for identical input", () => {
    const brief = buildGateRepairBrief(INPUT);

    expect(brief).toContain("the decomposition is close but N-2 omits the lint step");
    expect(buildGateRepairBrief(INPUT)).toBe(brief);
  });

  it("omits empty sections rather than emitting empty headers", () => {
    const brief = buildGateRepairBrief({
      gate: "plan meta-judge gate",
      attempt: 1,
      maxAttempts: 3,
      machineGaps: [],
      instruction: "Emit the plan again.",
    });

    expect(brief).not.toContain("Machine-checked defects");
    expect(brief).not.toContain("Gate rationale");
    expect(brief).not.toContain("do not start over");
    expect(brief).toContain("Emit the plan again.");
  });

  it("clamps a huge brief so it cannot rot the next prompt (CM-3)", () => {
    const brief = buildGateRepairBrief({
      ...INPUT,
      machineGaps: Array.from({ length: 400 }, (_, i) => `gap number ${i} with padding text`),
    });

    expect(brief.length).toBe(GATE_REPAIR_BRIEF_MAX_CHARS);
    expect(brief.endsWith("…")).toBe(true);
  });
});
