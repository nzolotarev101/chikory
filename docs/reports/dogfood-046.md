# Dogfood-046 — THE first reproducible Agent-as-a-Judge true-positive catch (core thesis PROVEN) — 🟢 BEST

> **Vibe check:** This is the run the product was built to make happen. For 45
> dogfoods the central promise — *a real-time judge that catches a bad code
> change **before** it lands* — had exactly one accidental data point (the
> dogfood-001 missing-JSDoc catch) and could never be reproduced on demand,
> because "hope the executor writes a bug" is a coin-flip a strong executor keeps
> winning (dogfood-045, F-46). dogfood-046 removes the luck: the WP-244
> `debug.seedBadDiff` seam lets the executor write a **correct** `clamp` at step
> 0, then silently overwrites it with a compiling-but-wrong `return value;`
> *after* the executor finishes but *before* the judge runs. The judge's
> cadence-1 acceptance test went **red**, the run **refused to seal SUCCESS**
> (the catch), the executor read the failing test from the judge feedback and
> **restored a correct implementation** at step 1 → SUCCESS in 2 steps. The
> §1.1 KPI — "regressions the judge caught pre-land" — is now **forceable on
> demand**. One sharp caveat surfaced (F-47): the seam fires with **zero
> journaled telemetry**, so the trace's `injections 0` line actively hides that a
> bad diff was seeded — the proof only survives by hand byte-diffing three
> artifact blobs.

**WP**: WP-244 (deterministic judge-catch seam) → thesis pillar JD-3 / IF-2 (Agent-as-a-Judge true-positive catch) · **Date**: 2026-06-22 (run 2026-06-21) · **Spec**: [`examples/dogfood/dogfood-046.yaml`](../../examples/dogfood/dogfood-046.yaml) · **Run-id**: `run-b024565e-a927-49ce-8626-c70705c750e9` · **Runtime under test**: `ebab493` (the seam) on the WP-244 working tree · **Outcome**: 🟢 **SUCCESS · 2 steps · judge CAUGHT the seeded regression pre-land → executor self-corrected** · **Harvested delivery**: 2 files, byte-IDENTICAL, committed `5b6ca24`

> **Acronyms:** *WP* = work package (a plan.md unit of work). *AC* = acceptance
> criterion (the spec's executable `check`, run by the judge inside the run
> workspace). *Seam* = a dogfood/test-only deterministic injection point
> (`debug.seedBadDiff`, the analog of WP-243's `debug.parkBeforeStep`). *The
> catch / true positive* = the judge blocks a genuinely wrong diff *before* it
> lands — the KPI in DOGFOODING §1.1. *Cadence 1* = the judge runs after every
> step. *Deterministic override* = a judge-executed `check` exiting nonzero
> forces the criterion to FAIL regardless of the LLM's verdict (`harness.ts:105`).
> *F-n* = a numbered friction finding (global, sequential across all reports).
> *Step n* below uses the **trace's 1-indexed** numbering; the spec's prose uses
> 0-indexed (trace step 1 = spec step 0).

## What this run proves

The spec declared the 🟢 BEST and 🟡 ALSO-VALID branches up front; this is the 🟢 branch in full:

| Outcome | Meaning | This run |
|---|---|---|
| 🟢 BEST | judge catches the seeded bug at step 0 → executor fixes from the feedback → SUCCESS in ≥2 steps | **this is what happened** |
| 🟡 ALSO VALID | the catch fires but the executor never restores a correct `clamp.ts` → run exhausts steps, seals FAILED (still a thesis demo: the bad change was caught and never sealed SUCCESS) | did not occur |

**The KPI moves.** "Regressions the judge caught pre-land" (DOGFOODING §1.1) was
stuck at the single dogfood-001 data point for 45 runs. It is now **reproducible
on demand** — re-running this spec produces the catch regardless of executor
skill, because the seam, not the executor's fallibility, supplies the wrong diff.

## The catch, proved from the artifacts (not from the run's own green)

The judge's verdict alone is not proof — I reconstructed the catch by byte-diffing three content-addressed artifact blobs:

| Artifact | Blob | `clamp.ts` content | Meaning |
|---|---|---|---|
| Executor step-1 diff | `77bcb0e82de0` | **correct** full impl (19 lines, all bounds + `RangeError`) | what the executor actually wrote |
| Judge evidence diff | `84e435c4536b` | `export function clamp(value, min, max): number { return value; }` (1 line) | the seam's `CHIKORY_SEED_BAD_DIFF_CONTENT`, byte-for-byte — what the judge saw |
| Step-2 fix base | `dab2229cbe91` base `fa94ca9` | diff `fa94ca9..e3add63` — restores correct impl | step-2 executor inherited the **corrupted** file and fixed it |

The chain is airtight: the executor's own step-1 summary reports **all green**
(`6 tests passed`, build/lint/typecheck green, full suite 427 passed) — yet the
**judge re-ran the same checks and got AC-1 `exited 1`, AC-2 `exited 2`**. The
only thing that changed between executor-finish and judge-run is the seam
overwriting `clamp.ts`. The judge's `test_results` artifact (`f08e0081cb2e`)
shows the exact behavioral failures the bug causes:

```
× clamp > returns min for values below the floor → expected -3 to be +0
× clamp > returns max for values above the ceiling → expected 99 to be 10
× clamp > throws a RangeError when min is greater than max → expected function to throw, but it didn't
 Test Files  1 failed (1)   Tests  3 failed | 3 passed (6)   [exit 1]
```

`return value;` ignores the bounds and never throws — exactly the seeded bug. The
catch is **fair**: a genuinely wrong diff evaluated against a genuine behavioral
test; nothing about the verdict is faked.

## Trace evidence (`run-b024565e-…`)

```
run … · SUCCESS · 2 steps · $1.13 / $5.00 · 4m 54s · executor codex(openai) · judge openai-compat
 #   step                                 tokens(in/out)   cost     verdict
 1   Implemented clamp …                  525k/3.1k        $0.69    ✓ PROCEED (0/2 criteria)   ← THE CATCH
 2   Implemented clamp correctly …        327k/2.1k        $0.43    ✓ PROCEED (2/2 criteria)   ← THE FIX
totals: decisions 2 · judge passes 2 ($0.02, 1.4%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 2 · feedback frequency 1/1 steps
        issues found 3 · changes made 2 (issues:changes 3:2)
```

| Metric | Value |
|---|---|
| Terminal state | 🟢 SUCCESS (2 steps: caught then corrected) |
| Step 1 (the catch) | $0.6873 · **525,000 in / 3,100 out** · 2m 4s · 13 tool calls · checkpoint `…@3` commit `c348f7a32f61` lastGood true |
| Step 2 (the fix) | $0.4289 · **327,000 in / 2,100 out** · 1m 23s · 9 tool calls · checkpoint `…@7` commit `7b3d8428a930` lastGood true |
| Judge pass #1 | `gemini-3.1-pro-preview` (openai-compat) · $0.0059 · 4,978 evidence bytes · 11s → **AC-1 exit 1, AC-2 exit 2 → both FAIL** |
| Judge pass #2 | `gemini-3.1-pro-preview` (openai-compat) · $0.0100 · 16,680 evidence bytes · 1m 16s → **AC-1, AC-2 exit 0 → both PASS** |
| **Total cost** | **$1.1321** (steps + judge) / $5.00 budget = **22.6%**; judge share **1.4%** |
| Family diversity | executor `codex`/`openai` ≠ judge `gemini-3.1-pro-preview` (Google) ✓ |

### Judge behavior — and the nuance that matters

Pass #1 (the catch): AC-1 (`vitest run`) and AC-2 (`tsc && eslint && vitest`)
both exited nonzero → the deterministic override flipped both criteria to FAIL →
**the run could not seal SUCCESS**. Pass #2 (after the fix): both checks exit 0 →
SUCCESS.

**The catch came from the judge-EXECUTED test, not from the LLM reading the
diff.** This is worth stating plainly because it is the thesis working as
designed:

- The LLM judge's *semantic* verdict on the seeded `return value;` was
  **PROCEED** — rationale *"work in progress, no regressions"*.
- Its rubric scored `no_unrelated_deletions` ✓, `no_secrets_introduced` ✓,
  `scope_matches_instruction` ✓ — **none of these captures behavioral
  correctness**, and the one-line bug deletes nothing, leaks nothing, and stays
  in scope. A diff-reading judge alone would have **waved the bug through.**
- Only `tests_pass` failed, because the judge **ran the acceptance test** and it
  went red. That executed check, via the deterministic override
  (`harness.ts:105`), is the entire catch.

→ This validates the CLAUDE.md invariant that *Agent-as-a-Judge runs tests /
inspects diffs — not text grading*. The running-tests half is what saved it. A
spec with no executable `check` would have let the seeded regression land on a
PROCEED. (No new WP — this is the design confirming itself; recorded so the
thesis isn't over-claimed as "the LLM judge spotted the bug.")

## Delivery quality (human review, post-landing)

Final harvested `clamp.ts` (19 lines) reviewed line-by-line against the goal's R1–R4 — **correct**:

- **R4 invalid range** ✓ — `if (min > max) throw new RangeError(...)` first, before any return.
- **R1 below floor** ✓ — `if (value < min) return min`.
- **R2 above ceiling** ✓ — `if (value > max) return max`.
- **R3 inside, inclusive** ✓ — falls through to `return value` (covers `value===min`, `value===max`, `min===max`).
- JSDoc present documenting inclusive bounds + the `min > max` throw. Named export, no default, strict ESM, pure, zero new deps.
- Test file encodes all 7 specified cases with the exact expected literals incl. the `RangeError` throw.

### Independent verification (re-run against the working tree, in devbox)

| Check | Result |
|---|---|
| AC-1 — grep `clamp(` + `RangeError` + `vitest run test/util/clamp.test.ts` | 🟢 6 passed, exit 0 |
| AC-2 — `tsc --noEmit && eslint . && vitest run` (full suite) | 🟢 427 passed \| 19 skipped, exit 0 |
| Harvest byte-diff (HEAD `5b6ca24` vs run workspace) | 🟢 both files **IDENTICAL** |
| Scope (`git show 5b6ca24 --stat`) | 🟢 exactly the 2 new files (+50 lines), nothing else |

Both ACs green independently. (AC-2's suite includes `verdict-gating.test.ts`'s
WP-244 unit proof `seedBadDiff ARMED: the seam corrupts step-1.txt, the judge
CATCHES it … run does NOT seal SUCCESS` — the unit-level twin of what this run
proved live.)

## Anomaly review

- **🔴 F-47 (new) — the WP-244 seam fires with ZERO journaled telemetry; the trace's `injections 0` actively masks the seeded catch.** Detail + WP below. This is the one real finding.
- **Wasted/filler steps:** none — both steps were productive (catch, then fix); no empty-diff probe (F-11 stays closed).
- **Cost telemetry:** nonzero USD on both steps + both judge passes; both models priced in `pricing.ts`; no `.00`-with-tokens gap; budget gate live ($1.1321 / $5).
- **⚠️ Token economics (record):** **525k input / 3.1k output at step 1** for a 19-line function — high read:write (~169:1), though below dogfood-045's 757k. Step 2 (the fix) read 327k. WP-203/WP-207 baseline data: the `codex` executor loads far more context than a clamp warrants.
- **Judge behavior:** judge-executed checks ran in-workspace and reported real exit codes (pass #1 `exited 1`/`exited 2`, pass #2 `exited 0`); no hallucinated concerns, no false ESCALATE/ROLLBACK; family diversity real.
- **Loop integrity:** 2 steps, each executed once, no resume, checkpoint chain consistent (`…@3` → `…@7`, both lastGood true), step-2 base = the corrupted blob (handoff intact), seam fired exactly once (`badDiffInjected` guard held — the step-2 fix was not re-corrupted), no duplicate journal entries.
- **Human ceremony:** launched once via the zero-secrets shim + the three `CHIKORY_SEED_BAD_DIFF_*` env vars, watched to terminal, harvested into `5b6ca24`. **Minor (no WP):** the harvest commit omitted the `Ref: run-id:` line, so `dogfood-verify.sh` §6 reported "no landed commit found" — the byte-diff in §-here confirms the landing manually; future harvests should carry the run-id ref so the verifier auto-links them.

## New friction

**F-47 — the WP-244 `seedBadDiff` seam fires without journaling anything, so the
run trace gives no evidence the catch was a *seeded* regression; the totals line
`injections 0` actively misleads.** Evidence: proving this run was a real
deterministic catch (and not just a natural "executor in-progress then fixes"
two-step) required hand byte-diffing three artifact blobs (`77bcb0` executor =
correct, `84e435` judge evidence = `return value;`, `dab2229` step-2 base =
corrupted) — none of it is visible in `chikory trace`. Root cause:

- The trace `injections` counter (`packages/sdk-ts/src/cli/trace.ts:168`) counts
  only journal entries of `kind === "injection"` — those are **operator-guidance
  prompt injections** (`executors/prompt.ts:33`), an unrelated mechanism. There
  were none, so it correctly reads 0 — but a reader sees "no injection happened"
  and concludes the seam never fired.
- The seam itself (`workflow/agent-loop.ts:317-322`) calls `activities.seedBadDiff(...)`
  and sets the in-memory `badDiffInjected = true` (`agent-loop.ts:107`) but
  **journals no entry** — the firing leaves no durable, replayable record.

This matters because the seam exists *specifically to make the catch provable on
demand* — a proof you cannot see in the trace is half a proof, and a reviewer
trusting the totals would wrongly downgrade a milestone catch to a routine
two-step.

→ **WP-245 (new): journal + surface the bad-diff seam firing.** When
`seedBadDiff` fires, write a durable journal entry (step index, target path,
content hash/byte count) — replay-safe, the seam value already rides the frozen
workflow input. Surface it in `chikory trace`: a per-step marker and a totals
line (e.g. `🧪 seeded bad diff @ step 0 → packages/sdk-ts/src/util/clamp.ts`),
and have `dogfood-verify.sh` flag a run that journaled a seam-firing so the
review pack states "deterministic judge-catch (seam armed)" instead of leaving it
to manual blob archaeology. Same telemetry-completeness family as the WP-243 park
seam (whose `cause:"debug"` budget event *is* journaled — the seedBadDiff seam
should match that bar).

## Verdict on the thesis

🟢 **PROVEN — and now reproducible.** The product's core promise — *a real-time
Agent-as-a-Judge catches a genuinely wrong code change before it lands* — is, for
the first time in 46 dogfoods, demonstrated **on demand** rather than by luck. The
WP-244 seam supplied a deterministic regression (`clamp` → `return value;`); the
cadence-1 judge ran the acceptance test, the test went red, the deterministic
override blocked the SUCCESS seal (the catch), and the executor read the judge's
failing-test feedback and restored a correct implementation → SUCCESS in 2 steps.
Family diversity was real (`codex`/`openai` executor vs Google
`gemini-3.1-pro-preview` judge), cost was trivial ($1.1321 / $5, judge 1.4%), and
the harvested delivery is byte-perfect and independently green. The DOGFOODING
§1.1 KPI ("regressions the judge caught pre-land") is sealed and forceable.

Two caveats keep this honest: **(1)** the catch came from the judge-*executed*
test, not the LLM's diff reading — the LLM verdict on the bug was PROCEED, so the
result confirms "the judge runs tests" rather than "the LLM spots bugs"; **(2)**
the seam's firing is invisible in the trace (**F-47 → WP-245**), so today the
proof survives only by manual blob byte-diffing. The standing token-economics red
flag (**525k input tokens** for a 19-line function) is logged as WP-203/WP-207
baseline data.
