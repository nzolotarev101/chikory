# dogfood-093 — WP-251 (observe a live pacing-driven compaction fold), the ⑧ P2-exit context-rot axis — **FOLD FINALLY OBSERVED LIVE (4th attempt)**.

- **Vibe check (plain):** For the first time, a real `chikory run` under real memory pressure actually **folded** its own history — summarized-and-dropped old context — and the trace rendered it. The three prior misses were all sizing/horizon mistakes (over-park, under-window, too-short); this run kept the correct window and made the to-do list long enough (7 steps) that history finally piled past the fold threshold, so `planCompaction` fired **twice**. The last un-live-proven P2 pillar (context-rot mitigation) is now demonstrated end-to-end. The delivery — the F-123 loud-on-silent-fold warning + a first-fold-step telemetry field — is correct, full-suite-green, and byte-identical to the run workspace.

- **WP:** WP-251 — observe the compaction-summary telemetry live (context-rot pillar; CLAUDE.md "context rot … first-class mitigation required"; REQUIREMENTS FA-3/SE-2). A real open plan.md §6 product WP. The net-new `pressureFoldGapWarning` (silent-fold diagnostic) + `firstPacingFoldStep` (first-fold-step telemetry) extend the `describeCompactionPressure` reducer landed in dogfood-092; the `debug.contextWindowTokens` compact-band seam is the RUN VEHICLE; the **≥6-step horizon is the new correctly-sized dimension (F-122 fix)**.
- **Date:** 2026-07-09
- **Spec:** `examples/dogfood/dogfood-093-wp251-live-compaction-fold-long-horizon.yaml` (LOOSE — outcome goal, seven dependency-ordered PARTs; module/test layout left to the executor). Ladder-rung 4. Thesis-KPI: CONTEXT-ROT MITIGATION OBSERVED LIVE — a real run FOLDS under live pacing pressure across a ≥6-step horizon.
- **Run-id:** `run-60a32aff-0b81-4cbd-9d39-7eb50b8b9561` (**SUCCESS** · 7 steps · $4.53 / $80.00 · 20m 52s).
- **Landed:** **uncommitted on the working tree** (6 files, byte-identical to the run workspace — pack §5 all `IDENTICAL`). HEAD = `a988d6b`. No harvest commit; delivery awaits the user's review.
- **Mode:** `chikory run` (single durable run, UNATTENDED — `unattended:{escalation:seal_resumable_failed}`), `pacing:{mode:auto}`, launched with `CHIKORY_CONTEXT_WINDOW_TOKENS=2000` (F-120-corrected assembled-context scale). The seam reached the workflow: first pacing entry `remaining -636 + projected 2636` at a 2000 window (util 132% from step 0).
- **Executor:** codex(openai) · **Judge:** openai-compat/gemini-3.1-pro-preview (family-diverse ✓).

## Trace

```
run run-60a32aff-0b81-4cbd-9d39-7eb50b8b9561 · SUCCESS · 7 steps · $4.54 / $80.00 · 20m 52s · executor codex(openai) · judge openai-compat
 #   step (chunk)                          tokens(in/out)  cost     diff    verdict
 1   PART 1 pure pressureFoldGapWarning    671k/5.1k       $0.89    2894B   ✓ PROCEED (3/4)   AC-3 unmet BY DESIGN (part 5 live test not yet landed)
 2   PART 2 firstPacingFoldStep enrich     175k/2.4k       $0.24    3343B   ✓ PROCEED (3/4)   AC-3 still unmet by design
 3   PART 3 render warning in trace        450k/4.6k       $0.61    4497B   ✓ PROCEED (3/4)   AC-3 still unmet by design
 4   PART 4 render first-fold step         438k/4.3k       $0.59    2725B   ✓ PROCEED (3/4)   AC-3 still unmet by design
 5   PART 5 LIVE ≥6-step pressure fold     1326k/7.4k      $1.73    4735B   ✓ PROCEED (4/4)   all ACs green — the live proof lands
 6   PART 6 loud-on-silent-fold proof      175k/2.1k       $0.24    1058B   ✓ PROCEED (4/4)
 7   PART 7 full-suite regression          120k/1.4k       $0.16    0B      ✓ PROCEED (4/4)   empty verify-only diff, no HALT (F-118/WP-268 root-span fix held)
totals: decisions 7 · judge passes 7 ($0.06, 1.4%) · rollbacks 0 · escalations 0 · injections 0 · checkpoints 7
        pacing events 7 · peak window 213% (compact 7 · park 0) · compactions 2 (pacing 2)
        pressure-steps 7 (unfolded 5 · first pacing fold step 5) · exact cost sum $4.5311
        checkpoint chain @4→@9→@14→@19→@24→@29→@35 · all lastGood true
```

### Pacing / compaction journal (ground truth — the win)

Window = 2000 assembled-context tokens; every step overshot the compact band immediately, and **two real folds fired** once resident summaries crossed `keepLastN=5`:

| pacing idx | atStep | action | projected | remaining | util |
|---|---|---|---|---|---|
| 0 | 0 | compact | 2636 | -636 | 132% |
| 1 | 1 | compact | 2822 | -822 | 141% |
| 2 | 2 | compact | 3361 | -1361 | 168% |
| 3 | 3 | compact | 3659 | -1659 | 183% |
| 4 | 4 | compact | 4252 | -2252 | 213% |
| 5 | 5 | compact | 3852 | -1852 | 193% |
| 6 | 6 | compact | 3876 | -1876 | 194% |

| compaction | trigger | foldedCount | tokensBefore→After | digest |
|---|---|---|---|---|
| #1 | `pacing` | 1 | 423 → 224 | digest of 1 older step summary (1321 B) |
| #2 | `pacing` | 2 | 588 → 295 | digest of 2 older step summaries (1823 B) |

**This is the first dogfood RUN to journal a live `trigger:"pacing"` compaction.** `describeCompactionPressure` over the journal reports `pacingFolds=2`, `firstPacingFoldStep=5`, `pressureSteps=7`, `unfoldedPressureSteps=5`; `pressureFoldGapWarning` returns `null` (folded → silent, exactly the F-123 payoff). The four-attempt arc closes: **053 over-park → 091 under-window → 092 too-short → 093 FOLD.**

## Delivery quality (human review, post-landing)

- **Scope:** 6 files, all `src/` + `test/` under `packages/sdk-ts/` — exactly what the goal names, nothing out of scope, no new dependency, no frozen-contract shape change.
  - `src/runner/compaction-pressure.ts` — `pressureFoldGapWarning(description)` (pure; non-null only when `pressureSteps>0 && pacingFolds===0`) + additive `firstPacingFoldStep` field on `CompactionPressureDescription`.
  - `src/cli/trace.ts` — consumes both additively (warning line only when non-null; `first-fold step N` only when set) → byte-equivalent on a folded or no-pressure run.
  - `src/index.ts` — additive barrel export.
  - `test/cli/trace.test.ts`, `test/runner/compaction-pressure.test.ts`, `test/runner/compaction-wiring.test.ts` — the PART-5 live ≥6-step Temporal fold proof + PART-6 loud-on-silent proof + renderer cases.
- **ACs re-run against the working tree:** AC-1…AC-4 all **PASS** (exit 0). AC-4 = `tsc --noEmit && eslint . && vitest run` → **790 passed | 19 skipped**. Harvest byte-diff: all 6 files `IDENTICAL` to the run workspace.
- **Judge:** all four ACs are judge-executed shell checks (`exited 0`); AC-3 (the live-driver co-reference, F-97) correctly stayed RED on steps 1–4 (part-5 test not yet landed) and flipped green at step 5 — a true partial-progress signal, not a false green. Family diversity real: executor codex(openai) vs judge gemini-3.1-pro-preview via openai-compat. Zero rollbacks / escalations / injections across all 7 passes.
- **Loop integrity:** 7 durable checkpoints, chain `@4→@9→@14→@19→@24→@29→@35`, all `lastGood true`, no duplicate journal entries, no re-executed steps, no resume. A clean 7-step non-hollow horizon.

## New friction

**F-124 (🟡 track-B) — the `compaction` journal entry carries no `stepIndex`, so `firstPacingFoldStep` is *inferred* from the adjacent pacing decision, not stamped on the fold.**
- **Evidence:** the run's `compaction` payloads are `{tokensBefore, tokensAfter, digestRef, foldedCount, trigger}` — no step field. `describeCompactionPressure` (`src/runner/compaction-pressure.ts`) resolves `firstPacingFoldStep` via `typeof payload.stepIndex === "number" ? payload.stepIndex : latestPressureStep`; since the emitter never sets `stepIndex`, the **first branch is dead** and the value always falls back to the *most recent pacing decision's* `atStep` (here 5). If a fold is journaled a decision-tick away from its triggering pacing entry, the reported step can be off by that gap.
- **Impact:** operator telemetry ("which step first folded") is approximate, not exact — acceptable for the current diagnostic, wrong for precise attribution.
- **WP it spawns:** small track-B follow-up under WP-251 — stamp `stepIndex` on the `compaction` journal entry at emit time (`activities.ts` compaction path) and drop the reducer's fallback branch; +1 fixture asserting the stamped step. Not loop-integrity (🔴), so it does NOT headline — hand-fix or track-B PR.

_No other friction._ The run itself was clean — no launch friction (the F-121 preflight guard held, the window was correctly sized on the first try), no false-HALT (F-118/WP-268 held on the empty part-7 verify diff), no re-size needed. A marked contrast with 091 (false-HALT) and 092 (silent 0-fold).

### Token economics (baseline data — WP-203/207)

Input tokens per step: 671k / 175k / 450k / 438k / **1326k** / 175k / 120k. Step 5 (the live ≥6-step Temporal test + full pacing/compaction suite) is the spend spike ($1.73, 36 tool calls). Even the small additive diffs (steps 1–4) carry 400–670k input tokens — the codex executor's per-session context is the dominant cost driver, not diff size. Probe step 7 (empty verify diff): $0.1644 = 3.6% of run cost (the F-11/WP-221 data point).

## Verdict on the thesis

**Confirmed, and the P2 context-rot gate's mechanism prerequisite is closed.** The core thesis claim — that a self-correcting long-horizon agent must *mitigate context rot in the inner loop, observably* — now has its first live demonstration: real token pressure drove real folds, the judge gated each increment on a structurally different model family, and the trace makes "pressure fired AND folded (at step 5)" distinguishable from 092's "pressure fired but the run was too short to fold" — a distinction the same trace now reports **loudly** via `pressureFoldGapWarning` when it is absent. With WP-251 live-proven, WP-250 (window-park) delivered, WP-272 (soak endurance) proven, WP-105 (durable-loop OTel spans) proven, and WP-519/520 (run-level self-heal) landed, **every mechanism the P2 exit gate names is now live** — the remaining P2 item is the launch-gated 24h+ brownfield endurance run that combines them.
