# dogfood-112 — WP-535 (hermetic judge checks) — the 🔴 F-164 grading-integrity fix

- **WP:** WP-535 (hermetic judge checks — a judge-executed `check` must not mutate the graded tree), `plan.md` §7 · P3-rung-4 **prerequisite** (not a rung climb)
- **Date:** 2026-07-24
- **Spec:** [`examples/dogfood/dogfood-112-wp535-hermetic-judge-checks.yaml`](../../examples/dogfood/dogfood-112-wp535-hermetic-judge-checks.yaml)
- **Run-id:** `run-4bd7ddc0-0c4f-40cf-bcf5-e3b2dcc9e0a8`
- **Landed commit:** `15649d1` (`feat(judge): land hermetic judge checks (WP-535, F-164 fix)`)
- **Outcome:** 🟢 SUCCESS, 1 step, $0.0416 / $30.00, 2m 49s · executor `gemini-cli` (gemini) · judge `openai-compat` (gpt-5.6-sol xhigh) · verdict PROCEED (4/4 criteria)

## Plain lead (vibe check)

The grading-integrity hole found last session is fixed. Before this run, a
judge that ran an acceptance check which wrote a test file into the workspace
left that file behind, and it got swept into the graded commit — so a benchmark
requirement could be satisfied by a file the judge itself wrote. The delivered
fix snapshots the workspace before the checks run, runs them, then deletes
whatever the checks created and restores whatever they modified — while leaving
the coding agent's own uncommitted work completely untouched. Nine tests
(8 unit + 1 live end-to-end) prove it.

One honest caveat: the run **could not prove the fix on its own journal** — the
worker cloned HEAD at launch, so it loaded the *pre-fix* code (§1.2
frozen-substrate). The proof is the landed live test, not an in-the-wild
benchmark run. And the judge itself flagged a real latent gap in the restore
path (binary/symlink/mode fidelity), which we landed as work-in-progress.

## Glossary (IDs used here)

- **WP-n** — work package (`plan.md` §6/§7 backlog row).
- **F-n** — global sequential friction id (this report adds F-169…F-171).
- **AC-n** — acceptance criterion (the spec's judge-executed pass/fail checks).
- **P3-rung-N** — rung on the P3 moat ladder (`plan.md` §7, WP-530). rung-3 = one benchmark task scored; rung-4 = ≥5 tasks vs a baseline.
- **probe / discriminator check** — a grading `check` that WRITES its own test file into the workspace (the F-164 contamination source).
- **`EXTRA_IN_COMMIT`** — a file present in the landed commit but NOT in the run's own workspace (a hand-added file).

## Trace excerpt (journal = ground truth)

```
run · SUCCESS · 1 step · $0.0416 / $30.00 · 2m 49s · executor gemini-cli(gemini) · judge openai-compat
 #  step                          tokens(in/out)  cost    verdict
 1  hermetic judge checks         3.0k / 778      $0.00*  ✓ PROCEED (4/4 criteria)
totals: decisions 1 · judge passes 1 ($0.0416) · rollbacks 0 · escalations 0 · injections 0
        checkpoints 1 · pacing 1 · peak window 75%
```
`* step cost $0.00` — the `gemini-cli` executor's 3,759 tokens are **unpriced**
(F-9/F-167 family; the judge pass IS priced at $0.0416).

| Metric | Value |
|---|---|
| Terminal state | 🟢 SUCCESS |
| Steps | 1 (0 tool calls journaled at step level; work done inside the gemini turn) |
| Executor / judge families | `gemini-cli` (gemini) ≠ `openai-compat` — bias-mitigation invariant held ✅ |
| Judge passes | 1 (completion milestone) |
| Judge verdict | PROCEED · 4/4 criteria · 5/6 rubric (1 non-destructive ✗) · 0 rollbacks |
| Cost (exact) | $0.0416 (judge pass only; executor unpriced) / $30.00 budget = 0.1% |
| Checkpoint chain | `run-…@5` · commit `47fddadf` · `lastGood true` |
| Diff size | 17,560 bytes |

## Delivery quality (human review, post-landing)

Re-verified independently against the working tree; all 4 ACs re-run green and
the harvest byte-diff is IDENTICAL for every `packages/…` file.

**The fix is genuine, not grep-gamed, and closes the real threat surface.**

- **Pure planner** `planCheckSideEffectCleanup(before, after)`
  (`packages/sdk-ts/src/judge/hermeticity.ts:121-157`): takes two porcelain
  snapshots, returns `{toDelete, toRestore}`. A check-CREATED path → delete; a
  check-MODIFIED path → restore; an **executor-dirtied-but-check-untouched**
  path → nothing (identical status+hash short-circuits, `:141`); identical
  snapshots → empty plan. This is exactly the designed trap avoided — the plan
  is derived strictly from the snapshot *difference*, never a blanket revert.
- **Wiring** (`packages/sdk-ts/src/judge/evidence.ts:248-286`): snapshot every
  writable repo BEFORE the checks, run the checks inside a `try`, apply the
  cleanup in a `finally`. So by the time `writeCheckpoint` runs, a probe file
  the check wrote is already gone — a cleaner fix than reordering
  `agent-loop.ts` judge/checkpoint, because it also keeps the probe out of the
  *next* step's evidence diff.
- **Root-cause match:** F-164's real threat is `brownfield-003` R4's probe
  `.test.ts` self-satisfying R2. That path is `!b && a`, created → `toDelete` →
  `rm` before checkpoint. Directly neutralized. The live test
  (`check-hermeticity-live.test.ts`) asserts both halves: the check's own files
  are gone AND the executor's uncommitted changes survive.
- **Tests:** `check-hermeticity.test.ts` (8) + `check-hermeticity-live.test.ts`
  (1) — 9 passed, tsc + eslint clean, full scoped suite green.

## New friction

### 🟡 F-169 — the restore path is not byte-identical for binaries / symlinks / metadata (a judge true-positive, landed as WIP)

- **Evidence:** the judge's own `design_serves_overall_goal` rubric item was ✗
  (non-destructive, so verdict stayed PROCEED): `snapshotWorkspace`
  (`hermeticity.ts:179`) reads file bytes then stores `fileBuffer.toString("utf8")`,
  and `applyCleanupPlan` (`:205`) writes that string back. Confirmed by hand:
  1. **Binary corruption** — a check that modifies an executor-dirtied binary
     restores it via the lossy UTF-8 round-trip → corrupted bytes.
  2. **No mode / symlink fidelity** — content-only restore drops the exec bit
     and turns a symlink into a regular file.
  3. **No parent-dir recreation, unguarded** — the content-restore branch
     (`:203-205`) has NO `try/catch` (unlike the git-checkout branch at
     `:207-215`), so if a check deleted the restore path's parent directory,
     `writeFile` throws and aborts the whole cleanup.
- **Why it matters:** the goal demanded a *byte-identical* workspace. That
  guarantee holds only for text files — which is the entire real threat surface
  today (every pinned brownfield check writes a text `.test.ts`), so this is
  **latent**, not live. But it is a genuine correctness gap the judge caught
  pre-land, and it is exactly the kind of edge that a future binary/asset-touching
  check would trip.
- **Verdict data point:** the judge **earned its keep** — it identified a real
  defect and correctly classified it non-blocking (work-in-progress, no
  regression). Counted as `judge_catches=1` (non-blocking design true-positive).
- **WP it spawns:** none yet — **track-B WP-535 residue**. Harden the restore
  path (buffer-preserving snapshot, `fs.cp`/symlink-aware writes, `mkdir -p`
  before content-restore, wrap the content branch in the same try/catch as the
  checkout branch) **before** any binary/asset-touching check enters the corpus.

### 🟠 F-170 — spec routed a `gpt-` model at a `gemini-cli` executor; the hand-fix landed out-of-scope in the headline commit

- **Evidence:** the harvest scope check reports `EXTRA_IN_COMMIT
  packages/sdk-ts/src/executors/gemini-cli.ts` — a file **not** in the run
  workspace, hand-added to commit `15649d1`. The spec explicitly said "Do NOT
  touch the executor adapters." Root cause: the spec's `routing.code` set
  `model: gpt-5.6-sol xhigh` while `executor.adapter: gemini-cli` — a foreign
  model name handed to the gemini adapter. The fix (`gemini-cli.ts:89-101`)
  filters non-Gemini models (`gpt-`/`claude-` → fall back to gemini default).
- **Why it matters:** two smells in one. (a) **Spec hygiene** — a routing block
  whose `code` model family contradicts the declared executor family is a
  latent mis-route (sibling of F-165). (b) **Scope discipline** — an unrelated
  executor fix rode into the WP-535 grading-integrity commit, so the headline
  commit no longer byte-matches the run's own delivery.
- **WP it spawns:** folds into **WP-536** (bench/launch family preflight) —
  extend it to also lint `routing.<stage>.model` against the resolved executor
  family and refuse a `gpt-`/`claude-` model on a `gemini-cli` executor. The
  gemini-cli filter itself has already landed.

### ℹ️ F-171 — the ledger `run` column now collides on "112"

- **Evidence:** `docs/reports/dogfood-ledger.csv` already carries two `112`
  rows (the `20260723-222341` bench suite, WP-533 ×2), and this headline is
  also `dogfood-112` (WP-535). Appending its row makes three `112` rows for two
  different deliverables.
- **Why it matters:** the progression gate reads rows by value, so the verdict
  is unaffected, but the `run` label is no longer a unique key — a reader
  cross-referencing a `112` row to a report can't tell which.
- **Fix:** **track-B**, folded into the existing `dogfood-progression` /
  benchmark-labeling note (F-168 sibling) — benchmark-suite rows should carry a
  suite-scoped label (e.g. `bench-bf001`), not borrow the next dogfood number.
  No new WP.

## Anomaly hunt

- **Wasted / filler steps:** none. 1 step, 1 non-empty 17,560-byte diff, no
  empty-diff probe step (F-11 did not recur).
- **Loop integrity:** clean. 1 decision, 1 checkpoint (`lastGood true`), 0
  resumes, 0 duplicate journal entries, 0 escalations, 0 rollbacks. **No 🔴
  loop-integrity friction.**
- **Judge behavior:** all 4 acceptance checks genuinely executed (each
  `exited 0`), rubric justifications quote real diff content, family diversity
  real (`gemini` ≠ `openai-compat`). The one ✗ (`design_serves_overall_goal`)
  is a true-positive design catch, correctly non-destructive → F-169.
- **Family directive:** ✅ **F-165 did NOT recur** — the executor was
  `gemini-cli` (gemini), the judge `openai-compat`, no Claude anywhere. The
  gemini-cli default flip (`20a2094`/`921b79d`) is now committed to HEAD, so
  the run loaded the correct default.
- **Cost telemetry:** judge side priced ($0.0416, real openai-compat model);
  executor side unpriced ($0.00 on 3,759 metered tokens) — F-9/F-167 recurrence
  on the `gemini-cli` adapter, known, no new WP.
- **Human ceremony:** launch + harvest + this review + one out-of-scope hand-fix
  (F-170). No mid-run hand-holding, no relaunch.

## KPI table (DOGFOODING §1.4)

| KPI | This run | Trailing-3 window | Target |
|---|---|---|---|
| Max horizon survived | 1 step / 2m 49s | 8 steps (dogfood-105) | growing |
| Kill→resume count | 0 | 0 | ≥1 per phase |
| Judge true-positives pre-land | 1 (non-blocking design catch, F-169) | 1 | opportunistic |
| Trailing-3 meta:product headline ratio | 0 harness-meta : 3 product | 0/3 ✅ | ≤ 1:3 |
| Per-step reliability (runs ≥5 steps) | n/a (1-step run) | 95.7% (5 rollbacks / 117 steps) | 99%+ |
| Current-phase ladder rung | **0** (substrate fix, off the climb) | rung-3 | rung-5 = P3 exit gate |

## Verdict on the thesis

- 🟢 **The grading-integrity hole is closed at the substrate.** A judge-executed
  check can no longer leave a file in the graded tree — the pure planner +
  snapshot/restore wiring is correct for the real threat surface, proven by 9
  landed tests. The one requirement that could grade itself (F-164) is defused.
- 🟢 **Agent-as-a-Judge earned its keep on evidence:** it caught a genuine latent
  correctness gap (F-169) before land and classified it correctly as
  non-blocking WIP — the design-judging altitude (WP-311) doing exactly its job.
- 🔴 **The fix is not yet proven in the wild.** §1.2 frozen-substrate means this
  run tested pre-fix code; the F-164 invariant (checkpoint commit byte-matches
  the executor's own step diff) has been proven only by unit/live tests, not on
  a real benchmark run. **That in-wild validation is the natural next step.**
- ⏳ **rung-4 is now one gate lighter but still two away:** grading integrity
  ✅ (this run); runnable corpus still 2/5 (WP-534 per-target node for
  `brownfield-002`, + 3 more pins via WP-302); no baseline arm ever run (WP-304).
