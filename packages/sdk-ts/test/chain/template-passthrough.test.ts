/**
 * F-209 — a chain node must receive the execution surface the operator
 * declared.
 *
 * dogfood-120 set `step_limits.max_seconds: 840` and
 * `unattended.escalation: seal_resumable_failed` in its goal spec. Both were
 * parsed, both were validated, and neither reached a single node: the persisted
 * `N-2` spec carried `stepLimits: undefined`, `unattended: undefined`,
 * `pacing: undefined`. Step 0 was therefore killed at the 600s default
 * (`killed after 602.9s`) and `N-1` parked `AWAITING_APPROVAL` for a human the
 * spec had told it not to wait for.
 *
 * These tests assert the two halves of the guard: the classification covers
 * every `TaskSpec` field (so the next added field cannot go silent), and each
 * forwarded field actually lands on the child spec (F-198: never assert on a
 * decision without reading the write nobody else reads).
 */
import { describe, expect, it } from "vitest";

import {
  CHAIN_TEMPLATE_FIELDS,
  planNodeToTaskSpec,
  type ChainNodeTemplate,
} from "../../src/chain/node-spec.js";
import { TaskSpecSchema } from "../../src/schemas.js";
import type { PlanNode } from "../../src/types.js";

const NODE: PlanNode = {
  id: "N-2",
  goal: "author brownfield-004",
  acceptanceCriteria: [{ id: "N2-AC-1", description: "pinned, reviewed, RED and GREEN" }],
  dependsOn: [],
  budgetUsd: 15,
};

/** Every execution-surface policy dogfood-120 declared, plus the rest. */
const TEMPLATE: ChainNodeTemplate = {
  repos: [{ url: "/repo", writable: true }],
  executor: { adapter: "gemini-cli", family: "gemini" },
  judge: { family: "openai-compat", cadence: 1 },
  routing: {
    stages: {
      plan: { provider: "openai-compat", model: "m" },
      code: { provider: "gemini", model: "m" },
      review: { provider: "openai-compat", model: "m" },
      judge: { provider: "openai-compat", model: "m" },
    },
  },
  agentClasses: { executor: "executor-default", judge: "judge-default" },
  budgetTokens: 500_000,
  maxSteps: 30,
  stepLimits: { maxSeconds: 840, maxTurns: 50 },
  pacing: { mode: "auto", autoCalibrate: true },
  unattended: { escalation: "seal_resumable_failed" },
  soak: { sleepMs: 1000, maxReentries: 2 },
  notifications: { on: ["terminal"] },
  horizon: { expectedDurationMs: 3_600_000 },
};

describe("chain node template passthrough (F-209)", () => {
  it("classifies every TaskSpec field — a new field cannot be silently dropped", () => {
    const classified = new Set<string>([
      ...CHAIN_TEMPLATE_FIELDS.nodeOwned,
      ...CHAIN_TEMPLATE_FIELDS.templateForwarded,
      ...CHAIN_TEMPLATE_FIELDS.deliberatelyExcluded,
    ]);
    // `debug` is armed host-side per node, so it is absent from the parsed spec
    // schema; every OTHER TaskSpec field is a spec key.
    const specKeys = Object.keys(TaskSpecSchema.shape);

    expect(specKeys.filter((key) => !classified.has(key))).toEqual([]);
    // No stale classification either — the compile-time half of this guard
    // (`ChainTemplateFieldChecks`) covers the direction tsc can see.
    expect([...classified].filter((key) => key !== "debug" && !specKeys.includes(key))).toEqual([]);
  });

  it("forwards every template-owned field onto the child spec", () => {
    const spec = planNodeToTaskSpec(NODE, TEMPLATE, "plan-1");

    // The two that dogfood-120 lost, named explicitly so a regression reads
    // as the bug it is rather than as an anonymous key-count mismatch.
    expect(spec.stepLimits).toEqual({ maxSeconds: 840, maxTurns: 50 });
    expect(spec.unattended).toEqual({ escalation: "seal_resumable_failed" });
    // WP-571: the CLASS NAMES, not just the armed pair. Carry only the pair and
    // a chain freezes its agents at launch — only the first node could rotate
    // off a walled one, which is the whole failure this feature exists to fix.
    expect(spec.agentClasses).toEqual({
      executor: "executor-default",
      judge: "judge-default",
    });

    for (const field of CHAIN_TEMPLATE_FIELDS.templateForwarded) {
      expect(spec[field], `template field ${field} was dropped`).toEqual(
        TEMPLATE[field as keyof ChainNodeTemplate],
      );
    }
  });

  it("leaves node-owned fields to the plan node, not the template", () => {
    const spec = planNodeToTaskSpec(NODE, TEMPLATE, "plan-1", undefined, undefined, "chain-1");

    expect(spec.goal).toBe(NODE.goal);
    expect(spec.acceptanceCriteria).toEqual(NODE.acceptanceCriteria);
    expect(spec.budgetUsd).toBe(NODE.budgetUsd);
    expect(spec.chainLink).toMatchObject({ planId: "plan-1", nodeId: "N-2", chainId: "chain-1" });
  });

  it("omits an absent policy instead of writing undefined into the spec", () => {
    const bare: ChainNodeTemplate = {
      repos: TEMPLATE.repos,
      executor: TEMPLATE.executor,
      judge: TEMPLATE.judge,
      routing: TEMPLATE.routing,
    };

    const spec = planNodeToTaskSpec(NODE, bare, "plan-1");

    // `exactOptionalPropertyTypes` discipline: absent, not present-and-undefined.
    for (const field of CHAIN_TEMPLATE_FIELDS.templateForwarded) {
      if (bare[field as keyof ChainNodeTemplate] === undefined) {
        expect(Object.hasOwn(spec, field), `${field} should be absent`).toBe(false);
      }
    }
  });
});
