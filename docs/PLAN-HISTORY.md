## 2026-08-08 — displaced from plan.md status block by the dogfood-127 review

- **Latest / next:** 🟢 **WP-595 (probe-verified scoring gate) DELIVERED CLEAN — dogfood-126 made an unproven requirement stop counting toward a published score** (`run-14291f34-7144-43b3-9a82-2ef776b4d008`, SUCCESS **1 step, $0.0469/$15.00**, 3m 58s, 2/2 criteria + 6/6 rubric, harvest byte-IDENTICAL 6/6, `docs/reports/dogfood-126.md`). `probe --record <file>` upserts a durable discrimination ledger (one entry per task: `taskId`/`baseRef`/`fixRef`/`verdict`/`probedAt`/`requirements[]`, re-probe REPLACES, unclean verdicts recorded as evidence); `summarize(…, ledger?)` counts a task's requirements only when it is BOTH base-verified AND holds a `discriminating` verdict **taken at the ref it was scored at** — every task stays in `perTask` with `discriminationVerified`, exclusions named in `unverifiedTasks`. All 5 designed traps rejected (stale ref · unclean verdict · silent drop · downstream recompute · no-ledger compatibility); with no ledger every published artifact re-summarizes unchanged. **Two review defects, both HAND-FIXED this sitting:** 🔴 **F-274** — the gate had NO operator path: `runSuite`'s new `ledger` option had no caller, so only a library import could arm it (**F-180 verbatim, and WP-593's `probe.json`-nobody-reads one level up**). Fixed: `run --discrimination-ledger <file>` loads and REFUSES a missing/damaged ledger at $0 before any task runs (`main.ts:59-62,322-338,364`). 🟠 **F-275** — a damaged ledger was silently reset to `{}` and written back, destroying every prior verdict; now `parseDiscriminationLedger`/`readDiscriminationLedger` throw naming the file (`results.ts:118-157`, `probe.ts:241-245`). +4 tests, harness 192 → **196** green; sdk-ts 1,304 green. Also 🟡 **F-276** (track-B: `fan-in-handoff` chain test flakes under full-suite parallel load — passes isolated) · ℹ️ F-268/F-265 recurrences, already WP-592/WP-590. Progression ⛔ **STALLED** + ⚠️ LADDER-PACE; ledger `rung=4` — WP-595 is the rung-5 PREREQUISITE, not the rung. **NEXT = WP-596 (dogfood-127): `probe --tasks <dir>` — a durable, resumable corpus sweep that persists each verdict as it lands, so the operator's multi-hour rung-5 probe survives a kill and never re-probes proven work.**

## 2026-08-08 — displaced from docs/DOGFOODING.md status block by the dogfood-126 review

**Status (2026-08-07, bounded — update discipline: REPLACE this block, ≤15 lines;
displaced prose moves verbatim to [`PLAN-HISTORY.md`](PLAN-HISTORY.md); per-run detail:
`docs/reports/`; queue + course correction: `plan.md` §6/§7).**
🔴 **dogfood-125 DELIVERED WP-593 and was sealed FAILED WRONGLY** (`run-f3d47cf8-6d56-4c7b-85d1-fcfe185badef`,
4 steps **$0.1899/$15.00**, 7m 04s, `docs/reports/dogfood-125.md`). `chikory-bench probe --task <file>
[--out <dir>]` proves a task discriminates before it may be scored: base ref + new `repo.fix_ref` in
SEPARATE workspaces, `base_verification_command` at BOTH refs, red base ⇒ `inconclusive` (never
`discriminating`). Both ACs PASS, all 4 traps rejected, corpus untouched. Two 🔴 hand-fixes: **F-270** —
the executor greened its own trap by mutating SHARED `publishableRepoPath` (`results.ts:273`), so a repo
root published as `repos/chikory` off an ancestor repo — F-267 from the other end, in WP-591's own helper;
reverted, probe re-anchored on its out dir, harness 186→**192**. **F-271** — the judge passed **2/2 criteria
+ 6/6 rubric**, then one false free-text concern became an unattended FAILED seal because the F-229
carve-out demanded `diffRef.bytes === 0`; **the empty diff was never the load-bearing signal** — it now keys
on `allCriteriaPass && allRubricPass` (`agent-loop.ts:1110-1128`), sdk-ts 1,303→**1,304**. 🟠 **F-272 →
WP-594** (`compact` ×3 at 106% window, 0 folds — the `keepLastN: 5` floor beats the governor on short runs) ·
🟡 **F-273** (no gate asks what an edited SHARED function returns for callers outside the diff). Progression
✅ PROGRESSING, ⚠️ LADDER-PACE (rung 4 ×3). **NEXT = WP-302 (dogfood-126): fix-pin + probe-verify the corpus.**

## 2026-08-08 — displaced from plan.md status block by the dogfood-126 review

- **Latest / next:** 🔴 **WP-593 DELIVERED, RUN SEALED FAILED WRONGLY — dogfood-125 built the task-discrimination probe, then two quality gates produced the review's two worst defects** (`run-f3d47cf8-6d56-4c7b-85d1-fcfe185badef`, FAILED 4 steps, **$0.1899/$15.00**, 7m 04s, `docs/reports/dogfood-125.md`). **Delivery is correct and landed:** `chikory-bench probe --task <file> [--out <dir>]` materializes `repo.ref` and the new validated `repo.fix_ref` into SEPARATE workspaces, runs `base_verification_command` at BOTH refs, and refuses to classify anything when either is red (`inconclusive`, exit 1); otherwise it classifies each requirement `discriminating` (red@base/green@fix) · `non-discriminating` (green@base — free for every arm) · `unsatisfiable` (red@fix), writes `probe.json`, and exits 0 only on a fully discriminating verdict. All four designed traps rejected; both ACs PASS; corpus untouched. **Two 🔴 defects, both HAND-FIXED this sitting:** **F-270** — to green its own trap-B the executor edited the SHARED `publishableRepoPath` walk to start at `dirname(absolute)` (`results.ts:273`), so any target that IS a repo root resolved against an ancestor repo on the operator's disk (`<repo>` → `repos/chikory`) — **F-267 from the other end, inside the helper WP-591 added to prevent it**, and a `leaderboard.ts` caller the spec's constraints declared off-limits. Reverted; the real fix anchors the probe on its OUT DIR (`probe.ts:126-133`); +6 tests, harness 186 → **192**. **F-271** — the judge marked **2/2 criteria + 6/6 rubric PASS**, then wrote one free-text concern (factually false: the full suite does pass), and verdict rule 4 turned that sentence into an unattended FAILED seal, because the F-229 carve-out also demanded `diffRef.bytes === 0`. **The empty diff was never the load-bearing signal** — the step that DELIVERS the last fix is the most converged state a run reaches. Carve-out now keys on `allCriteriaPass && allRubricPass` alone (`agent-loop.ts:1110-1128`), matching the F-107 discipline the completion review already enforces; +1 test, sdk-ts 1,303 → **1,304**. Also 🟠 **F-272 → WP-594 queued** (pacing recommended `compact` ×3 at peak window 106%, folded 0 — the pressure policy still keeps `keepLastN: 5` verbatim, so a short run can never fold) · 🟡 **F-273** (no gate asks what an edited SHARED function returns for callers outside the diff; `publishableRepoPath` had no direct unit test — now it does) · ℹ️ F-268/F-265 recurrences, already WP-592/WP-590. Progression ✅ PROGRESSING; ledger `rung=4` — WP-593 is the rung-5 PREREQUISITE, not the rung. **NEXT = WP-302 (dogfood-126): fix-pin and probe-verify the existing corpus, then author the first probe-proven new task — the corpus half of the P3 exit gate.**

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

