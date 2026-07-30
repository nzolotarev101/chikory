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
  classifyGapProgress,
  decideGateRepair,
  gateRepairCostCap,
  returnedGaps,
  GATE_REPAIR_BRIEF_MAX_CHARS,
  GATE_REPAIR_COST_SHARE,
  MAX_GATE_REPAIR_ATTEMPTS,
} from "../../src/heal/gate-repair.js";
import {
  DOGFOOD_120_PLAN_OUTLINE,
  DOGFOOD_120_REVISE_GAPS,
  DOGFOOD_120_REVISE_RATIONALE,
} from "../fixtures/dogfood-120-plan.js";

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

/**
 * F-226 — dogfood-121's real gap trail. The gate rejected attempt 2 for
 * `devbox run`, attempt 3 fixed it and lost `benchmarks/`, attempt 4 fixed that
 * and lost `devbox run` AGAIN. Three attempts and $0.62 with no convergence.
 */
const LITERAL_GAP = (literal: string): string =>
  `mandated goal literal \`${literal}\` appears in no node goal — copy it verbatim ` +
  `into the goal of the node that owns it`;

const DOGFOOD_121_TRAIL = [
  ["AC-1 is only nominally attached to N-3/N-4"],
  [LITERAL_GAP("rawResultsDir"), LITERAL_GAP("devbox run")],
  [LITERAL_GAP("benchmarks/")],
  [LITERAL_GAP("any"), LITERAL_GAP("devbox run")],
];

describe("classifyGapProgress (F-226)", () => {
  it("calls the first attempt shrinking — there is nothing to compare it to", () => {
    expect(classifyGapProgress([], ["a"])).toBe("shrinking");
  });

  it("calls a strictly smaller defect set shrinking", () => {
    expect(classifyGapProgress([["a", "b"]], ["a"])).toBe("shrinking");
  });

  it("calls an unchanged defect set stalled, and still repairs it", () => {
    expect(classifyGapProgress([["a", "b"]], ["b", "a"])).toBe("stalled");
    expect(
      decideGateRepair(
        { attemptsUsed: 1, costUsdSpent: 0, repairable: true, gapHistory: [["a"]], machineGaps: ["a"] },
        BOUNDS,
      ),
    ).toEqual({ action: "repair", attempt: 2 });
  });

  it("calls a defect that returns after being satisfied oscillating", () => {
    expect(classifyGapProgress([["a"], ["b"]], ["a"])).toBe("oscillating");
    expect(returnedGaps([["a"], ["b"]], ["a"])).toEqual(["a"]);
  });

  it("reproduces dogfood-121's trail: convergent until `devbox run` comes back", () => {
    expect(classifyGapProgress(DOGFOOD_121_TRAIL.slice(0, 1), DOGFOOD_121_TRAIL[1]!)).toBe(
      "shrinking",
    );
    expect(classifyGapProgress(DOGFOOD_121_TRAIL.slice(0, 2), DOGFOOD_121_TRAIL[2]!)).toBe(
      "shrinking",
    );
    expect(classifyGapProgress(DOGFOOD_121_TRAIL.slice(0, 3), DOGFOOD_121_TRAIL[3]!)).toBe(
      "oscillating",
    );
  });

  it("stops the loop on the oscillation, naming the defect that came back", () => {
    const decision = decideGateRepair(
      {
        attemptsUsed: 1,
        costUsdSpent: 0.6,
        repairable: true,
        gapHistory: DOGFOOD_121_TRAIL.slice(0, 3),
        machineGaps: DOGFOOD_121_TRAIL[3]!,
      },
      BOUNDS,
    );

    expect(decision.action).toBe("stop");
    if (decision.action === "stop") {
      expect(decision.reason).toContain("repair is oscillating");
      expect(decision.reason).toContain("`devbox run`");
    }
  });

  it("keeps repairing when no gap history is supplied at all", () => {
    expect(
      decideGateRepair({ attemptsUsed: 1, costUsdSpent: 0, repairable: true }, BOUNDS),
    ).toEqual({ action: "repair", attempt: 2 });
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

  it("bounds a huge defect list so it cannot rot the next prompt (CM-3)", () => {
    const brief = buildGateRepairBrief({
      ...INPUT,
      machineGaps: Array.from({ length: 400 }, (_, i) => `gap number ${i} with padding text`),
    });

    expect(brief.length).toBeLessThanOrEqual(GATE_REPAIR_BRIEF_MAX_CHARS);
    expect(brief).toContain("more machine-checked defect(s)");
    // F-223: the cap must never be paid for out of the instruction.
    expect(brief).toContain(INPUT.instruction);
  });
});

/**
 * F-223 — the brief must survive its own budget on a REAL plan.
 *
 * dogfood-121's plan gate oscillated for three attempts and $0.62 because the
 * brief was clamped as one string with the instruction rendered last: dogfood-120's
 * six node goals total 3,798 characters, so the planner read the header, the gaps,
 * the rationale and one node of outline, and never reached "Keep the parts of your
 * plan it did not object to". It was structurally told to start over every time.
 */
describe("buildGateRepairBrief on dogfood-120's real 6-node plan (F-223)", () => {
  const INSTRUCTION =
    "Fix every machine-checked defect above and address the gate's rationale. Keep the " +
    "parts of your plan it did not object to — node ids, dependency order, and write sets " +
    "that were accepted should survive unchanged.";

  const REAL_INPUT = {
    gate: "plan meta-judge gate",
    attempt: 2,
    maxAttempts: 3,
    machineGaps: [...DOGFOOD_120_REVISE_GAPS],
    rationale: DOGFOOD_120_REVISE_RATIONALE,
    instruction: INSTRUCTION,
    priorOutline: [...DOGFOOD_120_PLAN_OUTLINE],
  };

  it("is the input that overflows: outline alone is larger than the old 2000-char cap", () => {
    expect(DOGFOOD_120_PLAN_OUTLINE.join("\n").length).toBeGreaterThan(3500);
  });

  it("keeps the whole instruction — the sentence that stops the retry re-rolling", () => {
    const brief = buildGateRepairBrief(REAL_INPUT);

    expect(brief).toContain(INSTRUCTION);
    expect(brief).toContain("What the next attempt must do");
  });

  it("keeps every node id, so the retry can revise the two nodes that were objected to", () => {
    const brief = buildGateRepairBrief(REAL_INPUT);

    for (const nodeId of ["N-1", "N-2", "N-3", "N-4", "N-5", "N-6"]) {
      expect(brief).toContain(`- ${nodeId}`);
    }
  });

  it("keeps every machine-checked defect verbatim", () => {
    const brief = buildGateRepairBrief(REAL_INPUT);

    for (const gap of DOGFOOD_120_REVISE_GAPS) expect(brief).toContain(gap);
  });

  it("stays inside the cap and spends the squeeze on outline detail, not the instruction", () => {
    const brief = buildGateRepairBrief(REAL_INPUT);

    expect(brief.length).toBeLessThanOrEqual(GATE_REPAIR_BRIEF_MAX_CHARS);
    // The outline was shortened per entry rather than dropped or tail-cut.
    expect(brief).toContain("…");
    expect(brief.endsWith(INSTRUCTION)).toBe(true);
  });

  it("drops the elastic sections rather than the instruction when nothing else fits", () => {
    const brief = buildGateRepairBrief({
      ...REAL_INPUT,
      instruction: "x".repeat(GATE_REPAIR_BRIEF_MAX_CHARS),
    });

    expect(brief).toContain("x".repeat(GATE_REPAIR_BRIEF_MAX_CHARS));
    expect(brief).not.toContain("do not start over");
  });
});
