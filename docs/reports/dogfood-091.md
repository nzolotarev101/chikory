# dogfood-091 — WP-251 (observe a live pacing-driven compaction fold) attempted as the ⑧ P2-exit context-rot headline. The product delivery was **correct and complete** (4 bounded parts, full SDK suite green in the run workspace), but the run **FAILED spuriously**: acceptance-check AC-2 was arithmetically **unsatisfiable** (a `grep -rc` idiom that can never pass), so the judge's budget-waste HALT guard fired on a FALSE red after part 4 produced its by-design empty verify-only diff. Nothing harvested. Separately, the real codex run **never actually folded** (`peak window 1% · compact 0`) — the compact-band window seam was sized against the wrong token denominator — so the headline "observe a LIVE fold" KPI was **not met** either. WP-251 stays un-live-proven.

- **WP:** WP-251 — observe the compaction-summary telemetry live (context-rot pillar; CLAUDE.md "context rot … first-class mitigation required"; REQUIREMENTS FA-3/SE-2). A real open plan.md §6 product WP. The net-new `describeCompactionPressure` pressure-join reducer + trace render is the intended LANDED PRODUCT DIFF; the `debug.contextWindowTokens` compact-band seam is the RUN VEHICLE.
- **Date:** 2026-07-07
- **Spec:** `examples/dogfood/dogfood-091-wp251-live-compaction-pressure-observed.yaml` (LOOSE — outcome-shaped goal, four dependency-ordered PARTs; module/test layout left to the executor). Ladder-rung 4. Thesis-KPI: CONTEXT-ROT MITIGATION OBSERVED LIVE.
- **Run-id:** `run-7fca16bc-8296-4b24-a9bc-b7e7641dd533` (**FAILED** · 4 steps · $3.32 / $80.00 · 12m 43s · judge HALT)
- **Landed:** **nothing** — the run FAILED so no harvest commit ran; working tree = HEAD `428e5e8`, `git status` clean. The correct product diff exists only in `.chikory/runs/run-7fca16bc-8296-4b24-a9bc-b7e7641dd533/workspace`.
- **Mode:** `chikory run` (single durable run, UNATTENDED — `unattended:{escalation:seal_resumable_failed}`), `pacing:{mode:auto}`, launched with `CHIKORY_CONTEXT_WINDOW_TOKENS=1200000`.
- **Executor:** codex(openai) · **Judge:** openai-compat/gemini-3.1-pro-preview (family-diverse ✓).

## Trace

```
run run-7fca16bc-8296-4b24-a9bc-b7e7641dd533 · FAILED · 4 steps · $3.32 / $80.00 · 12m 43s · executor codex(openai) · judge openai-compat/gemini-3.1-pro-preview
 #   step (chunk)                          tokens(in/out)  cost     diff    verdict
 1   PART 1 pure describeCompactionPress…  1178k/6.9k      $1.54    5317B   ✓ PROCEED (2/4)   AC-2/AC-3 unmet BY DESIGN (parts 2-4 not yet landed)
 2   PART 2 wire join into chikory trace   371k/4.5k       $0.51    3794B   ✓ PROCEED (2/4)   AC-2 STILL "unmet" — but see F-119
 3   PART 3 live Temporal pressure-fold    845k/6.8k       $1.12    5464B   ✓ PROCEED (2/4)   AC-3 now ✓; AC-4 flaked ✗ mid-add
 4   PART 4 full-suite regression          82k/648         $0.11    0B      ⛔ HALT            empty verify-only diff → HALT guard fires
totals: decisions 4 · judge passes 4 ($0.04, 1.1%) · rollbacks 0 · escalations 0 · injections 0 · checkpoints 4
        pacing events 4 · peak window 1% (compact 0 · park 0) · feedback 1/1 steps
        issues found 11 · changes made 3 (issues:changes 11:3) · exact cost sum $3.3215
        checkpoint chain @4→@9→@14→@19 · failed: judge HALT (AC-2 3+ consecutive → goal-drift/budget-waste guard)
```

## Delivery quality (human review, post-landing)

**The product diff in the run workspace is correct and complete.** `describeCompactionPressure` lands in three files (definition + barrel re-export + trace consumption), 4 occurrences total in `src/`:

- `src/runner/compaction-pressure.ts` — the net-new pure pressure-join reducer (pressure steps / pacing folds / unfolded pressure steps from one journal list). Unit-tested (`compaction-pressure.test.ts`, 2 tests).
- `src/index.ts` — barrel re-export.
- `src/cli/trace.ts` (2 refs) — consumes the reducer, appends the pressure-fold segment additively to `compactions N (pacing M)`; byte-equivalent on a zero run. Covered by `trace.test.ts` (29 tests).
- `test/runner/compaction-wiring.test.ts` — the PART-3 LIVE Temporal test: real `pacing:{mode:auto}` run + tiny in-object `debug.contextWindowTokens`, reaches SUCCESS, sees ≥1 `trigger:"pacing"` compaction, asserts `describeCompactionPressure(...).pacingFolds >= 1`. Co-references `createRunnerWorker` (F-97-safe).
- Step 4 re-ran the full suite green in-workspace: **758 passed / 19 skipped**, typecheck + lint clean.

**Verified independently:** re-ran the FULL suite against the workspace product code — `tsc --noEmit && eslint . && vitest run` → **753 passed / 19 skipped** on the current toolchain. The four PARTs are distinct non-trivial diffs (5317 / 3794 / 5464 / 0 B — part 4 is verify-only by design). Scope discipline held: only `compaction-pressure.ts`, `index.ts`, `trace.ts` + their tests changed; no frozen-contract shape change; no new dependency. **The executor did exactly what the spec asked.**

**So why FAILED?** Two independent spec/launch defects, neither in product code:

1. **AC-2 is unsatisfiable (F-119).** The check is `test "$(grep -rc 'describeCompactionPressure' src/)" -ge 2`. `grep -rc` over a **directory** emits one `path:count` line **per file** (110+ lines here), not a single total. The command-substitution is therefore a huge multi-line string, and `test "<multiline>" -ge 2` → `integer expression expected` → **exit 2 on every judge pass**, no matter how correct the delivery. The reducer is referenced 4× across `src/` — the AC's *intent* ("referenced at least twice") was satisfied by step 2 — but the shell can never register it. AC-2 read RED on all 4 passes; the "AC failed 3+ consecutive → HALT (goal-drift/budget-waste guard)" fired at step 4 the moment the executor stopped producing diffs (part 4 = verify-only, 0 B). **A correct, complete, green delivery was thrown away by a broken check.**

2. **The real run never folded (F-120).** Totals show `peak window 1% (compact 0 · park 0)` and the pacing log stayed `1% window (2.1k → 3.0k proj)`. The launch armed `CHIKORY_CONTEXT_WINDOW_TOKENS=1200000`, sized (per the spec header) for "≈400k–900k codex steps." But the Chikory pacing window tracks the **agent-loop's own assembled-context token count** (~3k projected here), **not** codex's internal token consumption. 3k against a 1.2M window ≈ 0.25% → never near the compact threshold → **0 folds**. Even had AC-2 been sound and the run reached SUCCESS, the headline KPI ("a real run FOLDS live") would still be **unmet** — same blind spot as dogfood-053, but undershooting the band instead of overshooting into park. The deterministic PART-3 test (tiny in-object window, scripted executor) still proves the *mechanism* — but that is unit-level, not the live-run observation the headline claims.

**Verdict: 🟢 product code correct · 🔴 run outcome invalid.** The delivery is landable; the RUN is a false FAILED that also failed to observe the target. WP-251 is **not** live-proven.

## New friction

Highest prior = **F-118** (dogfood-090). Continue at **F-119**.

### 🔴 F-119 → WP-266 lint extension (NEW, dogfood-091, spec authoring — an unsatisfiable AC guarantees a false-HALT)
- **Evidence:** AC-2 `check: test "$(grep -rc 'describeCompactionPressure' src/)" -ge 2`. `grep -rc <dir>` prints `path:count` per file → the `$(...)` is multi-line → `test "<multiline>" -ge 2` → `integer expression expected` → exit 2 on **every** judge pass regardless of the delivery. Reproduced in the run workspace where the symbol appears 4× across `src/`.
- **Impact:** **loop-integrity.** An unsatisfiable AC does not merely mis-score one pass — it converts the judge's "AC failed 3+ consecutive → HALT" budget-waste guard into a **guaranteed false terminal FAILED** the instant real work completes (any no-diff verify step trips it). Here a fully-correct, full-suite-green, 4-part delivery was terminated and discarded. The WP-266 spec lint passed this spec 🟢 ("no F-82/F-83 hazard") because it only checks `test -f`/`test -e` and negative bare-word greps — it does not model `grep -c`/`grep -rc` arithmetic.
- **WP it spawns:** **WP-266 lint extension** (this sitting, hand-fixed): reject any LOOSE-spec AC that pipes a `grep -c`/`grep -rc` count into an arithmetic `test -ge/-le/-eq/-ne/-lt/-gt`. `grep -rc` over a delegated (loose) path is multiline-unsafe; the sanctioned count idioms are `grep -roh PAT PATH | wc -l` (occurrences) or `grep -rl PAT PATH | wc -l` (files). Guard added to `scripts/dogfood-progression.sh` §WP-266 block this review.

### 🟡 F-120 → WP-251 re-run with corrected window sizing (NEW, dogfood-091, launch config — compact-band seam sized against the wrong token denominator)
- **Evidence:** `peak window 1% (compact 0 · park 0)`; pacing log `1% window (2.1k/2.6k/3.0k proj)`. Launch env `CHIKORY_CONTEXT_WINDOW_TOKENS=1200000` was sized for codex's ≈400k–900k internal step tokens, but the pacing window's `projectedTokens` counts the agent-loop's **assembled-context** tokens (~3k here), so the projected never approached `contextWindowTokens * compactAtFraction`.
- **Impact:** the real run never folded → the headline "observe a LIVE fold" KPI was unmet even independent of F-119. This is the dogfood-053 overshoot risk realized in the opposite direction (undershoot). Confirms a real documentation gap: the `debug.contextWindowTokens` / `CHIKORY_CONTEXT_WINDOW_TOKENS` seam must be sized against Chikory's assembled-context token scale (single-digit-k here), NOT the executor's internal token counts.
- **WP it spawns:** none new — folds into the WP-251 re-run (dogfood-092): size the window to a few k (above the compact threshold, below the park threshold at this project's assembled-context scale) so the real run actually folds. DOGFOODING §7 note added on the token-denominator distinction.

### Carry-forward observations (not numbered friction)
- **The HALT guard itself behaved correctly** given its input — it tolerated the repeatedly-RED AC while the executor kept producing diffs (steps 1–3) and only halted on the first no-progress step (part 4, 0 B). The guard is sound; F-119 is that it was fed an impossible signal. No judge-catch here counts as a true-positive (`judge_catches=0`) — the HALT was a false positive on a broken AC.
- **Judge family diversity held** (gemini-3.1-pro-preview ≠ codex/openai), every AC was judge-executed, and step-1's honest 2/4 PROCEED (parts 2–4 legitimately not yet landed) shows WP-273 chunk-aware verdicting still isn't rubber-stamping.
- **Probe/verify step:** step 4 empty diff = $0.1093 = 3.3% of run cost (F-11/WP-221 data point). Here it is *by design* (part 4 is a verify-only chunk), not a wasted re-verify — but it is also the step whose empty diff tripped the false HALT.

## Verdict on the thesis

🔴 **The ⑧ P2-exit context-rot axis is still un-live-proven, and this run surfaced a loop-integrity hole in spec verification.** The product mechanism is built and correct — `describeCompactionPressure` joins the pacing and compaction journals exactly as WP-251 intends, and the deterministic live Temporal test proves a pressure-driven fold at unit scale. But the dogfood loop did **not** deliver its headline: a real `chikory run` did not fold (F-120, wrong window denominator), and the run was terminated as FAILED by an **unsatisfiable acceptance check** (F-119) that discarded a complete, green delivery. The one genuinely new lesson is loop-integrity: **an AC that can never pass turns the judge's budget-waste guard into a guillotine** — so the WP-266 lint must reject `grep -c` arithmetic, and it does now. **Net:** no rung advanced (ledger rung 0); the next headline re-runs WP-251 with a sound AC-2 and a correctly-sized compact-band window so the live fold is actually observed.

## KPI table (DOGFOODING §1.4)

| KPI | This run (091) | Trailing-3 (089–091) | P2 exit gate |
|---|---|---|---|
| Max horizon survived | 4 steps / 12m 43s (FAILED at step 4) | max 6 steps | ≥ rung-8 ladder |
| Kill→resume count | 0 | 0 | crash-resume proven (WP-206) |
| Judge true-positives pre-land | 0 (the HALT was a FALSE positive) | 0 | judge catches real defects |
| Meta:product headline ratio (trailing-3) | product | 0 meta / 3 | ≤1 meta per 3 |
| Per-step reliability (runs ≥5 steps) | n/a (4 steps) | 100.0% (0 rollbacks / 29 steps) | 99%+ |
| Ladder rung satisfied | **0** (false-FAILED, no live fold) | max 4 | rung 8 |

## Call to action

WP-251 must be re-run with both defects fixed. The next spec `dogfood-092` re-delivers the same LOOSE WP-251 goal with (1) AC-2 rewritten to the occurrence-count idiom (`grep -roh … | wc -l`), and (2) the compact-band window sized to the assembled-context scale so the real run folds. Launch:

```sh
export CHIKORY_CONTEXT_WINDOW_TOKENS=2000   # journal-derived (see correction below); 5000 would NEVER fold
devbox run run-dogfood                      # picks the latest spec: dogfood-092
```

Commit all working-tree edits first — the workspace clones HEAD.

## Post-review correction (2026-07-08) — F-121, a THIRD defect this review missed

- 🔴 **F-121 — the "armed" window seam never reached the workflow at all.** This report's header ("launched with `CHIKORY_CONTEXT_WINDOW_TOKENS=1200000`") and F-120's 1.2M-denominator analysis are both **wrong**: the run journal proves the env was never in the launching shell. Evidence: `runs.task_json` contains **no `debug` key**, and every pacing entry's denominator is the 400k gpt-5.5 table default (`remainingTokens 397891 = 400000 − 2109`, utilization `0.0052725 = 2109/400000`). Env propagation through `devbox run` is verified working, so the export simply wasn't made in the shell that launched. **Nothing surfaced the silent no-op** — the run's whole challenge was void from step 0 and the review still reasoned about a 1.2M window.
- **Fix landed (hand-fix, TASK-PROTOCOL §4):** `scripts/dogfood.sh` now treats every spec-named `CHIKORY_*` env as a launch contract (unset → refuse, exit 4), refuses executor-scale windows ≥20k (F-120), echoes each armed seam with its compact/park thresholds, and supports `CHIKORY_PREFLIGHT_ONLY=1` (all guards, no spend). `dogfood-progression.sh --spec --preflight` additionally DRY-RUNS every non-suite AC check against HEAD (BROKEN check or zero RED-on-HEAD ACs → refuse) — the generic form of the F-119 lesson. Regression: `scripts/test-dogfood-ac-preflight.sh`.
- **Corrected dogfood-092 sizing (from this run's real pacing entries, projected 2109→3027):** `CHIKORY_CONTEXT_WINDOW_TOKENS=2000` — compact threshold 0.8×2000 = 1600 < proj₀ 2109 → folds from step 1; park needs a single-step estimate > 2000 (a ~8000-char summary), comfortably absent. The 5000 previously recommended here has threshold 4000 > the 3027 peak → **zero folds**, a guaranteed re-miss of the headline KPI.
