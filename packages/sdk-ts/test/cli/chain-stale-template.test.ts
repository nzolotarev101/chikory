/**
 * F-220 — a resume must not silently replay a template frozen before the fix.
 *
 * A chain's node template is captured in its journal at launch and replayed by
 * every later dispatch. dogfood-120 proves the cost: WP-544 taught
 * `templateFromSpec` to forward `step_limits` / `pacing` / `unattended`, the
 * operator resumed the chain 4 minutes after that landed, and the resumed node
 * STILL ran with `stepLimits: undefined` / `unattended: undefined` — so a judge
 * ESCALATE over a stray glyph in a markdown report parked it 3h47m waiting for a
 * human the spec had told it not to wait for.
 *
 * Driven against a real `ChainJournal` on disk with the ACTUAL persisted
 * template of `chain-0723ac0b-4eba-413a-933f-2d1646a4f643`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { renderStaleTemplateWarning, templateGaps } from "../../src/chain/node-spec.js";
import { ChainJournal } from "../../src/chain/store.js";
import { warnStaleTemplate } from "../../src/cli/chain.js";
import { chainJournalPath } from "../../src/runner/paths.js";
import type { Plan } from "../../src/types.js";

const CHAIN_ID = "chain-stale-template";

const PLAN: Plan = {
  id: "plan-stale",
  goal: "Ship a chained campaign",
  createdAt: "2026-07-29T04:10:28.766Z",
  nodes: [
    {
      id: "N-1",
      goal: "first",
      acceptanceCriteria: [{ id: "AC-1", description: "a", check: "true" }],
      dependsOn: [],
      budgetUsd: 5,
    },
  ],
};

/** Verbatim `template_json` of dogfood-120's chain, written pre-WP-544. */
const DOGFOOD_120_TEMPLATE = {
  repos: [{ url: "/Users/nikitazolotarev/repos/chikory", writable: true }],
  executor: { adapter: "gemini-cli", family: "gemini" },
  judge: { family: "openai-compat", cadence: 1, scoringMethod: "pointwise", maxCostShare: 0.5 },
  routing: {
    stages: {
      plan: { provider: "openai-compat", model: "gpt-5.6-sol xhigh" },
      code: { provider: "openai-compat", model: "default" },
      review: { provider: "openai-compat", model: "gpt-5.6-sol xhigh" },
      judge: { provider: "openai-compat", model: "gpt-5.6-sol xhigh" },
    },
  },
  maxSteps: 30,
};

const COMPLETE_TEMPLATE = {
  ...DOGFOOD_120_TEMPLATE,
  budgetTokens: 200_000,
  stepLimits: { maxSeconds: 840, maxTurns: 50 },
  pacing: { mode: "auto", autoCalibrate: true },
  unattended: { escalation: "seal_resumable_failed" },
  maxRejectStrikes: 2,
  soak: { minWallClockHours: 1 },
  notifications: { onEscalation: [] },
  horizon: { targetSteps: 30 },
  regressionSuite: "pnpm run test",
};

describe("templateGaps (F-220)", () => {
  it("names what dogfood-120's real frozen template is missing", () => {
    expect(templateGaps(DOGFOOD_120_TEMPLATE)).toEqual([
      "stepLimits",
      "pacing",
      "unattended",
      "maxRejectStrikes",
      "soak",
      "notifications",
      "horizon",
      "budgetTokens",
      "regressionSuite",
    ]);
  });

  it("is empty for a template carrying the whole execution surface", () => {
    expect(templateGaps(COMPLETE_TEMPLATE)).toEqual([]);
  });

  it("treats an absent or non-object template as all gaps", () => {
    expect(templateGaps(null)).toContain("unattended");
    expect(templateGaps("nonsense")).toContain("stepLimits");
  });
});

describe("renderStaleTemplateWarning", () => {
  it("says nothing when there is nothing to say", () => {
    expect(renderStaleTemplateWarning(CHAIN_ID, [])).toBeUndefined();
  });

  it("names the fields, the consequence, and the remedy", () => {
    const warning = renderStaleTemplateWarning(CHAIN_ID, templateGaps(DOGFOOD_120_TEMPLATE))!;
    expect(warning).toContain(CHAIN_ID);
    expect(warning).toContain("stepLimits");
    expect(warning).toContain("unattended");
    expect(warning).toContain("600s step cap");
    expect(warning).toContain("launch a fresh chain");
  });
});

describe("warnStaleTemplate over a real chain journal", () => {
  let dir: string;
  const lines: string[] = [];
  const ioPair = {
    out: (line: string) => lines.push(line),
    err: (line: string) => lines.push(line),
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "chikory-stale-template-"));
    lines.length = 0;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function seedChain(template: unknown): void {
    const journal = new ChainJournal(chainJournalPath(dir, CHAIN_ID));
    try {
      journal.createChain(CHAIN_ID, PLAN, template);
    } finally {
      journal.close();
    }
  }

  it("warns before re-entering a chain frozen without the execution surface", () => {
    seedChain(DOGFOOD_120_TEMPLATE);
    warnStaleTemplate(dir, CHAIN_ID, ioPair);
    expect(lines.join("\n")).toContain("unattended");
    expect(lines.join("\n")).toContain("F-209/F-220");
  });

  it("stays silent for a chain frozen with everything declared", () => {
    seedChain(COMPLETE_TEMPLATE);
    warnStaleTemplate(dir, CHAIN_ID, ioPair);
    expect(lines).toEqual([]);
  });

  it("stays silent for an unknown chain id — the resume path reports that itself", () => {
    warnStaleTemplate(dir, "chain-does-not-exist", ioPair);
    expect(lines).toEqual([]);
  });

  it("never rewrites the persisted template", () => {
    seedChain(DOGFOOD_120_TEMPLATE);
    warnStaleTemplate(dir, CHAIN_ID, ioPair);
    const journal = new ChainJournal(chainJournalPath(dir, CHAIN_ID));
    try {
      expect(JSON.parse(journal.getChain()!.template_json!)).toEqual(DOGFOOD_120_TEMPLATE);
    } finally {
      journal.close();
    }
  });
});
