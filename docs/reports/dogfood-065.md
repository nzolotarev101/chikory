# dogfood-065 — WP-255 step-deadline pure descriptor (the killed-step telemetry-visibility half) — *landed orphaned*

- **WP:** WP-255 (killed-step telemetry / loop-integrity, born from dogfood-064's F-59). This run lands the PURE half: `describeStepDeadline(input)` — the `summarizePacing`/`describeSeamArming` pure-decision analog computing `elapsedSeconds` / `overran` / `overrunRatio` (the 2.45× figure) / `remainingSeconds` that a killed-step journal + `chikory trace` SHOULD render so a cap overrun is visible instead of masked by zeroed `0/0`/`$0.00` counters.
- **Date:** 2026-06-29
- **Spec:** `examples/dogfood/dogfood-065.yaml` (`dogfood-065-wp255-step-deadline`)
- **Run-id:** `run-358273a3-dbbe-4103-8166-4f065606f309` (runtime HEAD `cfd4cba`)
- **Landed commit:** none yet — delivery is **STAGED** (`M`/`A` in index) on the working tree, byte-IDENTICAL to the run workspace (pack §5 = `IDENTICAL` ×3), pending the operator's harvest commit.
- **Gate verdict (pre-launch, recorded in the spec header):** 🟡 **ALLOW (fallback)** — §1.1 ✅ (cross-file, real numeric failure surface: strict `>` boundary, negative-span clamp, `maxSeconds:0` divide-by-zero guard, no mutation) · §1.2 🟡 fallback (real WP-255 code, no thesis-stressing slice unblocked, all §4-walled) · §1.3 🟡 ALLOW (real-WP pure slice, low thesis-stress, nothing real unblocked). **⚠️ This review finds the fallback verdict was already STALE at launch — see F-60.**

## Trace (excerpt)

```
run run-358273a3-... · SUCCESS · 1 steps · $0.70 / $5.00 · 3m 19s · executor codex(openai) · judge openai-compat
 #   step                                 tokens(in/out)   cost     verdict
 1   Summary: Landed the pure WP-255 STE… 520k/4.7k        $0.70    ✓ PROCEED (2/2 criteria)
totals: decisions 1 · judge passes 1 ($0.01, 1.1%) · rollbacks 0 · escalations 0 · injections 0
        checkpoints 1 · peak window 1% · issues found 0 · changes made 1 (issues:changes 0:1)

step 1 · SUCCESS · $0.6970 (estimated) · 520k/4.7k tokens · 2m 45s · 21 tool calls
diff:        d4ecd7fdc203 · 5257 bytes
judge pass #1 · openai-compat/gemini-3.1-pro-preview · $0.0078 · 19158 evidence bytes · 33s
  AC-1 ✓ (grep symbols + scoped vitest, 6 tests pass)   AC-2 ✓ (tsc + eslint + full suite, 533 passed | 19 skipped)
  rubric ✓×4 (tests_pass, no_unrelated_deletions, no_secrets_introduced, scope_matches_instruction)
verdict:     ✓ PROCEED (2/2 criteria)
checkpoint:  run-358273a3-...@4 · commit da65b0e8fb1c · lastGood true
```

## Delivery quality (human review, post-landing)

🟢 **The diff is technically perfect — and matches the spec to the letter.**

| File | Verdict | Notes |
|---|---|---|
| `src/runner/step-deadline.ts` (NEW, +50) | 🟢 | `describeStepDeadline` + `StepDeadlineInput`/`StepDeadlineStatus` exactly as specced. `elapsedSeconds = Math.max(0, (endedAtMs - startedAtMs)/1000)`, strict `>` overran, `Math.max(0, …)` remaining clamp, `maxSeconds > 0 ? … : 0` ratio guard. Pure, no mutation, no rounding. Local types — `types.ts` untouched. |
| `src/index.ts` (M, +5) | 🟢 | Additive barrel re-export, pacing-style. No existing export altered. |
| `test/runner/step-deadline.test.ts` (NEW, +~95) | 🟢 | All 6 mandated cases: F-59 overrun (`toBeCloseTo(2.4533)`), under-cap, exactly-at-cap, negative-span clamp, `maxSeconds:0` guard (asserts not `Infinity`/`NaN`), no-mutation snapshot. |

- **Scope discipline 🟢** — pack §4: exactly the 3 named files, nothing else. Byte-IDENTICAL harvest (§5 ×3). No new dependency.
- **Verification 🟢** — AC-1 + AC-2 re-run against the working tree both PASS (exit 0); full suite **533 passed | 19 skipped**, tsc + eslint clean.
- **Cost 🟢** — exact total **$0.7048** (steps $0.6970 + judge $0.0078) = **14.0%** of the $5 budget; judge share **1.1%**. No probe step, no empty diff — **F-11 did not recur**.

## New friction

### 🔴 F-60 — the pure-first cadence got LAPPED: dogfood-065 landed an ORPHANED descriptor for a WP the operator had already closed 15 minutes earlier

The single most important finding of this review. The delivery is flawless **and useless**:

- **Zero runtime consumers.** `describeStepDeadline` / `StepDeadlineStatus` / `StepDeadlineInput` are referenced ONLY by the barrel re-export (`src/index.ts:136-138`) and the test. No `src/` module calls the descriptor. It is dead code on landing.
- **The real wire already shipped — inline — 15 min before the run.** Operator commit `0533a4c` ("feat: add context token estimation helpers and implement partial usage recovery…", 2026-06-29 **15:03**) already landed WP-255(b) telemetry directly in `src/executors/step.ts:150-163`, which computes the SAME arithmetic inline:
  ```ts
  // WP-255 / F-59: surface the ACTUAL elapsed wall-clock so a cap overrun is visible
  const cap = opts.input.limits.maxSeconds;
  const elapsedSeconds = proc.durationMs / 1000;
  const overrunRatio = cap > 0 ? elapsedSeconds / cap : 0;
  // … reason: `step exceeded maxSeconds=${cap}; killed after ${elapsedSeconds.toFixed(1)}s (${overrunRatio.toFixed(2)}× cap)`
  ```
  That same commit also landed WP-255(a) process-tree reap (`process.ts` `spawn(detached:true)` + group `process.kill(-pid)`). The dogfood-065 run did not start until **15:18** (judge timestamps `15:18:20`/`15:18:25`).
- **The plan said so out loud.** The §6 status line written at harvest of dogfood-064 already read: *"WP-255 → 🟢; only the optional structured `describeStepDeadline` journal field (dogfood-065, **now low-value**) remains."* The spec's own §1.3 verdict (🟡 ALLOW fallback) was stale at the moment it was acted on.
- **Result:** duplicate arithmetic in two places — the canonical consumer (`step.ts`) reimplements `elapsedSeconds`/`overrunRatio` inline and does NOT call the pure descriptor the dogfood just shipped. The headline greened the dashboard; the product moved zero.

**Evidence:** `grep` for the symbols across `src/` returns only `index.ts` + the def; `git show --stat 0533a4c`; `step.ts:150-163`; plan §6 status line; run judge ts `15:18` vs commit ts `15:03`.

**WP it spawns → WP-256.** The structural fix is not "wire the orphan in" (busy/track-B). It is a **pre-launch staleness gate**: a dogfood spec whose target WP is already 🟢 in `plan.md`, or whose named symbol's logic already exists inline in a `src/` consumer, must be REFUSED before the workspace clones HEAD. The operator-follow-up loop (auto-commit mid-session, see `[[auto-commit-mid-session]]`) can close a WP between spec-write and launch; nothing currently re-checks the spec against HEAD at launch time. Sibling of WP-228 (baseline-precheck) / WP-231 (landing-scope audit) / WP-232 (chain-launch verification) — the "verify the run is still worth doing" guard family.

### 🟡 F-61 — 520k input tokens to land a 50-line pure function (token-economics data point)

Step 1 read **520k input tokens** / 4.7k output across 21 tool calls for a 3-file, 5257-byte diff — a deterministic pure descriptor with an exact spec. That is ~104× the output and a very high input-per-unit-work ratio for a fully-specified single-function task. Consistent with the codex adapter's cumulative-per-tool-call input accounting (the same effect WP-254's numerator swap addresses for *pacing*), but here it is baseline cost data, not a pacing-read bug. **WP it spawns:** none new — feeds WP-203/WP-207 token-economics baseline. Record the number: a maximally-specified pure-port headline still costs ~$0.70 and half a million input tokens; the marginal value of these pure-port headlines is now below their cost (reinforces F-60).

### ℹ️ Thesis signal (not friction)
The judge again graded on-disk artifacts (executed both AC checks, 2/2 PROCEED, rubric ×4) and the family-diversity held (executor codex/openai vs judge gemini-3.1-pro-preview via the keyless shim). The quality gate worked exactly as designed — it just had nothing real to gate.

## Verdict on the thesis

🟡 **Mixed.** Mechanically the loop is pristine: SUCCESS, clean scope, real judge execution, family diversity, $0.70/14% budget, byte-IDENTICAL harvest, F-11 not recurring. **But the run is the textbook realization of the dogfood-review §5 standing failure mode** — it greened the dashboard while the `plan.md` backlog stood still, because the WP it targeted had been closed inline 15 minutes earlier. The pure-first headline cadence is no longer merely *dry* (F-59 era) — it now actively manufactures orphaned duplicate code. **The corrective is twofold: (1) WP-256, a launch-time staleness gate so this can't recur; (2) break the pure-first habit and take the one never-exercised thesis pillar — the durable multi-run CHAIN (WP-219/232/233), unexercised across all of dogfood-042→065.**
