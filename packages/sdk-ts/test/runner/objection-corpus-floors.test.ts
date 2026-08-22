/**
 * The repeat-objection comparator, driven against THIS campaign's own judge prose
 * (WP-644/WP-647). Reads `test/fixtures/objection-corpus.json` — 86 rows harvested
 * from 47 run journals — and pins the three numbers dogfood-165 was graded on, so
 * they live in the repo rather than only in that run's acceptance checks (F-356).
 *
 * The corpus is DATA, never an input to `areMateriallySameObjections` at runtime:
 * the comparator executes inside the Temporal workflow and reads no files.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { areMateriallySameObjections } from "../../src/workflow/completion-review.js";

interface CorpusRow {
  key: string;
  runId: string;
  rubricId: string;
  justification: string;
}
interface LabelledPair {
  a: string;
  b: string;
  why: string;
}

const corpus = JSON.parse(readFileSync("test/fixtures/objection-corpus.json", "utf8")) as {
  rows: CorpusRow[];
};
const labels = JSON.parse(readFileSync("test/fixtures/objection-labels.json", "utf8")) as {
  positives: LabelledPair[];
  hardNegatives: LabelledPair[];
};

const byKey = new Map(corpus.rows.map((r) => [r.key, r]));

function row(key: string): CorpusRow {
  const r = byKey.get(key);
  if (r === undefined) throw new Error(`key not in corpus: ${key}`);
  return r;
}

function same(a: CorpusRow, b: CorpusRow): boolean {
  return areMateriallySameObjections(
    { id: a.rubricId, justification: a.justification },
    { id: b.rubricId, justification: b.justification },
  );
}

/**
 * A branch run's journal REPLAYS its parent's judge passes, so a branch/parent
 * pair is one objection recorded twice, not a negative.
 */
function family(runId: string): string {
  const m = /^branch-run-([0-9a-f-]{36})-step-/.exec(runId);
  return m === null ? runId : `run-${m[1]}`;
}

describe("areMateriallySameObjections over the committed objection corpus", () => {
  it("recognises at least 6 of the 8 labelled restatements (measured floor, incumbent 4)", () => {
    const missed = labels.positives.filter((p) => !same(row(p.a), row(p.b)));
    expect(
      missed.map((p) => `${p.a}/${p.b} :: ${p.why}`),
      "recall floor 6/8 — these are real restatements this campaign's judge wrote",
    ).toSatisfy(() => missed.length <= 2);
  });

  it("merges none of the 3 same-run same-rubric-id negatives (collision population, F-432)", () => {
    const merged = labels.hardNegatives.filter((n) => same(row(n.a), row(n.b)));
    expect(
      merged.map((n) => `${n.a}/${n.b} :: ${n.why}`),
      "these share the rubric id with the positives; merging one silences a real second finding",
    ).toEqual([]);
  });

  it("keeps cross-family false positives at or under the 25-pair budget (1.67% of 1501)", () => {
    let pairs = 0;
    let falsePositives = 0;
    for (let i = 0; i < corpus.rows.length; i += 1) {
      for (let k = i + 1; k < corpus.rows.length; k += 1) {
        const a = corpus.rows[i]!;
        const b = corpus.rows[k]!;
        if (a.rubricId !== b.rubricId) continue;
        if (family(a.runId) === family(b.runId)) continue;
        pairs += 1;
        if (same(a, b)) falsePositives += 1;
      }
    }
    expect(pairs, "the negative population changed — re-measure the budget before moving it").toBe(1501);
    expect(
      `${falsePositives}/${pairs}`,
      "two objections from DIFFERENT run families are never the same objection; recall may not be " +
        "bought with soundness (dogfood-162 failed this WP at 44.06%)",
    ).toSatisfy(() => falsePositives <= 25);
  });

  it("decides a pair the dogfood-165 criteria never named, on the corpus rows themselves", () => {
    // run-f3d47cf8 restated one `publishableRepoPath` fallback complaint (8cbdc6ffdb60 ->
    // c7d2b3b72287); cc4c6bb4b88e faults the same symbol for a DIFFERENT defect (lost
    // collision handling) and must stay a separate objection.
    const restatedA = row("8cbdc6ffdb60");
    const restatedB = row("c7d2b3b72287");
    const differentDefect = row("cc4c6bb4b88e");

    expect(same(restatedA, restatedB)).toBe(true);
    expect(same(restatedB, restatedA)).toBe(true);
    expect(same(restatedA, differentDefect)).toBe(false);
    expect(same(differentDefect, restatedA)).toBe(false);
  });

  it("is symmetric and whitespace-invariant on every labelled pair", () => {
    for (const p of [...labels.positives, ...labels.hardNegatives]) {
      const a = row(p.a);
      const b = row(p.b);
      const forward = same(a, b);
      expect(same(b, a), `asymmetric on ${p.a}/${p.b}`).toBe(forward);

      const squash = (s: string): string => s.replace(/[ \t]+/g, "  ").replace(/\n/g, " \n ");
      expect(
        areMateriallySameObjections(
          { id: a.rubricId, justification: squash(a.justification) },
          { id: b.rubricId, justification: squash(b.justification) },
        ),
        `whitespace changed the verdict on ${p.a}/${p.b}`,
      ).toBe(forward);
    }
  });
});
