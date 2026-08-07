# dogfood-124 — interval-ranked leaderboard (WP-303)

**WP:** WP-303 (leaderboard and methodology) · **Date:** 2026-08-07 ·
**Spec:** `examples/dogfood/dogfood-124-wp303-leaderboard-interval-ranking.yaml` ·
**Run:** `run-80fe6b8f-5ceb-4089-b13b-195390bf682b` · **Landed:** this review's commit ·
**Ladder:** P3-rung-5 (WP-530 moat ladder) — **HALF CLIMBED** (leaderboard ✅, separating corpus ✗)

## Plain lead

The benchmark harness can now turn published result bundles into a ranked
leaderboard that sorts by the *bottom* of each arm's confidence range and refuses
to call a winner when two ranges overlap — and it published exactly that verdict
over the real head-to-head numbers: Chikory and raw Claude Code are **not
separated**. The run itself was clean (one step, four cents, both acceptance
checks green), but the artifact it published carried a source pointer that
resolves from nowhere — the same "the check proved the field exists, not that it
works" miss logged one review ago. Fixed on disk this sitting.

## Trace

| field | value |
|---|---|
| terminal | 🟢 SUCCESS · 1 step · 2m 18s |
| cost | **$0.0442** of $15.00 budget (0.3%) — judge share **100.0%** |
| executor | `gemini-cli` (gemini family) · 2,999 tokens metered (2.3k in / 692 out) · **$0.0000 UNPRICED** · 1m 40s · **0 tool calls** |
| judge | `openai-compat` / `gpt-5.6-sol xhigh` · 1 pass · $0.0442 · 35 s · 19,714 evidence bytes |
| verdict | ✓ PROCEED (2/2 criteria, 6/6 rubric) @ step 1 |
| checkpoint | `run-80fe6b8f…@5` · commit `f12120826ed0` · `lastGood: true` |
| rollbacks / escalations / resumes / injections | 0 / 0 / 0 / 0 |
| pacing | 1 event · peak window 75% · 0 compactions · 0 parks |
| diff | 6 files · +444 / −6 · 18,749 bytes |
| harvest | **byte-IDENTICAL 6/6** vs the run workspace |

**Family diversity real:** executor `gemini-cli` (gemini), judge `openai-compat`
(`gpt-5.6-sol`) — structurally different families, per the core constraint.

## Delivery quality (human review, post-landing)

**What landed** — exactly the surfaces the goal named, nothing else:

```
M benchmarks/harness/src/index.ts                        (+9)
A benchmarks/harness/src/leaderboard.ts                  (154 lines)
M benchmarks/harness/src/main.ts                         (+44 / −6)
A benchmarks/harness/test/leaderboard.test.ts            (141 lines)
A benchmarks/publications/leaderboard/leaderboard.json    (88 lines)
A benchmarks/publications/leaderboard/leaderboard.md      (14 lines)
```

**Independently verified ✅**

- **Trap A (rank by point estimate) rejected.** `leaderboard.ts:56` sorts on
  `b.iSrRange.low - a.iSrRange.low`; `orderedBy` is the literal `"iSrRange.low"`.
  Re-run against the spec's own synthetic geometry: `narrow` (90% point, floor
  0.8256) outranks `wide` (100% point, floor 0.5655). The wrong sort would have
  printed "Chikory 100% — 1st".
- **Trap B (winner from overlap) rejected.** `leaderboard.ts:65` sets `separated`
  only when the intervals are strictly disjoint (`A.high < B.low || B.high < A.low`),
  and `winner` is `null` otherwise. Touching endpoints count as *not* separated —
  conservative in the right direction. Reviewed the "who is higher" derivation by
  hand: since entries are pre-sorted by `low` descending, the disjoint case
  `A.high < B.low` is arithmetically impossible for `i < j`, so naming `armA` the
  higher arm is sound, not an accident.
- **Trap C (recompute rates) rejected.** Entries are spread from the bundle's
  `comparison.json`; nothing in the module divides `requirementsSatisfied` by
  anything. Published `iSr`/`dSr`/`iSrRange`/`dSrRange` are byte-equal to the source.
- **Trap D (build a website) rejected.** No HTML, no CSS, no generator, no
  dependency change. `package.json` untouched.
- **The published verdict is the honest one.** `benchmarks/publications/leaderboard/`
  ranks Chikory `[83.2%, 100.0%]` above raw Claude Code `[75.4%, 99.1%]` on the
  interval floor and states plainly: *"Overlap at 95% confidence; the arms are not
  separated (no winner)."* That is the NF-5 requirement (communicate figures in
  ranges) made executable rather than aspirational.
- **Scope discipline.** `git status --short` after harvest = the 6 files above.
  The one shared-code edit (`parseFlags` gains `multiValues`) is additive: `values`
  keeps last-wins semantics unchanged, so no existing command's behavior moves.
- **Suite.** 1,299 TS (23 skipped) · **186** harness (was 183; +3 from this
  review's fix) · 84 py — all green. Lint + format clean.

**Defect the run's own green did not catch** — see F-267 below.

## New friction

### 🟠 F-267 — the published leaderboard cited a source bundle that resolves from nowhere

`leaderboard.ts` stored the `--bundle` argument verbatim, so
`benchmarks/publications/leaderboard/leaderboard.json` published
`"bundle": "../publications/p3-rung-4"` — a path anchored to `benchmarks/harness/`,
the CWD that happened to run the command, and stated nowhere in the artifact.
Measured, not assumed:

| resolved from | path | exists |
|---|---|---|
| the artifact's own directory | `benchmarks/publications/publications/p3-rung-4` | ❌ |
| the repo root | `<parent-of-repo>/publications/p3-rung-4` | ❌ |
| `benchmarks/harness/` | `benchmarks/publications/p3-rung-4` | ✅ |

The same string was published in the `leaderboard.md` "Bundle" column. The
copied-through `reference` field had the identical defect
(`../results/p3-rung-4/chikory/summary.json`, resolvable only from
`benchmarks/harness/`) — inherited from the source bundle and carried into an
artifact in a different directory, where it is guaranteed dead.

**This is F-262 verbatim, one review later.** dogfood-123 logged "AC-2 proved the
field EXISTED, never that it RESOLVED"; dogfood-124's AC-2 asserted
`typeof e.bundle === "string" && e.bundle.length > 0` and nothing else. Only
`rawResultsDir` — the field WP-588 had already been burned on — was repo-anchored.

**Disposition — HAND-FIXED THIS SITTING (→ WP-591, ✅ DONE):**
`publishableRepoPath()` extracted from `publishableRawResultsDir`
(`benchmarks/harness/src/results.ts:244-278`) and applied to the bundle pointer
(`benchmarks/harness/src/leaderboard.ts:31-34`); it refuses a `.chikory/runs`
path and emits repo-root-relative otherwise. The un-anchorable `reference` is
**dropped** rather than republished as a dead link (`leaderboard.ts:36-42`) —
`bundle` + `rawResultsDir` are both repo-anchored and carry the same evidence.
`benchmarks/publications/leaderboard/` regenerated: `bundle` is now
`benchmarks/publications/p3-rung-4` and resolves from the repo root. 3 new tests
(anchoring, run-workspace refusal, `reference` dropped) — harness 183 → **186**
green, both original ACs still PASS.

### 🟡 F-268 — every `gemini-cli` run meters $0.00 because the model id is an unversioned alias

The trace footer reads `⚠ cost meter blind (unpriced tokens)` and the step reads
`$0.0000 (estimated — UNPRICED: 2,999 tokens metered)`. Root cause: the executor
endpoint records the model as bare `gemini`, and `packages/sdk-ts/src/pricing.ts`
keys `PRICE_TABLE` on versioned ids (`gemini-3.6-flash`, `gemini-3.1-pro`, …).
No row matches, so cost is 0 and the executor half of the budget gate never bites.

WP-567 (2026-08-02) added those price rows precisely so an unpriced model could
not burn real capacity at $0 on paper — and the alias defeats it for the primary
executor of every dogfood and benchmark run. It is invisible today only because
the runs are cheap; it makes `budget_usd` structurally unenforceable for the
executor. Distinct from ℹ️ F-167 (the keyless *judge* proxy reports no model id).

**Disposition — → WP-592 (queued).** The fix belongs in the adapter (record the
resolved model id gemini-cli actually used), not in a `"gemini": {…}` catch-all
price row, which would invent a number.

### ℹ️ F-265 recurrence — `0 tool calls` on a 6-file, 444-line delivery

The step reports `0 tool calls` while writing 444 lines across 6 files, and 2,999
total tokens for reading a ~10 KB spec plus authoring a 154-line module. The
executor's telemetry is fiction, so per-step token economics and tool-use
attribution cannot be read for any gemini-cli arm.

**Disposition — track-B note; already queued as WP-590** (dogfood-123, F-265). No
new WP.

### ℹ️ F-269 — marking a WP row half-done tripped the F-81 staleness-gate anchor test

Updating `plan.md`'s WP-303 row with `✅ DATA HALF LANDED` flipped
`parseWpStatus(plan, "WP-303")` from `red` to `green` and failed
`packages/sdk-ts/test/cli/wp-status.plan-integration.test.ts:37` — a guard that
deliberately anchors on an *untouched* P3 WP to prove the Tag emoji encodes
complexity, not completion (F-81). The row is honest (WP-303's static site and
methodology are still open) and the parser is correct; the test's anchor simply
went stale, exactly as it did once before when WP-301 landed.

**Disposition — HAND-FIXED THIS SITTING.** Anchor rotated to WP-305 (OSS launch
polish — genuinely untouched, Tag 🟢, no done-marker), with the rotation history
recorded in the test comment (`wp-status.plan-integration.test.ts:33-39`). Full
suite green: 1,299 TS (23 skipped) · 186 harness · 84 py. **Standing rule for
future reviews: any review that writes a done-marker into a §6/§7 Notes cell must
re-run the sdk-ts suite before committing** — the anchor is a production-`plan.md`
integration test, so a doc edit alone can break it.

## Anomaly checklist (phase 3)

| check | finding |
|---|---|
| wasted / filler steps | none — 1 step, 18,749-byte diff, no empty-diff probe step (F-11 did not recur) |
| cost telemetry | 🟡 executor $0.00 on real tokens → **F-268** |
| token economics | unreadable for this arm (F-265 recurrence) |
| judge behavior | both checks genuinely executed (exit 0); 6/6 rubric with specific rationales; **but `design_serves_overall_goal ✓` passed an artifact carrying a dead pointer** — the judge reads the diff, not whether a published path resolves |
| judge family diversity | ✅ real — `gemini-cli` executor vs `openai-compat` judge |
| human ceremony | operator launched; harvest + all doc work in this review — normal |
| loop integrity | ✅ 1 checkpoint, `lastGood: true`, no duplicates, no resume, no rollback |
| workspace escape (F-192) | ✅ host `git status` clean pre-harvest |

## Verdict on the thesis

**Positive.** A loose spec with a self-owned oracle produced a correct, non-obvious
implementation in one step for four cents: the executor got the ranking key, the
disjointness rule, the no-winner rule and the copy-don't-recompute rule all right,
and the traps were designed exactly to catch the plausible wrong versions. The
judge executed real checks and its rationales were specific, not generic.

**The standing gap is unchanged and now twice-proven:** an LLM judge reviewing a
diff cannot tell that a *path string* is dead. Both F-261 (dogfood-123) and F-267
(this run) were published-evidence defects that passed every green gate and were
caught only by a human resolving the pointer by hand. The lesson is not "judge
harder" — it is that any AC over a published artifact must assert the artifact's
pointers **resolve**, and that rule is now encoded in the harness itself
(`publishableRepoPath`) rather than left to each spec's author.

**Ladder position:** rung-5 is the P3 exit gate — published ranges **and** a
leaderboard, on a corpus wide enough that the intervals can actually separate. The
leaderboard half is now live and honest. The corpus half is not: 19 requirements
cannot separate 100% from 94.7% at 95% confidence, and the harness has **no
mechanical way to tell whether a newly authored task is even discriminating** —
`chikory-bench` has `validate`, `list`, `fetch-devai`, `run`, `compare`,
`leaderboard`, and nothing that proves a task's checks are red at its pinned base.
Growing the corpus without that gate would push both intervals *up* and make
separation harder. That gate is the next run. Ledger `rung=4` — the rung is not
satisfied until it separates.
