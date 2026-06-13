import { describe, expect, test } from "vitest";

import {
  desktopPayloadFor,
  slackPayloadFor,
} from "../../src/runner/notification-delivery.js";

describe("slackPayloadFor (WP-208)", () => {
  test("formats escalation notifications", () => {
    expect(
      slackPayloadFor({
        trigger: "escalate",
        atStep: 1,
        message: "ESCALATE at step 1: needs human",
      }),
    ).toEqual({ text: "🚨 ESCALATE at step 1: needs human" });
  });

  test("formats milestone notifications", () => {
    expect(
      slackPayloadFor({
        trigger: "milestone",
        atStep: 2,
        message: "milestone PROCEED at step 2",
      }),
    ).toEqual({ text: "✅ milestone PROCEED at step 2" });
  });

  test("formats terminal notifications", () => {
    expect(
      slackPayloadFor({
        trigger: "terminal",
        atStep: null,
        message: "terminal: SUCCESS",
      }),
    ).toEqual({ text: "🏁 terminal: SUCCESS" });
  });
});

describe("desktopPayloadFor (WP-208)", () => {
  test("formats escalation notifications", () => {
    expect(
      desktopPayloadFor({
        trigger: "escalate",
        atStep: 1,
        message: "ESCALATE at step 1: needs human",
      }),
    ).toEqual({
      title: "🚨 Escalation",
      body: "ESCALATE at step 1: needs human",
    });
  });

  test("formats milestone notifications", () => {
    expect(
      desktopPayloadFor({
        trigger: "milestone",
        atStep: 2,
        message: "milestone PROCEED at step 2",
      }),
    ).toEqual({
      title: "✅ Milestone",
      body: "milestone PROCEED at step 2",
    });
  });

  test("formats terminal notifications", () => {
    expect(
      desktopPayloadFor({
        trigger: "terminal",
        atStep: null,
        message: "terminal: SUCCESS",
      }),
    ).toEqual({
      title: "🏁 Run finished",
      body: "terminal: SUCCESS",
    });
  });
});
