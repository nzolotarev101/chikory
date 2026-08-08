## 2026-08-07 — displaced from docs/DOGFOODING.md status block by the dogfood-125 review

**Status (2026-08-07, bounded — update discipline: REPLACE this block, ≤15 lines;
displaced prose moves verbatim to [`PLAN-HISTORY.md`](PLAN-HISTORY.md); per-run detail:
`docs/reports/`; queue + course correction: `plan.md` §6/§7).**
🟢 **P3-rung-5 HALF CLIMBED — dogfood-124 gave the harness an interval-ranked leaderboard**
(`run-80fe6b8f-5ceb-4089-b13b-195390bf682b`, SUCCESS **1 step $0.0442/$15.00**, 2m 18s, 2/2 criteria
+ 6/6 rubric, harvest byte-IDENTICAL 6/6, `docs/reports/dogfood-124.md`). `chikory-bench leaderboard
--bundle <dir>… --out <dir>` ranks by the **interval FLOOR** (`orderedBy: "iSrRange.low"`), marks a
pair `separated` only when the intervals are DISJOINT, and copies published rates instead of
recomputing them. `benchmarks/publications/leaderboard/` says it plainly: **Chikory [83.2%, 100.0%]
vs raw Claude Code [75.4%, 99.1%] — not separated at 95%, no winner.** All 4 designed traps rejected.
🟠 **F-267** (the published `bundle` pointer resolved only from `benchmarks/harness/` — **F-262
verbatim, one review later**) → **WP-591 hand-fixed**: `publishableRepoPath` anchors it to the repo
root, the dead `reference` is dropped, harness 183→**186** green. 🟡 **F-268 → WP-592** (executor
model id is bare `gemini` → no `PRICE_TABLE` row → every gemini-cli run meters **$0.00 on real
tokens**). ℹ️ F-265 recurrence (`0 tool calls`) — already WP-590. Progression ✅ PROGRESSING with a
⚠️ LADDER-PACE warning (rung 4 for 3 headlines). **NEXT = WP-593 (dogfood-125): `chikory-bench
probe` — red@base / green@fix per requirement, the gate the rung-5 corpus lift needs first.**

## 2026-08-07 — displaced from plan.md status block by the dogfood-125 review

- **Latest / next:** 🟢 **P3-RUNG-5 HALF CLIMBED — dogfood-124 gave the harness an interval-ranked leaderboard and published the honest verdict over the rung-4 numbers** (`run-80fe6b8f-5ceb-4089-b13b-195390bf682b`, SUCCESS 1 step, **$0.0442/$15.00**, 2m 18s, 2/2 criteria + 6/6 rubric, 0 rollbacks, harvest byte-IDENTICAL 6/6, `docs/reports/dogfood-124.md`). `chikory-bench leaderboard --bundle <dir>… --out <dir>` ranks arms by the **lower bound of the 95% interval** (`orderedBy: "iSrRange.low"`), marks a pair `separated` only when the intervals are DISJOINT, names no winner otherwise, and copies published rates rather than recomputing them. `benchmarks/publications/leaderboard/` now states it plainly: **Chikory [83.2%, 100.0%] vs raw Claude Code [75.4%, 99.1%] — not separated at 95%, no winner.** All four designed traps (point-estimate sort · winner-from-overlap · recompute · build-a-website) rejected. New friction: 🟠 **F-267** — the published `bundle` pointer was stored verbatim from `--bundle`, so `leaderboard.json` cited `../publications/p3-rung-4`, resolvable ONLY from `benchmarks/harness/` and from nowhere else (**F-262 verbatim, one review later**: the AC asserted the field was a non-empty string, never that it RESOLVED) → **WP-591 HAND-FIXED this sitting** (`publishableRepoPath` in `results.ts:244-278` + `leaderboard.ts:31-42`, dead `reference` dropped, bundle regenerated, harness 183→**186** green, both ACs still PASS). 🟡 **F-268 → WP-592 queued** — the executor endpoint records the model as bare `gemini`, matching no `PRICE_TABLE` row, so EVERY gemini-cli run meters **$0.00 on real tokens** and the executor half of `budget_usd` is structurally inert (WP-567 defeated by an alias). ℹ️ **F-265 recurrence** (`0 tool calls` on a 444-line/6-file delivery) — already WP-590, no new WP. Progression ✅ PROGRESSING; ledger `rung=4` (rung-5 is NOT satisfied until the intervals separate). **NEXT = WP-593 (dogfood-125): `chikory-bench probe` — mechanically prove each requirement is RED at the task's pinned base ref and GREEN at its fix ref before the task may enter the corpus.** The rung-5 remainder is a corpus wide enough to separate; `chikory-bench` today has `validate`/`list`/`fetch-devai`/`run`/`compare`/`leaderboard` and NOTHING that proves a new task discriminates — growing the corpus without that gate pushes both intervals UP and makes separation harder.

## 2026-08-07 — displaced from docs/DOGFOODING.md status block by the dogfood-124 review

**Status (2026-08-06, bounded — update discipline: REPLACE this block, ≤15 lines;
displaced prose moves verbatim to [`PLAN-HISTORY.md`](PLAN-HISTORY.md); per-run detail:
`docs/reports/`; queue + course correction: `plan.md` §6/§7).**
🟢 **P3-rung-4 CLIMBED — dogfood-123 published Chikory's first head-to-head benchmark result**
(`run-3e2a6791-cab1-46c7-bc5b-b3d0730b92c5`, SUCCESS **1 step $0.0457/$15.00**, 3m 20s, 2/2 criteria
+ 6/6 rubric, `docs/reports/dogfood-123.md`). **Chikory 19/19 I-SR [83.2%, 100.0%] vs raw Claude Code
18/19 I-SR [75.4%, 99.1%] / 16/19 D-SR [62.4%, 94.5%]** over `brownfield-001…005`, both arms 5/5
base-verified. Separation is `brownfield-001` alone (zod v3→v4). **The intervals OVERLAP** — 19
requirements cannot separate two arms at 95%; rung-5 needs corpus, not harness.
**The operator ran both arms BY HAND** (`scripts/bench-run.sh`, sequential) and the spec published only —
dogfood-122's lesson holds: an LLM executor may not supervise a multi-hour, quota-bound suite.
Agent classes live-checked: `park-until-reset` **0**, no rotation needed, 6/6 members probed at $0.
🔴 **F-261** (published trace link pointed inside a prunable run workspace) → **WP-588 hand-fixed**;
🟠 **F-263** (report prose cited a superseded suite run's versions) hand-fixed + provenance table;
ℹ️ **F-266** (progression gate named the retired P2 ladder) hand-fixed. **Queued: WP-589** (the
write-boundary rubric reads `git diff`, so 2.1 GiB / 95,068 gitignored writes scored ✓) · **WP-590**
(`gemini-cli` records `toolCalls: 0`). Progression ✅ PROGRESSING (rung 4). **NEXT = P3-rung-5, the
phase EXIT gate** — published DevAI-extended ranges + leaderboard, on a corpus that can separate.

