# dogfood-096 — **THE P2 EXIT-GATE RUN PASSED** — 24h+ multi-session brownfield on the real Chikory repo (WP-214 multi-repo workspaces) — SUCCESS on all three gate axes.

- **Vibe check (plain):** Chikory ran unattended for just under 26 hours on its own real codebase, split the work into 11 durable steps separated by 150-minute sleeps, survived all 10 sleep/wake cycles without losing or repeating any work, compacted its own context 6 times when it grew too large, and landed a real multi-repo feature with all tests green. This is the run the whole Phase 2 plan was building toward — **Phase 2 is complete.**
- **Bottom line:** delivery 🟢 · Thesis-KPI 🟢 3/3 exit-gate axes · P2 exit gate **PASSED** · rung 5 (the culminating WP-265 ladder rung) reached.

## Run at a glance — `run-f77c33db-8628-4e50-bd91-b48e5eb5c5d4`

| field | value |
|---|---|
| Outcome | 🟢 SUCCESS · 11 steps · **$15.70 / $120** (13.1%) · **25h 54m** wall-clock |
| Executor / Judge | codex(openai) / gemini-3.1-pro-preview via openai-compat (family-diverse ✓) |
| Spec | `examples/dogfood/dogfood-096-p2exit-24h-multirepo-brownfield.yaml` (LOOSE, rung 5) |
| Host WP | WP-214 (multi-repo workspaces) — real Chikory source, brownfield |
| Landed | `554e08f` (auto-commit hook; 15 files, +1260/−128) — all 14 harvested `packages/` files byte-IDENTICAL to the run workspace |
| **Soak** | 10 parks × 150 min = **25h 0m slept**, `re-entries 10`, every re-entry clean (journal: 10 `control_event` resumes, zero duplicate step entries) |
| **Pacing** | `pacing.autoCalibrate` · `peak window 133% (compact 10 · park 0)` · **`compactions 6 (pacing 6)` · first pacing fold step 5** |
| Kill drill | NOT armed (`CHIKORY_KILL_AT_STEP` optional per spec; soak parks satisfy the suspend/resume axis) |
| Judge | 11/11 PROCEED · $0.11 (0.7% share) · 0 rollbacks · 0 escalations · all 4 ACs judge-executed every pass |

## Trace

```
run run-f77c33db · SUCCESS · 11 steps · $15.70 / $120.00 · 25h 54m · executor codex(openai) · judge openai-compat
 #   step                                 tokens(in/out)   cost     verdict
 1   Implemented PART 1 only. Checkpoint… 1358k/9.3k       $1.79    ✓ PROCEED (4/4)
 2   Completed Part 2. `collectPerRepoDi… 781k/7.0k        $1.05    ✓ PROCEED (4/4)
 3   Implemented Part 3: resume now rehy… 2113k/18k        $2.83    ✓ PROCEED (4/4)
 4   Implemented Part 4 only: the chain … 1370k/10k        $1.82    ✓ PROCEED (4/4)
 5   Part 5 complete: per-repo writeSet … 621k/5.9k        $0.84    ✓ PROCEED (4/4)
 6   Part 6 complete: named-repo check c… 1732k/9.4k       $2.26    ✓ PROCEED (4/4)
 7   Part 7 complete: trace per-repo sum… 1346k/7.9k       $1.76    ✓ PROCEED (4/4)
 8   Part 8 complete: report per-repo su… 838k/6.4k        $1.11    ✓ PROCEED (4/4)
 9   Part 9 complete: checkpoint OTel re… 551k/4.3k        $0.73    ✓ PROCEED (4/4)
10   Part 10 complete: live 2-repo resum… 470k/3.7k        $0.62    ✓ PROCEED (4/4)
11   Part 11 complete: docs + full suite… 553k/5.5k        $0.75    ✓ PROCEED (4/4)
totals: decisions 11 · judge passes 11 ($0.11, 0.7%) · rollbacks 0 · escalations 0
        checkpoints 11 · peak window 133% (compact 10 · park 0) · compactions 6 (pacing 6)
        pressure-steps 10 (unfolded 4 · first pacing fold step 5) · re-entries 10 · soak-slept 25h 0m
```

## Exit-gate verdict — 🟢 PASSED (all axes, per the spec's POST-RUN CONFIRM)

| gate axis (plan.md §"Phase 2 exit") | result | evidence |
|---|---|---|
| ≥1 suspend/resume, clean replay | 🟢 | **10** soak park→re-entries (150 min each, sized above the proxy-token TTL); journal has exactly 11 step / 11 checkpoint / 11 judge entries — zero duplicates, zero re-execution |
| Compaction events under LIVE pacing pressure | 🟢 | `compactions 6 (pacing 6)` — all six folds `trigger:"pacing"` under the auto-calibrated window (F-125 mechanism), first fold step 5, peak window 133% |
| SUCCESS, unattended, ≥24h, no context-rot-shaped failure | 🟢 | 25h 54m wall-clock, `unattended:{escalation:seal_resumable_failed}` never fired, 0 rollbacks/escalations, no filler or "already done" steps, every step a distinct green increment |
| Real WP-214 advance lands | 🟢 | resume/chain/scope-gate/check-cwd/trace/report/OTel all multi-repo now; live 2-repo Temporal proof; 804 TS tests green (AC-4 re-run on the working tree: PASS) |

## Delivery quality (human review, post-landing)

- **Verified independently:** all 4 ACs re-run PASS against the working tree (pack §3); all 14 harvested `packages/` files byte-IDENTICAL to the run workspace (pack §5); landed-scope check vs `554e08f` shows nothing missing, nothing differing (the `plan.md`/`REQUIREMENTS.md` "extras" are the intervening commit `200a18a`, not the harvest).
- **Real capability added (PARTs 3–10):** `restoreCheckpoint`/resumable-seal restore now rehydrate EVERY writable repo to its sealed commit (was: single-workspace `reset --hard`); the chain handoff `spec.repos.length !== 1` FAILED guard (`activities.ts:~1494`) is replaced by per-repo `RepoHandoff[]` publication with per-repo parent-source validation; writeSet scope gate evaluates repo-relative per repo (repo-B writes no longer false-flag on the subdir prefix); `criterion.repo` runs a check in that repo's subdir; trace/report render per-repo diff bytes + commits; checkpoint OTel spans carry `repo.count`/`repo.refs`; live 2-repo Temporal test proves checkpoint-spanning + per-repo evidence + mid-run dirty-state restore end-to-end.
- **1-repo path preserved:** `perRepoCommits` only journaled when >1 repo; single-repo trace/report/evidence unchanged (constraint honored; suite of 804 includes the 1-repo regression assertions).
- **But see F-129:** PARTs 1–2 were largely extraction of capability that already existed on HEAD (below).

## New friction (numbering continues from F-128)

**F-129 (🟡 spec-authoring, premise staleness — MINE) — the spec's HOST-WP premise was 6 days stale, so 2 of 11 steps bought refactoring, not capability.** The spec asserts "today `activities.ts` commits only `spec.repos[0]`" and "only the first repo is diffed" — but `fadc124` (2026-07-04, `feat(sdk-ts): implement multi-repo workspaces support`) had already landed the per-repo checkpoint-commit loop AND the per-repo diff-evidence sections before launch (2026-07-10). **Evidence:** the removed hunks in `554e08f` show the pre-existing `for (const workspaceRepo of workspaceRepos.writable)` commit loop and the pre-existing `perRepoDiff` sections in `collectEvidence`; `git log -S workspaceRepoCheckpointId --reverse` → `fadc124`. PART 1/2 (steps 1–2, $2.84) therefore satisfied the "net-new symbol" ACs by EXTRACTING existing code into the named functions, plus a `perRepoCommits` checkpoint field that duplicates `gitCommits` verbatim (seal: `perRepoCommits: gitCommits` when >1 repo). The F-90 "symbol absent on HEAD" armor proves the SYMBOL is new — not that the CAPABILITY is missing. **Impact:** bounded — 9 of 11 PARTs were genuinely new; no false-green (ACs 3–10 pinned real gaps). **Fix (authoring rule):** before writing a premise line ("today X only does Y"), verify it with `git log -S`/`grep` on the CAPABILITY (call sites, loops), not just symbol-absence — the same plan-lags-main failure shape recorded after dogfood-088. Track-B cleanup candidate: collapse `perRepoCommits` into `gitCommits` (redundant schema field). **WP:** none new.

**F-130 (🟡 judge rubric, front-loading undetected) — step 1 delivered PART 2's headline symbol and the judge's scope rubric passed it.** Step 1's diff extracted `collectPerRepoDiffs` in `evidence.ts` (PART 2's net-new symbol) despite the spec's "do NOT front-load a later PART"; all 4 ACs were green from step 1 onward, and `scope_matches_instruction` PROCEEDed ("strictly scoped…"). **Impact:** low here (extraction only; PART 2 still added the labels + consumption), but the non-hollow-horizon guarantee (F-100/WP-270) leans on chunk scope being real — a judge that never flags cross-chunk work cannot catch a hollow later step. **Fix:** the chunk-scope rubric criterion should compare the DIFF'S file/symbol footprint against the active chunk, not the executor's self-description. **WP:** evidence for WP-270 rubric hardening; no new WP.

**F-131 (ℹ️ track-B, WP-214 residue) — per-repo diff bytes in the status report are recovered by string-parsing an artifact summary.** `commands.ts` `repoNameFromDiffSummary` parses `"workspace diff for <name> since …"` out of the evidence artifact's human-readable summary to attribute diff bytes per repo — a hidden format contract with `evidence.ts`; rewording the summary silently zeroes per-repo byte counts. **Fix:** carry the repo name as a structured field on the evidence ref. Track-B under WP-214.

**Observation (no F-number, → DOGFOODING §8):** `judge.cadence: 2` was inert — every step consumed a work chunk, and a chunk step is a judge milestone (`workChunkMilestone`, `agent-loop.ts:633`, by design JD-2), so the judge ran 11/11. Harmless here (0.7% cost share) but do not size judge cost by `cadence` on a chunked spec.

## KPI table (DOGFOODING §1.4)

| KPI | this run | trailing window / status |
|---|---|---|
| Max horizon survived | **11 steps / 25h 54m** | NEW wall-clock max (prev: 6h 19m, dogfood-090) |
| Kill→resume count | 0 worker kills (drill optional, not armed) · **10 soak suspend/resumes, clean replay** | cumulative deterministic kill→resume: 1 (dogfood-095) |
| Judge true-positives pre-land | 0 (nothing to catch; 0 rollbacks) | 0 across trailing 3 |
| Trailing-3 meta:product headline ratio | 094 meta · 095 meta · **096 product** → **2:1** | 🔴 cap (≤1 meta per 3) still busted → next headline MUST be class=product |
| Per-step reliability (runs ≥5 steps) | 11/11 = 100% | **100% — 0 rollbacks over 69 steps** (9 qualifying runs) · target 99%+ ✓ |
| Ladder rung vs P2 exit gate | **rung 5 — the exit gate itself — PASSED** | **P2 COMPLETE**; ladder culminated; P3 is the frontier |

## Verdict on the thesis

The core thesis — durable execution + inner-loop judge makes long-horizon agent work reliable — now has its first full-scale data point: a 26-hour, 11-increment, multi-session brownfield run on a real repo with 100% per-step reliability, zero re-execution across 10 process suspensions, and live context-pressure compaction. Every P2 mechanism (soak, auto-calibrated pacing, resumable seals, self-heal, chunk-scoped judging) fired in one combined run. The open risk the run did NOT test: an adversarial/failing horizon (0 judge catches needed — reliability was proven, judge value-add was not exercised here). P3 (benchmark numbers, due ~2026-09-08) is now the only thing between this evidence and a publishable claim.
