/**
 * F-210 — the rule-3 stuck-criterion guard counts only live, substantive
 * verdicts.
 *
 * The centrepiece is a REPLAY of the real dogfood-120 `N-2` journal
 * (`chain-0723ac0b-4eba-413a-933f-2d1646a4f643-node-N-2`), whose four verdicts
 * are reproduced below exactly as they were written. On HEAD that trail
 * produces `HALT — criterion N2-AC-1 failed 3+ consecutive verdicts`, killing a
 * node that had spent $0.20 of a $15 budget and had been given exactly one
 * attempt informed by substantive feedback. Two of its three strikes were not
 * the executor's: one step was killed at its wall-clock cap, and one verdict
 * judged a diff the judge itself then reverted.
 *
 * The replay drives the REAL consumer — `criteriaHistoryFromJournal` over a
 * real `Journal` on disk, feeding the real `computeVerdict` — rather than the
 * helpers in isolation, because the defect lived in the wiring between them
 * (the F-198 lesson: own the oracle, then check the output's consumer).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Journal } from "../../src/journal/journal.js";
import { computeVerdict } from "../../src/judge/verdict.js";
import { criteriaHistoryFromJournal } from "../../src/runner/activities.js";
import {
  historyCutoffIdx,
  isInfraStepFailure,
  markInfraFailedPass,
} from "../../src/runner/strike-accounting.js";
import type { ArtifactRef, JudgeForm, StepRecord, TaskSpec } from "../../src/types.js";

const REF: ArtifactRef = { id: "a", kind: "diff", bytes: 0, summary: "" };

const AC = "N2-AC-1";

/** The one compound acceptance criterion `N-2` carried. */
function form(pass: boolean): JudgeForm {
  return {
    criterionResults: [{ id: AC, pass, justification: "no RED/GREEN execution evidence" }],
    rubricResults: [{ id: "tests_pass", pass: true, justification: "" }],
    concerns: [],
  };
}

function step(status: "SUCCESS" | "FAILED", failureReason?: string): StepRecord {
  return {
    status,
    diffRef: REF,
    summary: "s",
    toolCalls: 1,
    tokens: { input: 1, output: 1 },
    costUsd: 0,
    costEstimated: false,
    durationMs: 1,
    transcriptRef: REF,
    ...(failureReason !== undefined ? { failure: { reason: failureReason, retriable: true } } : {}),
  };
}

const SPEC: TaskSpec = {
  name: "n2",
  goal: "author brownfield-004",
  repos: [{ url: "/repo", writable: true }],
  acceptanceCriteria: [{ id: AC, description: "pinned, reviewed, RED and GREEN" }],
  budgetUsd: 15,
  executor: { adapter: "gemini-cli", family: "gemini" },
  judge: { family: "openai-compat", cadence: 1 },
  routing: { stages: {} } as TaskSpec["routing"],
};

/** The dogfood-120 `N-2` trail, in journal order. */
const REPLAY: Array<{ step: StepRecord; verdictKind: "PROCEED" | "ROLLBACK" | "HALT" }> = [
  // step 0 — killed at the 600s default cap the chain never overrode (F-209).
  { step: step("FAILED", "step exceeded maxSeconds=600; killed after 602.9s (1.00× cap)"), verdictKind: "PROCEED" },
  // step 1 — real work, reverted: `scope_matches_instruction` failed.
  { step: step("SUCCESS"), verdictKind: "ROLLBACK" },
  // step 2 — scope fixed, the first honest attempt at the criterion.
  { step: step("SUCCESS"), verdictKind: "HALT" },
];

describe("F-210 replay of the real dogfood-120 N-2 trail", () => {
  let dir: string;
  const runId = "chain-0723ac0b-node-N-2-replay";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "chikory-strikes-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /**
   * Write the trail up to (not including) the verdict under test, then compute
   * that verdict the way `judgeStep` does.
   */
  function verdictAtStep2() {
    const journal = new Journal(join(dir, "journal.db"));
    let history: Record<string, boolean[]>;
    let infra: boolean;
    try {
      journal.createRun(runId, SPEC);
      REPLAY.forEach((entry, stepIndex) => {
        journal.append({
          kind: "step",
          payload: { stepIndex, record: entry.step },
          costDeltaUsd: 0,
          artifactRefs: [],
        });
        if (stepIndex === REPLAY.length - 1) return; // the verdict under test
        journal.append({
          kind: "verdict",
          payload: {
            judgeIndex: stepIndex,
            atStep: stepIndex,
            verdict: {
              kind: entry.verdictKind,
              rationale: "",
              // `judgeStep` stamps this before journaling (F-210a).
              form: markInfraFailedPass(form(false), isInfraStepFailure(entry.step)),
              costUsd: 0,
              tokens: { input: 0, output: 0 },
              judgeModel: { provider: "openai-compat", model: "m" },
              runId,
              atStep: stepIndex,
            },
          },
          costDeltaUsd: 0,
          artifactRefs: [],
        });
      });
      history = criteriaHistoryFromJournal(journal);
      infra = isInfraStepFailure(REPLAY[2]!.step);
    } finally {
      journal.close();
    }
    return computeVerdict(markInfraFailedPass(form(false), infra), history);
  }

  it("does not HALT the node on strikes it never earned", () => {
    const verdict = verdictAtStep2();

    // On HEAD this was: HALT — criterion N2-AC-1 failed 3+ consecutive verdicts.
    expect(verdict.kind).not.toBe("HALT");
    expect(verdict.rationale).not.toContain("consecutive verdicts");
  });

  it("leaves exactly one live strike on the ledger — the one honest attempt", () => {
    const journal = new Journal(join(dir, "journal.db"));
    try {
      journal.createRun(runId, SPEC);
      // The full trail, verdicts included, as the run actually wrote it.
      REPLAY.forEach((entry, stepIndex) => {
        journal.append({
          kind: "step",
          payload: { stepIndex, record: entry.step },
          costDeltaUsd: 0,
          artifactRefs: [],
        });
        journal.append({
          kind: "verdict",
          payload: {
            judgeIndex: stepIndex,
            atStep: stepIndex,
            verdict: {
              kind: entry.verdictKind,
              rationale: "",
              form: markInfraFailedPass(form(false), isInfraStepFailure(entry.step)),
              costUsd: 0,
              tokens: { input: 0, output: 0 },
              judgeModel: { provider: "openai-compat", model: "m" },
              runId,
              atStep: stepIndex,
            },
          },
          costDeltaUsd: 0,
          artifactRefs: [],
        });
      });

      // step 0 → infra-flagged, step 1 → truncated by the ROLLBACK, step 2 → counted.
      expect(criteriaHistoryFromJournal(journal)[AC]).toEqual([false]);
    } finally {
      journal.close();
    }
  });
});

describe("isInfraStepFailure", () => {
  it("flags a step killed at its wall-clock cap", () => {
    expect(isInfraStepFailure(step("FAILED", "step exceeded maxSeconds=600; killed after 602.9s"))).toBe(true);
  });

  it("reads the explicit flag on journals written after WP-544", () => {
    expect(isInfraStepFailure({ ...step("FAILED", "anything"), infraFailed: true })).toBe(true);
  });

  it("does NOT flag a substantive failure — those still spend strikes", () => {
    expect(
      isInfraStepFailure(step("FAILED", "executor wrote OUTSIDE its workspace: the step diff is empty")),
    ).toBe(false);
  });

  it("does not flag a step that succeeded", () => {
    expect(isInfraStepFailure(step("SUCCESS"))).toBe(false);
  });
});

describe("markInfraFailedPass", () => {
  it("suppresses the STRIKE, never the finding", () => {
    const marked = markInfraFailedPass(form(false), true);

    // The criterion still fails — the executor still gets the feedback and the
    // run still cannot seal SUCCESS. Only the rule-3 sequence skips it.
    expect(marked.criterionResults[0]).toMatchObject({ id: AC, pass: false, infraFailed: true });
    expect(marked.rubricResults).toEqual(form(false).rubricResults);
  });

  it("is a no-op for a substantive pass", () => {
    expect(markInfraFailedPass(form(false), false)).toEqual(form(false));
  });
});

describe("historyCutoffIdx", () => {
  it("returns the LAST restore, not the first", () => {
    expect(
      historyCutoffIdx([
        { idx: 2, restoresWorkspace: true },
        { idx: 5, restoresWorkspace: false },
        { idx: 9, restoresWorkspace: true },
      ]),
    ).toBe(9);
  });

  it("returns -1 when nothing was ever restored, so all history counts", () => {
    expect(historyCutoffIdx([{ idx: 1, restoresWorkspace: false }])).toBe(-1);
  });
});
