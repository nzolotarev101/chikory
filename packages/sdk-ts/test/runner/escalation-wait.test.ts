import { describe, expect, test } from "vitest";

import {
  decideEscalationWait,
  type EscalationWaitState,
} from "../../src/workflow/escalation-wait.js";
import type { UnattendedPolicy } from "../../src/types.js";

describe("decideEscalationWait", () => {
  test("no policy waits for approval and preserves the default ESCALATE path", () => {
    expect(decideEscalationWait({ source: "judge", reason: "needs human" })).toEqual({
      action: "await_approval",
      status: "AWAITING_APPROVAL",
    });
  });

  test("explicit await_approval policy still waits for approval", () => {
    expect(
      decideEscalationWait(
        { source: "runner", reason: "executor FAILED 3 consecutive steps" },
        { escalation: "await_approval" },
      ),
    ).toEqual({
      action: "await_approval",
      status: "AWAITING_APPROVAL",
    });
  });

  test("opt-in unattended policy seals judge ESCALATE as a resumable FAILED state", () => {
    expect(
      decideEscalationWait(
        { source: "judge", reason: "chunk scope is ambiguous" },
        { escalation: "seal_resumable_failed" },
      ),
    ).toEqual({
      action: "seal_resumable_failed",
      status: "FAILED",
      failureReason: "unattended judge escalation — chunk scope is ambiguous",
    });
  });

  test("opt-in unattended policy seals runner ESCALATE as a resumable FAILED state", () => {
    expect(
      decideEscalationWait(
        { source: "runner", reason: "executor FAILED 3 consecutive steps" },
        { escalation: "seal_resumable_failed" },
      ),
    ).toEqual({
      action: "seal_resumable_failed",
      status: "FAILED",
      failureReason: "unattended runner escalation — executor FAILED 3 consecutive steps",
    });
  });

  test("normalizes blank reasons and remains total", () => {
    expect(
      decideEscalationWait(
        { source: "judge", reason: "  " },
        { escalation: "seal_resumable_failed" },
      ),
    ).toEqual({
      action: "seal_resumable_failed",
      status: "FAILED",
      failureReason: "unattended judge escalation — unspecified escalation",
    });
  });

  test("does not mutate its inputs", () => {
    const state: EscalationWaitState = { source: "runner", reason: "stuck" };
    const policy: UnattendedPolicy = { escalation: "seal_resumable_failed" };
    const originalState = { ...state };
    const originalPolicy = { ...policy };

    decideEscalationWait(state, policy);

    expect(state).toEqual(originalState);
    expect(policy).toEqual(originalPolicy);
  });
});
