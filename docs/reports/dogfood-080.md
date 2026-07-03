# dogfood-080 — WP-265 rung 3 ATTEMPTED, NOT REACHED: WP-205 branching/rollback landed COMPLETE + all-green + scope-clean, but codex ONE-SHOT the entire decomposed 4-part feature in a single step — the intra-run horizon did NOT materialize and the intended operator `kill -9` → `chikory resume` never fired (the only 2nd step was an accidental 600s step-cap auto-retry on the hanging LIVE test). F-94 escalated → the finding that pushes to WP-213 native loop / explicit step-forcing.

- **WP:** WP-205 — branching as a first-class durable operation (fork a run at any committed checkpoint into an isolated child, parent left intact). A real open P2 product WP on the durable-execution pillar, chosen here as the **WP-265 rung 3** host (the FIRST intra-run horizon attempt — many durable steps INSIDE one `chikory run`, unlike rung 2 where the horizon came between chain nodes).
- **Date:** 2026-07-03
- **Spec:** `examples/dogfood/dogfood-080.yaml` (`dogfood-080-wp205-branching-rollback`, LOOSE, Ladder-rung 3, `budget_usd: 60`, `max_steps: 40`) — launched with `chikory run` (rung 3 is intra-run, a single long durable run). WP-266 loose-AC lint 🟢 (net-new `cmdBranch` anchor + reused `parseBranchTarget`/`worktree`, no `test -f`, no bare negative grep).
- **Run-id:** `run-233e7d7f-540c-43c4-a5c8-a1556f8f2e1f`. Executor `codex(openai)`, judge `openai-compat/gemini-3.1-pro-preview`.
- **Terminal state:** 🟢 **SUCCESS · 2 steps** — but structurally **1 real attempt (step 1) + 1 auto-retry (step 2)**, NOT a durable multi-step horizon. `✓ PROCEED (5/5 criteria)`, 0 rollbacks / 0 escalations / 0 injections.
- **Landed commit:** **NONE** — delivery uncommitted on the working tree (byte-IDENTICAL to the run workspace, verify §5 all 10 files `IDENTICAL`). Left for the user's review.

## Trace — the "2 steps" is 1 attempt + 1 timeout-retry, not feature-step accumulation

```
run run-233e7d7f · SUCCESS · 2 steps · $1.66 / $60.00 · 16m 26s · executor codex(openai) · judge openai-compat/gemini-3.1-pro-preview
 #   step                                              tokens(in/out)   cost      dur      verdict
 1   "live branch test is still running…let it finish" 0/0              $0.00     10m 0s   ✗ FAILED (killed at 600s cap)
 2   "🟢 WP-205 is complete."                          1265k/6.6k       $1.65     5m 50s   ✓ PROCEED (5/5)
 totals: decisions 2 · judge passes 1 ($0.01, 0.8%) · rollbacks 0 · escalations 0 · injections 0 · checkpoints 2
```

- **Step 1 built the WHOLE feature** — a **36,368-byte** diff across all 10 files in **57 tool calls**, then HUNG on its own new LIVE Temporal branch test ("still running past the unit tests, likely waiting on a workflow state transition") and was **killed at exactly 600.0s (1.00× cap)** by the WP-268 step-cap. `checkpoint …@2, lastGood false`.
- **Step 2** was the automatic retry: it re-ran everything (**1,265k input tokens** — the whole context re-fed), produced only a **1,428-byte** net delta over step 1's tree, the LIVE test now passed in 5m50s, and the judge sealed `✓ PROCEED (5/5)`. `checkpoint …@7, lastGood true`.
- **Loop integrity 🟢:** step 1's failed checkpoint (`lastGood false`) was cleanly superseded by step 2's (`lastGood true`); no duplicate journal entries, no re-executed sealed step. The durable retry mechanism worked correctly — it just isn't a horizon.

## The rung-3 KPIs — BOTH missed (this is the finding, not a failure of the delivery)

### Intra-run horizon: NOT reached — codex one-shot the deliberately 4-part decomposed goal in ONE step
The spec was explicitly engineered (design note F-94) to force a long intra-run horizon: a single goal DECOMPOSED into 4 ordered dependent PARTS (command surface → journal fork → workspace fork → branch-on-verdict + live proof), each "with its own tests folded in, so the single run accumulates real durable steps." **It did not work.** codex produced the entire feature — all 4 parts, 10 files, 493 lines of new test + 133-line runtime module — inside step 1's single 57-tool-call turn. The multi-part goal did **not** induce multiple durable step boundaries; it induced one very large step. This is F-86/F-94 reconfirmed and now escalated: **a big, genuinely multi-part single-run goal does NOT produce an intra-run horizon under codex.** The per-step reliability / compounding-error curve (95%→99% over many steps in ONE run) remains **un-measured** after this deliberate experiment.

### Live kill→resume: NOT exercised — the "kill" was an accidental step-timeout, not an operator `kill -9`
The Thesis-KPI also wanted a deliberate mid-run `kill -9` → `chikory resume` on the long run. Because the run never became long (it one-shot), there was no long run to kill. The only interruption was step 1's 600s step-cap timeout, which the runtime auto-retried in-process — `resumes = 0`. The operator crash→resume axis did **not** move this run.

## Delivery quality (human review of the uncommitted working tree) — 🟢 COMPLETE, all-green, scope-clean

Read the diff line-by-line against the goal's four PARTS. The feature is real, additive, correct, and reuses the pure slices as required.

| Goal PART | Delivered | ✓ |
|---|---|---|
| **1 — BRANCH COMMAND SURFACE:** `cmdBranch` + `branch` CLI case, parse `run-id@step` via existing `parseBranchTarget`, nonzero exit + actionable message on bad run/target/checkpoint, DI-fake unit-tested | `cmdBranch`/`cmdResume` in `src/cli/commands.ts`; `branch` verb wired in `src/cli/main.ts`; reuses `parseBranchTarget` from `src/cli/branch-target.js`; `test/cli/branch.test.ts` (86 lines) drives failure paths via DI fake | 🟢 |
| **2 — JOURNAL FORK:** child run journal seeded from parent UP TO + INCLUDING the fork checkpoint (no later entries), parent run-id + fork checkpoint recorded as provenance | `forkRunAtCheckpoint` in `src/runner/branch.ts` seeds the child journal through the fork checkpoint; `branch_fork` control-event carries parent-id + checkpoint provenance (asserted `test/runner/branch.test.ts:151-156`) | 🟢 |
| **3 — WORKSPACE FORK:** child workspace created from the fork checkpoint's recorded git commit via a `worktree`/checkout, reusing WP-132 commit resolution; unit-tested against a REAL temp git repo (no git mocking) | `branch.ts` worktrees the checkpoint commit; `test/runner/branch.test.ts` builds a real repo (`initSourceRepo`, `execFile` git), asserts child HEAD == checkpoint `gitCommits` value and the forked file exists at that tree (`:137-146`) | 🟢 |
| **4 — BRANCH-ON-VERDICT + LIVE PROOF:** judge may RECOMMEND a BRANCH, surfaced additively alongside PROCEED/HALT/ROLLBACK/ESCALATE, **never replacing ROLLBACK**; a LIVE Temporal test drives a run to a checkpoint, branches, asserts child resumes from the fork + parent intact | `verdict.ts` adds `"BRANCH"` to the `kind` union; **Rule 1 ROLLBACK still checked FIRST (`:54-61`), BRANCH is Rule 2 (`:63-69`)** — additive, ROLLBACK preserved. LIVE `describe.skipIf(address===null)("branch live proof")` drives 3 checkpoints, `cmdBranch` forks, asserts child has `step-1.txt` but NOT `step-2.txt`, parent keeps `step-3.txt` + unchanged journal length (`test/runner/branch.test.ts:167-270`) | 🟢 |
| CONSTRAINTS: strict TS, ESM `.js`, named exports, NO new dep, NO contract/`StepRecord`/`JournalEntry`/`Checkpoint` change, extend WP-132/WP-123/WP-206 additively | No dep added; `verdict.ts` change is a pure additive union member + one new rule; no shared type shape altered; crash-recovery + suspend/resume tests still green | 🟢 |

- **Scope:** exactly the 10 files the goal entails — 3 new (`src/runner/branch.ts`, `test/cli/branch.test.ts`, `test/runner/branch.test.ts`), 7 modified (`cli/commands.ts`, `cli/main.ts`, `judge/verdict.ts`, `runner.ts`, `runner/activities.ts`, `workflow/agent-loop.ts`, `test/judge/verdict.test.ts`). No contract/shared-type file touched. Clean.
- **Independent AC re-verify (this review, against the working tree):** AC-1…AC-4 greps (`cmdBranch` in `src/cli/` + `test/`, `parseBranchTarget` in `src/cli/`, `worktree` in `src/`) all **PASS**; AC-5 `tsc --noEmit` OK · `eslint .` OK · `vitest run` **629 passed / 19 skipped / 0 failed**. The LIVE branch test genuinely EXECUTED under Temporal during the run (step 1 hung ON it for 600s; step 2 passed it in 5m50s) — AC-4 is live-satisfied, not grep-only.
- **Harvest byte-diff (verify §5):** all 10 files **IDENTICAL** to `.chikory/runs/run-233e7d7f/workspace` — the working tree IS what ran.
- **Verdict on the delivery:** **WP-205 → 🟢 DONE** on merit (branching is first-class, additive, all-green, reuses the pure slices). It is uncommitted — the user harvests.

## New friction (highest prior F-94 → F-95, F-96)

### 🟡 F-95 → WP-213 (or a new step-forcing WP) — a deliberately multi-part decomposed SINGLE-run goal does NOT produce an intra-run horizon; codex one-shots it, so rung 3 is structurally unreachable by "make the goal bigger" alone
- **Evidence:** dogfood-080's spec was purpose-built (per F-94's own design note) to test whether a 4-part ordered-dependency goal + tight judge cadence (`cadence: 2`) yields a long intra-run horizon. codex produced all 4 parts / 10 files / 626 new lines in **step 1's single turn** (57 tool calls, 36,368-byte diff). The run's "2 steps" is 1 attempt + 1 timeout-retry, not 2 feature steps. Intra-run ≥5-step reliability: still **0 runs measured**. Same one-shot pattern as dogfood-077 (F-86, 13-file feature in 1 step) and dogfood-079 (F-94, each chain node 1 step).
- **Why it matters (the spec predicted this exact finding):** the WP-265 ladder's rung 3 (intra-run horizon) — the gate that finally stresses compounding-error over a long single session — **cannot be reached by enlarging the goal**, because the executor collapses any single-run goal into one mega-step regardless of internal part structure. The horizon must be forced by the HARNESS, not requested from the executor. This is the pivot the spec's design note named.
- **Fix → WP-213 (native step loop) becomes the priority, or a NEW explicit step-forcing WP:** rung 3 needs either (a) WP-213's native multi-step loop that checkpoints the executor at bounded work-units regardless of how much the model wants to do per turn, or (b) an explicit step-forcing mechanism (per-part judge gate that SEALS and re-enters, a tool-call budget per step, or a decompose-to-run like chain but intra-run). "Bigger goal" is proven insufficient (dogfood-077/079/080). **This makes WP-213 the next headline, not another rung-3 retry with a bigger goal.**

### 🟡 F-96 → WP-515 (NEW) — a step killed by the `maxSeconds` cap reports `$0.00 / 0 tokens` despite 10 min of real executor work; killed-step spend is invisible to the budget gate and the retry re-bills the full context
- **Evidence:** step 1 ran **10m 0s / 57 tool calls** of real codex work, then was killed at the 600s cap — the trace records it as **`$0.0000 (estimated) · 0/0 tokens`**. The real API spend (a 36KB diff's worth of generation) is unaccounted. Step 2 (the retry) then re-fed the whole context and billed **1,265k input tokens / $1.65** — so the run's true cost is materially higher than the reported `$1.66`, and step 1's spend is simply lost from the ledger.
- **Why it matters:** the hard budget cap is a core MVP guarantee (§1.1). A step that burns real provider spend but returns no usage on kill makes the budget gate **undercount** — a run that repeatedly times out and retries could spend well past its `budget_usd` while the accounting shows a fraction of it. It also corrupts the cost-per-run KPI baseline (WP-203/204 token economics) and the ledger `cost_usd` column.
- **Fix → WP-515:** capture partial/streamed usage from the codex adapter at kill time (or estimate killed-step cost from tool-call count × observed per-call token rate) so a timed-out step contributes its real spend to the budget total and the trace. Sibling of WP-268 (step-cap enforcement). Track-B.
- **ℹ️ Positive datapoint — F-85/WP-268 hard cap HELD:** the same kill proves WP-268 works: step 1 was killed at **exactly 600.0s (1.00× cap)**, versus dogfood-076's 1.76×/1.98× overruns before the fix. The hard step-cap is now enforced at 1.00×.

### 🟡 F-58 / WP-249 — (standing) delivery uncommitted with no harvest trailer
- No landed commit for this run yet (verify §6). When harvested, the commit must carry a `Run-ID: run-233e7d7f…` trailer linking it to the audit trail. WP-249 owns it; no new WP.

## KPIs (DOGFOODING §1.4)

| KPI | This run (dogfood-080) | Trailing window / target |
|---|---|---|
| Max horizon survived (durable steps / wall-clock) | **1 feature step** (+ 1 timeout-retry) / **16m 26s** wall | rung-3 target = long INTRA-run horizon (≥5 durable feature steps in one run) — 🔴 **NOT MET; codex one-shot (F-95)** |
| Kill→resume count (live at-horizon) | **0** — no long run to kill; the only interrupt was an accidental 600s step-cap timeout (auto-retried in-process, `resumes=0`) | ✅ rung-2's live kill→resume stands (dogfood-079); rung-3 operator kill NOT exercised |
| Judge true-positives pre-land | **0** — single PROCEED (5/5), a clean build, no seam drill; honest 0 | seam drills excluded per ledger |
| Trailing-3 meta:product headline ratio | **0:3** (078/079/080 all product) | target ≤1:3 — 🟢 well under |
| Per-step reliability (runs ≥5 steps) | **n/a — still 0 runs ≥5 steps** (F-95: the one experiment built to produce one one-shot instead) | the intra-run horizon gap; now proven un-reachable by goal size alone → WP-213 |
| Current ladder rung vs P2 exit gate | **rung 2 (dogfood-079) — rung 3 ATTEMPTED, NOT REACHED** | next: WP-213 native loop / step-forcing to MAKE rung 3 reachable → then P2 exit gate (24h brownfield) |

## Verdict on the thesis

🟡 **A clean product win and a decisive negative result.** WP-205 branching landed COMPLETE, additive, all-green (629 passed), scope-clean, and byte-identical to the workspace — the judge's BRANCH recommendation is correctly additive (ROLLBACK still checked first) and the LIVE Temporal test genuinely proves a child resumes from the fork while the parent stays intact. **But the run's whole reason for existing — to produce the first INTRA-run horizon (rung 3) — failed in the most informative way:** a goal deliberately decomposed into 4 ordered parts still collapsed into a single 57-tool-call codex step (F-95), confirming across dogfood-077/079/080 that **the intra-run horizon cannot be summoned by making the goal bigger — it must be forced by the harness.** That is the pivot: **the next headline is WP-213 (native step loop) / an explicit step-forcing mechanism, NOT another rung-3 retry with a larger goal.** Secondary: a killed step reports `$0.00/0 tokens` while the retry re-bills the full context (F-96 → WP-515), so the budget gate undercounts timed-out spend — though the same kill proved WP-268's hard step-cap now holds at exactly 1.00×.
