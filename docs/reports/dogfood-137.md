# dogfood-137 — a killed test suite no longer condemns the code, and the repair brief now budgets for its own evidence

**WP:** WP-612 (an infra kill is not a code red at the seal) + WP-614 (a repair brief reserves room for the failing tests) · **Date:** 2026-08-12 ·
**Spec:** `examples/dogfood/dogfood-137-wp612-wp614-infra-kill-and-reserved-brief.yaml` ·
**Run:** `run-308cc0d4-e7ae-4676-a251-eb4c9d940426` · **Landed:** this review's commit ·
**Ladder:** rung 0 (off-ladder by declaration) — P3 exit gate is rung 5 (WP-530 moat ladder), still operator-blocked

## Plain lead

The gate that runs a project's own tests before letting a run call itself finished used to
fail the run outright when that test command was merely slow, and it could only ever wait
120 seconds. Both are fixed: a killed command is now treated as inconclusive rather than as
proof the code is broken, a spec can name its own timeout, and the failing-test text handed
to the repair step is budgeted so it survives alongside other findings.

The delivery is correct on all four goal clauses and the full suite is green — but **the new
budgeting arithmetic had an off-by-one that made the brief 23× larger than the cap it was
built to respect**, in a window the run's own acceptance criteria could not reach. Found by
hand, proven, fixed this sitting.

## Trace

| field | value |
|---|---|
| terminal | 🟢 SUCCESS · 1 step · 7m 0s |
| cost | **$0.1095** of $20 budget (**0.5%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — cost meter blind (unpriced, CLI-OAuth; DOGFOODING §7 known false alarm) |
| judge | `openai-compat` (`gpt-5.6-sol` xhigh) · 2 passes |
| verdicts | rollbacks 0 · escalations 0 · resumes 0 |
| checkpoints | 1 · injections 0 |
| acceptance | AC-1 PASS · AC-2 PASS (re-run in the working tree (brownfield — harvested delivery)) |
| harvest | 11/11 files byte-**IDENTICAL** to the run workspace |

**Per-step:**

| # | tokens in/out | cost | wall | verdict |
|---|---|---|---|---|
| 1 | 4.4k/945 | $0.0000 | 5m 8s | ✓ PROCEED (2/2 criteria) |

No empty-diff probe step — **F-11 (wasted probe step) did not recur**.

**Second live proof of the WP-609 gate, first of WP-613.** Judge pass #1 (per-step) carries
**no** `pre_existing_suite_still_green` row at all; judge pass #2 (the completion review)
carries exactly one, settled from a real exit code —
`regression suite command \`pnpm --filter @chikory/sdk exec vitest run test/judge test/workflow\` exited 0`.
That is the WP-613 (no unmeasured green row) invariant holding on a live run for the first
time, and the WP-609 (regression-suite seal gate) machinery settling from real evidence for
the second.

## Delivery quality (human review, post-landing)

**Landed files (11, all byte-identical to the run workspace):**

| file | lines | what |
|---|---|---|
| `packages/sdk-ts/src/types.ts` | +5 | `checkTimeoutMs?: number` on `TaskSpec` — CORE layer, no new import |
| `packages/sdk-ts/src/schemas.ts` | +1 | workflow round-trip field on `TaskSpecSchema` |
| `packages/sdk-ts/src/taskspec.ts` | +7 | `check_timeout_ms` / `checkTimeoutMs` on the strict public YAML surface |
| `packages/sdk-ts/src/chain/node-spec.ts` | +6 | chain templating — also backfills `regressionSuite` into `planNodeToTaskSpec` |
| `packages/sdk-ts/src/runner/activities.ts` | +1 | forwards `spec.checkTimeoutMs` to the judge pass |
| `packages/sdk-ts/src/workflow/agent-loop.ts` | +2/-2 | the seal filter: `&& f.infraFailed !== true` on both paths |
| `packages/sdk-ts/src/judge/harness.ts` | +1/-2 | drops the 1000-char excerpt bound at the settle site |
| `packages/sdk-ts/src/workflow/completion-review.ts` | +81/-24 | the reserved-room budget |
| `packages/sdk-ts/test/judge/deterministic-rubric-oracle.test.ts` | +121 | AC-1 assertions |
| `packages/sdk-ts/test/runner/regression-suite-repair-live.test.ts` | +53/-53 | AC-2 live scenarios |
| `packages/sdk-ts/test/cli/chain-stale-template.test.ts` | +2 | new field in the F-220 completeness template |

**The goal, clause by clause:**

| clause | verdict | evidence |
|---|---|---|
| A killed check is inconclusive at the seal | 🟡 **partial** | `agent-loop.ts:1103,1122` filter `infraFailed` out of `deterministicFails` on **both** seal paths — the FAILED seal is correctly withdrawn. But the outcome does **not** say DID NOT COMPLETE → **F-327** |
| the row stays a non-pass carrying `infraFailed: true` | 🟢 | probed: `applyCheckOverrides` returns `{pass: false, infraFailed: true}`; trap A rejected |
| a genuine red still seals FAILED | 🟢 | AC-2 scenario 2 drives a REAL Temporal run to `deterministic rubric failure`; trap B rejected |
| a spec chooses its own per-check cap | 🟢 | parses both naming forms, survives the `schemas.ts` round-trip, reaches `collectEvidence`; AC-2 scenario 1 times a **real** kill at a declared 3000 ms against a 30 s command; trap C rejected |
| absent → 120 s default unchanged | 🟢 | `DEFAULT_CHECK_TIMEOUT_MS === 120_000` and `COMPLETION_BRIEF_MAX_CHARS === 2000` both pinned; trap D rejected |
| the brief RESERVES room | 🔴 **defective as landed** | correct in the swept region, **46,095 chars** in a reachable window → **F-326**, hand-fixed |
| every other failing finding survives | 🟢 | `otherFailLines` are never truncated to make room; trap E rejected |
| the excerpt still names failing tests | 🟢 | tail-anchored slice; trap F rejected |

**Scope discipline** 🟢 — exactly the 11 files the goal entails, no new dependency, no
provider SDK, no key. `src/types.ts` gains a field and a doc comment only; the deterministic
architecture scan confirms no `core→judge/workflow/runner` import. The one test whose
expectation changed (`chain-stale-template.test.ts`) was **extended, not weakened**: the new
field was added to `COMPLETE_TEMPLATE` *and* to the expected gap list, so the F-220 staleness
gate still fires on an incomplete template.

**Independently verified what the ACs took on trust:**

- **Full suite, run by hand:** `Test Files 175 passed | 2 skipped (177)` · `Tests 1351 passed | 23 skipped (1374)` · 52.54 s. The executor's summary claimed `175 / 2 (177)` and `1351 / 23 (1374)` — **exact match**. Contrast dogfood-134, where a green claim rode a red suite (F-3xx lineage). Honest reporting this run.
- **`pnpm run lint`** and **`pnpm run typecheck`** re-run clean.
- **The seal reason on a cap-killed suite** — driven on a real Temporal run (probe deleted after the review), see F-327.
- **The brief's cap under a length sweep** — see F-326.

**Judge behaviour** 🟡 — both judge-executed checks genuinely ran (`exited 0`), rubric
justifications are specific and accurate, family diversity is real (executor `gemini-cli`,
judge `openai-compat`, structurally different families). But the judge passed
`design_serves_overall_goal` with prose that *describes the exact mechanism that was broken* —
"preserves raw collected evidence until the brief's actual remaining budget is known" — without
ever testing the boundary of that budget. **0 true positives this run.**

## New friction

Highest prior friction id = **F-325**. Continue at **F-326**.

### 🔴 F-326 — the "reserved room" brief overflows its own cap by 23×

`String.prototype.slice(-0)` is `slice(0)` — the **whole** string, not the empty one. In
`completion-review.ts` the excerpt budget was `sliceLen = Math.max(0, availableForLog - 2)`,
and the function's final `return finalLines.join("\n")` had **no cap check at all**. So
whenever the fixed part of the brief (header + other failing findings + suite header +
closing line) lands within 4 characters of the 2000-char cap, the budget collapses to zero
and the *entire* suite output is emitted instead of nothing.

**Measured against the built artifact as landed** (44,092-byte suite output, one design
finding, sweeping its justification length 1000→2200):

| design justification length | brief length | cap |
|---|---|---|
| 1477 | 2000 | 2000 |
| **1478 – 1481** | **46,092 – 46,095** | 2000 |
| 1482 | 2000 | 2000 |

The window is narrow in one dimension but trivially reachable in practice: it depends on the
**sum** of the other failing findings, and this run's own judge wrote design justifications of
300–500 chars each — three of them lands squarely inside it. The output goes straight into the
repair step's prompt, so the failure mode is a 46 KB context injection by the mechanism built
to enforce context discipline (CM-3).

Why neither oracle caught it: AC-1 swept the **count** dimension (0/1/2/3 co-occurring
findings) at a single fixed ~353-char justification; the executor's own test swept the same
counts at ~40 chars. The defect lives in the **length** dimension, which neither touched.

**Disposition: HAND-FIXED THIS SITTING.** `src/workflow/completion-review.ts:168-189` — the
no-log floor is hoisted into a `withoutLog()` local and returned whenever `sliceLen <= 0`;
`Math.max(0, …)` is gone so the zero case can no longer be mistaken for "slice nothing". New
regression test sweeps 1001 justification lengths and asserts the zero-budget window is
actually reached (`test/judge/deterministic-rubric-oracle.test.ts:363-393`). Gate suite
**20 files / 142 tests green** (was 138 pre-fix); re-probe reports `count over cap: 0`.

### 🟠 F-327 — a cap-killed regression suite seals SUCCESS and calls itself a "design finding"

The goal required: *"The run's outcome must say the check DID NOT COMPLETE rather than that
the code is broken."* The delivery removed the wrong seal but never added the right one.

Driven on a real Temporal run (`regressionSuite: "sleep 30; exit 0"`, `checkTimeoutMs: 3000`),
the journal's terminal entry reads verbatim:

```
{"status":"SUCCESS","reason":"completion review: design findings recorded — pre_existing_suite_still_green"}
```

`report.failure` is `undefined`. So an operator whose regression gate was **killed before it
finished** is told, on the run's one-line outcome, that a *design finding* was recorded — the
same string a run gets for a cosmetic architecture nit. The record is correct (the rubric row
carries `infraFailed: true` and a justification saying `DID NOT COMPLETE (killed at the
per-check cap) — infra failure, not a code red`) but the **outcome contradicts it**.

Root cause: `agent-loop.ts:1113-1118` and `:1132-1137` have only two branches — "deterministic
fail → FAILED" and "everything else → SUCCESS: design findings recorded". An infra-killed row
is neither, and falls through to the design-finding string.

AC-2 asserted only the **absence** (`not.toContain("deterministic rubric failure")`), never the
presence. This is the `ac-must-enumerate-input-families` failure mode at the *outcome* altitude:
a negative assertion cannot pin what the outcome should say.

**Disposition: → WP-615 (queued).**

### 🟠 F-328 — removing the excerpt bound unbounded two consumers that were never budgeted

To let the brief compute its own budget, `harness.ts:205-209` deleted the 1000-char bound and
now stores the **raw** suite output in the rubric row's justification (measured: **44,197
chars** for a 44 KB output; the ceiling is the 64 KB capture bound at `evidence.ts:203`). The
brief is now budgeted — but it is not the only reader:

- `src/judge/verdict.ts:44` `describe()` inlines every failing justification into the verdict
  **rationale**, and `:167-169` is exactly the branch a failing completion-review suite row
  takes (`work in progress, no regressions — no criteria evaluated; non-destructive rubric
  failures: …`). That rationale is written to the journal — the durable audit trail — and
  printed in full by `chikory trace` (`src/cli/trace.ts:501,505`).
- Net effect: a forensic string and an operator's terminal that were bounded at 1000 chars are
  now bounded at 64 KB — a 44× regression, on the exact CM-3 discipline WP-614 was built to
  protect.

Not hand-fixed: the right shape (a dedicated raw-output field on the evidence row vs. a
higher-but-still-bounded justification cap) is a design call, not a bug fix, and the blast
radius is bounded rather than unbounded.

**Disposition: → WP-616 (queued).**

### 🟡 F-329 — an acceptance criterion that enumerates one input dimension is blind to the other

F-326's real cause. AC-1 was explicitly built to close F-324 ("dogfood-136 drove only the 0
case") and did so — it drove 0/1/2/3 co-occurring findings. But it fixed the *justification
length* while varying the *count*, and the defect was a function of total length. The AC
family-enumeration rule (F-187/F-196/F-198 lineage) says to probe every input family; it needs
the sharper form: **for a check that computes a budget from a length, the length is an input
family and a single value is not a sweep.**

**Disposition: track-B note** — added to DOGFOODING §8 as an AC-authoring rule; the concrete
sweep is already in the suite as part of the F-326 hand-fix.

### 🟡 F-330 — `checkTimeoutMs` is not forwarded at the chain-level completion review

There are two `runJudgePass` call sites. `src/runner/activities.ts:1751` forwards the new
field; `src/chain/activities.ts:437` does not. Latent today — that pass is constructed with
`criteria: []`, `rubric: COMPLETION_REVIEW_RUBRIC` and no `regressionSuite`, so it executes no
checks. But `regressionSuite` **is** now in `CHAIN_TEMPLATE_FIELDS`, so the moment a chain-level
review gains a suite the declared cap is silently ignored and the 120 s default governs — the
F-283 unfed-pipeline shape, one call site later.

**Disposition: track-B note** — recorded in DOGFOODING §8 with the call site; fold into WP-615.

### ℹ️ F-306 recurrence (no new id) — the executor summary still opens with stale narration

The step summary begins with two near-duplicate in-progress lines:

```
We have launched `pnpm run test` in the background and will inspect the output once it finishes.
We have launched `pnpm run test` in the background and will inspect the output once it completes.
```

~195 of 3,880 summary bytes (**5%**), and because the trace index line is the summary's first
line, the run's one-line identity in `chikory trace` reads
`We have launched \`pnpm run test\` in…` rather than what was delivered. Exactly the
DOGFOODING §7 documented symptom. **WP-606 remains the fix; no new friction id.**

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-326 | 🔴 | `slice(-0)` returns the whole string + no final cap check → the 2000-char repair brief reaches 46,095 chars | **HAND-FIXED THIS SITTING** — `src/workflow/completion-review.ts:168-189`; +1 sweep test at `test/judge/deterministic-rubric-oracle.test.ts:363-393`; gate suite 142 green (was 138) |
| F-327 | 🟠 | a cap-killed suite seals `SUCCESS · "design findings recorded — pre_existing_suite_still_green"`; the outcome never says DID NOT COMPLETE | **→ WP-615 (queued)** |
| F-328 | 🟠 | dropping the 1000-char excerpt bound unbounded the verdict rationale + `chikory trace` to the 64 KB capture ceiling | **→ WP-616 (queued)** |
| F-329 | 🟡 | an AC that sweeps a count at one fixed length is blind to a length-dependent defect | **track-B note** — DOGFOODING §8 AC-authoring rule |
| F-330 | 🟡 | `checkTimeoutMs` unforwarded at `src/chain/activities.ts:437` (latent — that pass runs no checks today) | **track-B note** — fold into WP-615 |

## Verdict on the thesis

**Durable execution: 🟢.** One step, one checkpoint, zero resumes, zero rollbacks, harvest
byte-identical 11/11, workspace clean. AC-2 drove three **real** Temporal runs — including a
timed cap kill — and read its conclusions off real journals rather than off the delivery's own
claims. That is the standard the AC-arming discipline was built for and it held.

**Real-time judging: 🟡, and this is the standing caution.** The judge executed both checks,
scored six rubric items, and wrote an accurate description of the very code path that was
broken — then passed it. **Zero true positives on a delivery carrying one 🔴 and two 🟠.**

The pattern is now three runs deep and worth naming plainly: **the judge is bounded by the
acceptance criteria's imagination.** dogfood-136's AC drove one case and missed the
co-occurrence family (F-324). dogfood-137's AC closed *that* family and missed the length
family (F-326/F-329). Each AC correctly rejected every trap it was designed for; each shipped
a defect in the dimension it did not vary. Broadening an AC one family at a time, one run at a
time, is a losing race against a defect surface that is multi-dimensional.

**What the run proves for the product:** the regression-suite gate is now usable on a real
project — a slow suite no longer condemns the code, and the cap is the spec's to choose. That
removes the last stated blocker on declaring `regression_suite` widely. **What it does not
prove:** that the gate reports its own inconclusive state honestly (F-327), which is the
difference between a gate an operator can trust and one they must read the journal to
understand.

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | 1 step / 7m 0s | 4 steps (dogfood-135) over trailing 3 |
| kill → resume count | 0 | 0 over trailing 3 |
| judge true-positives pre-land | **0** | 1 over trailing 3 (135 = 1, 136 = 0, 137 = 0) |
| meta:product headline ratio | product | **0/3 harness-meta** — cap (≤1 per 3) not busted |
| per-step reliability (runs ≥5 steps) | n/a (<5 steps) | **94.7%** (9 rollbacks / 170 steps, 21 runs ≥5 steps) — target 99%+ |
| ladder rung vs exit gate | rung 0 (off-ladder) | P3 exit gate = rung 5; **7th consecutive off-ladder headline** |
