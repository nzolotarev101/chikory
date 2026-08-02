import { describe, expect, it } from "vitest";

import { DEFAULT_AGENT_CLASSES, type MemberCooldown } from "../../src/agents/classes.js";
import { selectAgentPair } from "../../src/agents/select.js";

const NOW_MS = Date.parse("2026-08-02T12:00:00.000Z");

const EXECUTORS = DEFAULT_AGENT_CLASSES.classes["executor-default"]!;
const JUDGES = DEFAULT_AGENT_CLASSES.classes["judge-default"]!;

function cooled(memberId: string, untilMs: number): MemberCooldown {
  return {
    memberId,
    reason: "limit",
    observedAtMs: NOW_MS,
    cooldownUntilMs: untilMs,
  };
}

function select(cooldowns: readonly MemberCooldown[], allowSameFamily?: boolean) {
  return selectAgentPair({
    executorClass: EXECUTORS,
    judgeClass: JUDGES,
    cooldowns,
    nowMs: NOW_MS,
    ...(allowSameFamily === undefined ? {} : { allowSameFamily }),
  });
}

describe("selectAgentPair", () => {
  it("picks both primaries when nothing is on cooldown", () => {
    const result = select([]);

    expect(result.action).toBe("selected");
    if (result.action !== "selected") return;
    expect(result.pair.executor.id).toBe("gemini-3-6-flash");
    expect(result.pair.judge.id).toBe("gpt-5-6-sol");
    expect(result.blocked).toEqual([]);
  });

  it("rotates the judge in lockstep when the executor moves into the judge's vendor", () => {
    // The primary executor is walled, so the next member is codex (openai) —
    // which collides with the primary judge gpt-5.6-sol (also openai). The
    // judge must move too, or invariant #2 breaks silently.
    const result = select([cooled("gemini-3-6-flash", NOW_MS + 60_000)]);

    expect(result.action).toBe("selected");
    if (result.action !== "selected") return;
    expect(result.pair.executor.id).toBe("gpt-5-6-terra");
    expect(result.pair.executor.backend).toBe("openai");
    expect(result.pair.judge.id).toBe("opus-5");
    expect(result.pair.judge.backend).toBe("anthropic");
    expect(result.blocked).toContainEqual({
      memberId: "gpt-5-6-sol",
      role: "judge",
      reason: "same-backend-as-executor",
    });
  });

  it("returns the judge to its primary once the executor no longer collides", () => {
    const result = select([
      cooled("gemini-3-6-flash", NOW_MS + 60_000),
      cooled("gpt-5-6-terra", NOW_MS + 60_000),
    ]);

    expect(result.action).toBe("selected");
    if (result.action !== "selected") return;
    expect(result.pair.executor.id).toBe("sonnet-5");
    // anthropic executor vs openai judge — no collision, so the declared
    // default judge is used rather than a needless rotation.
    expect(result.pair.judge.id).toBe("gpt-5-6-sol");
  });

  it("rotates only the judge when the judge alone is walled", () => {
    const result = select([cooled("gpt-5-6-sol", NOW_MS + 60_000)]);

    expect(result.action).toBe("selected");
    if (result.action !== "selected") return;
    expect(result.pair.executor.id).toBe("gemini-3-6-flash");
    expect(result.pair.judge.id).toBe("opus-5");
  });

  it("skips a judge whose backend matches, then the next, before giving up on an executor", () => {
    // codex executor: gpt-5.6-sol collides (openai), opus-5 is walled, so the
    // only survivor is the gemini judge.
    const result = select([
      cooled("gemini-3-6-flash", NOW_MS + 60_000),
      cooled("opus-5", NOW_MS + 60_000),
    ]);

    expect(result.action).toBe("selected");
    if (result.action !== "selected") return;
    expect(result.pair.executor.id).toBe("gpt-5-6-terra");
    expect(result.pair.judge.id).toBe("gemini-3-1-pro");
  });

  it("parks until the EARLIEST expiry when every executor is walled", () => {
    const result = select([
      cooled("gemini-3-6-flash", NOW_MS + 9_000),
      cooled("gpt-5-6-terra", NOW_MS + 3_000),
      cooled("sonnet-5", NOW_MS + 5_000),
    ]);

    expect(result.action).toBe("park-until-reset");
    if (result.action !== "park-until-reset") return;
    expect(result.reason).toBe("no-legal-pair");
    // Parking to the LATEST would sleep 9s when work becomes possible at 3s.
    expect(result.retryAtMs).toBe(NOW_MS + 3_000);
  });

  it("parks when every judge is walled, even with a healthy executor", () => {
    const result = select([
      cooled("gpt-5-6-sol", NOW_MS + 7_000),
      cooled("opus-5", NOW_MS + 4_000),
      cooled("gemini-3-1-pro", NOW_MS + 8_000),
    ]);

    expect(result.action).toBe("park-until-reset");
    if (result.action !== "park-until-reset") return;
    expect(result.retryAtMs).toBe(NOW_MS + 4_000);
  });

  it("ignores a cooldown that has already expired", () => {
    const result = select([
      cooled("gemini-3-6-flash", NOW_MS),
      cooled("gpt-5-6-sol", NOW_MS - 1),
    ]);

    expect(result.action).toBe("selected");
    if (result.action !== "selected") return;
    expect(result.pair.executor.id).toBe("gemini-3-6-flash");
    expect(result.pair.judge.id).toBe("gpt-5-6-sol");
  });

  it("honours the LATEST expiry when a member was cooled more than once", () => {
    const result = select([
      cooled("gemini-3-6-flash", NOW_MS + 1_000),
      cooled("gemini-3-6-flash", NOW_MS + 50_000),
      cooled("gpt-5-6-terra", NOW_MS + 2_000),
      cooled("sonnet-5", NOW_MS + 2_000),
    ]);

    // A stale short cooldown must not resurrect a member the later wall re-cooled.
    expect(result.action).toBe("park-until-reset");
    if (result.action !== "park-until-reset") return;
    expect(result.retryAtMs).toBe(NOW_MS + 2_000);
    expect(result.blocked).toContainEqual({
      memberId: "gemini-3-6-flash",
      role: "executor",
      reason: "cooldown",
      cooldownUntilMs: NOW_MS + 50_000,
    });
  });

  it("keeps a same-backend judge under the explicit allow_same_family opt-in", () => {
    const result = select([cooled("gemini-3-6-flash", NOW_MS + 60_000)], true);

    expect(result.action).toBe("selected");
    if (result.action !== "selected") return;
    expect(result.pair.executor.id).toBe("gpt-5-6-terra");
    expect(result.pair.judge.id).toBe("gpt-5-6-sol");
    expect(result.pair.judge.backend).toBe(result.pair.executor.backend);
  });

  it("parks with no retry time when the block is a backend collision, not a wall", () => {
    // A one-member executor class and a one-member judge class on the same
    // vendor can never pair, and no cooldown will ever change that — parking
    // on a timer would be a lie, so there is no retry time to report.
    const result = selectAgentPair({
      executorClass: {
        id: "solo-exec",
        role: "executor",
        primary: {
          id: "solo-codex",
          role: "executor",
          adapter: "codex",
          family: "openai",
          backend: "openai",
          model: "gpt-5.6-terra",
        },
        adjacent: [],
      },
      judgeClass: {
        id: "solo-judge",
        role: "judge",
        primary: {
          id: "solo-sol",
          role: "judge",
          transport: "openai-compat",
          backend: "openai",
          model: "gpt-5.6-sol xhigh",
        },
        adjacent: [],
      },
      cooldowns: [],
      nowMs: NOW_MS,
    });

    expect(result.action).toBe("park-until-reset");
    if (result.action !== "park-until-reset") return;
    expect(result.retryAtMs).toBeUndefined();
    expect(result.blocked).toEqual([
      { memberId: "solo-sol", role: "judge", reason: "same-backend-as-executor" },
    ]);
  });
});
