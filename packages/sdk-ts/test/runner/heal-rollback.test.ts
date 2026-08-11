import { describe, expect, it } from "vitest";
import { decideHealRollback } from "../../src/workflow/heal-rollback.js";

describe("decideHealRollback (WP-605)", () => {
  const CP = "checkpoint@123";

  it("keeps work on uncondemned verdict under operator_reject trigger", () => {
    const decision = decideHealRollback({
      trigger: "operator_reject",
      criteriaAllPass: true,
      destructiveRubricFailed: false,
      lastGoodCheckpointId: CP,
    });
    expect(decision).toEqual({ action: "keep" });
  });

  it("keeps work on uncondemned verdict under halt trigger", () => {
    const decision = decideHealRollback({
      trigger: "halt",
      criteriaAllPass: true,
      destructiveRubricFailed: false,
      lastGoodCheckpointId: CP,
    });
    expect(decision).toEqual({ action: "keep" });
  });

  it("rolls back to checkpoint on failing criteria under operator_reject trigger", () => {
    const decision = decideHealRollback({
      trigger: "operator_reject",
      criteriaAllPass: false,
      destructiveRubricFailed: false,
      lastGoodCheckpointId: CP,
    });
    expect(decision).toEqual({ action: "rollback", checkpointId: CP });
  });

  it("rolls back to checkpoint on failing criteria under halt trigger", () => {
    const decision = decideHealRollback({
      trigger: "halt",
      criteriaAllPass: false,
      destructiveRubricFailed: false,
      lastGoodCheckpointId: CP,
    });
    expect(decision).toEqual({ action: "rollback", checkpointId: CP });
  });

  it("rolls back on destructive rubric failure even if criteria all pass", () => {
    const decision = decideHealRollback({
      trigger: "operator_reject",
      criteriaAllPass: true,
      destructiveRubricFailed: true,
      lastGoodCheckpointId: CP,
    });
    expect(decision).toEqual({ action: "rollback", checkpointId: CP });
  });

  it("keeps work if lastGoodCheckpointId is undefined regardless of condemnation", () => {
    const decisionCondemned = decideHealRollback({
      trigger: "halt",
      criteriaAllPass: false,
      destructiveRubricFailed: false,
    });
    expect(decisionCondemned).toEqual({ action: "keep" });

    const decisionUncondemned = decideHealRollback({
      trigger: "operator_reject",
      criteriaAllPass: true,
      destructiveRubricFailed: false,
    });
    expect(decisionUncondemned).toEqual({ action: "keep" });
  });

  it("is pure and deterministic", () => {
    const input = {
      trigger: "operator_reject",
      criteriaAllPass: true,
      destructiveRubricFailed: false,
      lastGoodCheckpointId: CP,
    };
    const res1 = decideHealRollback(input);
    const res2 = decideHealRollback(input);
    expect(res1).toEqual(res2);
  });
});
