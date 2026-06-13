import { describe, expect, test } from "vitest";

import { notificationsFor } from "../../src/runner/notifications.js";
import type { JournalEntry } from "../../src/types.js";

describe("notificationsFor (WP-208)", () => {
  const entries: JournalEntry[] = [
    {
      idx: 0,
      ts: "2026-06-13T12:00:00.000Z",
      kind: "step",
      payload: {},
      costDeltaUsd: 0,
      artifactRefs: [],
    },
    {
      idx: 1,
      ts: "2026-06-13T12:01:00.000Z",
      kind: "verdict",
      payload: {
        atStep: 1,
        verdict: { kind: "ESCALATE", escalateReason: "needs human" },
      },
      costDeltaUsd: 0,
      artifactRefs: [],
    },
    {
      idx: 2,
      ts: "2026-06-13T12:02:00.000Z",
      kind: "verdict",
      payload: {
        atStep: 2,
        verdict: { kind: "PROCEED" },
      },
      costDeltaUsd: 0,
      artifactRefs: [],
    },
    {
      idx: 3,
      ts: "2026-06-13T12:03:00.000Z",
      kind: "terminal",
      payload: { status: "SUCCESS" },
      costDeltaUsd: 0,
      artifactRefs: [],
    },
  ];

  test("derives escalate, milestone, and terminal notifications in journal order", () => {
    expect(
      notificationsFor(entries, {
        on: ["escalate", "milestone", "terminal"],
      }),
    ).toEqual([
      {
        trigger: "escalate",
        atStep: 1,
        message: "ESCALATE at step 1: needs human",
      },
      {
        trigger: "milestone",
        atStep: 2,
        message: "milestone PROCEED at step 2",
      },
      {
        trigger: "terminal",
        atStep: null,
        message: "terminal: SUCCESS",
      },
    ]);
  });

  test("filters notifications according to policy", () => {
    expect(notificationsFor(entries, { on: ["terminal"] })).toEqual([
      {
        trigger: "terminal",
        atStep: null,
        message: "terminal: SUCCESS",
      },
    ]);
  });
});
