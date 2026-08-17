# dogfood-151 — "nobody counted" is now different from "it used none" (WP-626)

**WP:** WP-626 (a telemetry field the loop reasons about must not be structurally unobservable) · **Date:** 2026-08-17 ·
**Spec:** `examples/dogfood/dogfood-151-wp626-unobservable-tool-count.yaml` ·
**Run:** `run-7faebdb5-7164-4931-9b9e-056b0d175091` · **Landed:** this review's commit ·
**Ladder:** rung 0 (off-ladder) — P3's rung-5 (WP-530 moat ladder) remaining half is `brownfield-001`/WP-304, operator-by-hand

## Plain lead

The agent Chikory actually runs cannot see how many tools it used, so its adapter
wrote `0` — and every screen downstream read that `0` as a measurement. After this
run the loop can say **"unknown"** instead, and the places that read the number
now branch on that. The run was **marked FAILED** by its own judge for a real gap
(one of the four readers was changed but nothing in the repo tested it), and human
review then found the bigger version of the same gap the judge missed: **a second
OTel span, the one every durable step emits, was still publishing `0` as fact.**
Both are fixed here.

## Trace

| field | value |
|---|---|
| terminal | 🔴 FAILED · 1 step · 8m 56s |
| cost | **$0.0958** of $20 budget (**0.5%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — **unpriced**: header reads `⚠ cost meter blind (unpriced tokens)`, 7,174 tokens metered at $0.0000 (keyless Antigravity OAuth, declared) |
| judge | `openai-compat` (codex `gpt-5.6-sol` xhigh via the shim) · 2 passes |
| verdicts | rollbacks 0 · escalations 1 · resumes 0 |
| checkpoints | 1 (`…@5`, `lastGood false`) · injections 0 |
| acceptance | AC-1 PASS · AC-2 PASS · AC-3 PASS (re-run in the working tree — brownfield, harvested delivery) |
| harvest | 12/12 files byte-**IDENTICAL** to the run workspace |

**Per-step:**

| # | tokens in/out | cost | wall | verdict |
|---|---|---|---|---|
| 1 | 4.7k/2.5k | $0.0000 | 5m 57s | ⚠ ESCALATE |

No empty-diff probe step — **F-11 (wasted probe step) did not recur**.

**Why the run sealed FAILED.** Judge pass #1 passed all 6 rubric rows and all 3
judge-executed checks, then raised one concern *outside* the rubric → `ESCALATE`.
The spec's `unattended: escalation: seal_resumable_failed` (F-322) routed that to
a completion review instead of parking overnight. Pass #2 upheld the concern
(`escalation_concerns_adjudicated: ✗`) and the loop condemned. **That path is
by design, not a defect** — `workflow/agent-loop.ts:462-475` states it: a
surviving finding on a converged step CONDEMNS rather than buying a repair
attempt, because dogfood-121 lost a 5-node chain to a step re-raising the same
concern forever. The seal is resumable.

## Delivery quality (human review, post-landing)

**Landed diff (14 files, +162/−9), all inside the goal's named surface:**

| surface | file | what landed | verdict |
|---|---|---|---|
| contract | `packages/sdk-ts/src/types.ts:422` | `toolCallsObserved?: boolean` added; `toolCalls` still `number` | 🟢 |
| contract mirror | `docs/spec/CONTRACTS.md:155` · `docs/components/executors.md:46` | both third-copy mirrors updated | 🟢 |
| runtime mirror | `packages/sdk-ts/src/schemas.ts:440` | `z.boolean().optional()` on the `.strict()` `StepRecordSchema` | 🟢 |
| adapter (blind) | `packages/sdk-ts/src/executors/gemini-cli.ts:80` | `toolCallsObserved: false`, count **not** fabricated | 🟢 |
| adapters (counting) | `claude-code.ts` · `codex.ts` | unchanged, still report real counts unmarked | 🟢 |
| carrier | `packages/sdk-ts/src/executors/step.ts:42,160` | `ParsedCliResult` carries the mark; `runCliStep` puts it on the record incl. the cap-kill path | 🟢 |
| reader 1 — rate basis | `packages/sdk-ts/src/runner/killed-step-usage.ts:64` · `runner/activities.ts:1561` | prior steps filtered on the **mark**, not the value | 🟢 |
| reader 2 — trace | `packages/sdk-ts/src/cli/trace.ts:470` | `unknown tool calls`; observed zero + unmarked historical render byte-identically | 🟢 |
| reader 3 — span (executor) | `packages/sdk-ts/src/executors/step.ts:84` | `tool.calls` attribute omitted when unobserved | 🟢 code, 🔴 untested → **F-377** |
| reader 4 — span (runner) | `packages/sdk-ts/src/otel.ts:238` | **NOT CHANGED by the run — still published `tool.calls: 0`; guarded in this review** | 🔴 **F-376** |

**Designed traps — all four the ACs targeted were rejected:**

| trap | the plausible-but-wrong delivery | outcome |
|---|---|---|
| A — fabricate | invent a count for the blind adapter | 🟢 rejected — `toolCalls: 0` kept, mark carries the unknown |
| B — uniform | render every `0` as unknown | 🟢 rejected — observed zero byte-identical (`test/cli/trace.test.ts:766`) |
| C — retype | change `toolCalls` to `number \| null` | 🟢 rejected — additive optional, both mirrors intact |
| D — mark everything | mark the counting adapters unobserved too | 🟢 rejected — `claude-code`/`codex` left unmarked and asserted so |
| F — token half | "fix" `isBlindMeteredStep`'s zero-token conjunct | 🟢 rejected — byte-unchanged |

**Independent verification (not taken on the run's word):**

- Declared regression suite re-run by hand (F-342 — never transcribe):
  `pnpm --filter @chikory/sdk exec vitest run` → **194 files / 1560 tests
  (1537 passed | 23 skipped) in 66.29s**. Launch baseline in the spec was
  193 files / 1551 tests (1528 passed | 23 skipped) in 65.60s. Delivery alone
  = 193 files / 1556 (+5 tests); this review's hand-fix adds the 194th file and
  4 more.
- Existing tests were **strengthened, not weakened** — `claude-code.test.ts` and
  `codex.test.ts` keep their exact counts (3 and 2) and add an
  `toolCallsObserved === undefined` assertion; nothing was deleted or made
  tautological.
- Every uncovered behaviour the goal named as "yours to pin" was pinned:
  nonzero-unobserved prior refused (`test/runner/killed-step-usage.test.ts:74`)
  and the cap-kill record carrying the mark
  (`test/executors/gemini-cli.test.ts:181`) — the second parses through
  `StepRecordSchema` in the test, which is the honest proof the strict mirror
  accepts the field.
- **Scope discipline 🟢** — no file outside the goal's surface, no dependency
  added, the Python mirror (explicitly out of scope) untouched.

**Instruction deviation, non-harmful:** the goal said to verify with "vitest over
only the test files you touched"; the step ran the whole `test/runner/` +
`test/executors/` trees (48s of the 5m57s step) to read the durability floor
count. Slower than asked, and it produced the narration in F-306 below, but the
number it reported (477) matched the judge's independent re-run exactly.

## New friction

### F-376 🔴 — a second OTel span writer published the unobserved count as fact

`recordRunStepSpan` (`packages/sdk-ts/src/otel.ts:221`) — the `chikory.run.step`
span the **durable runner** emits after every step is journaled, called from four
sites in `runner/activities.ts` — still wrote `span.setAttribute("tool.calls", 0)`
for a record marked `toolCallsObserved: false`. The delivery guarded only the
executor-level `chikory.step` span in `executors/step.ts:84`.

**Live-proven, not reasoned:** a throwaway probe asserting the attribute is absent
on an unobserved record ran RED against the harvested tree at 17:05:35 —
`AssertionError: expected [ 'run.id', 'step.index', …(10) ] to not include 'tool.calls'`.

Two independent causes, both mine:

1. **The spec named one of two writers.** Its measured premise cited
   `src/executors/step.ts:82` as "the span". `src/otel.ts:238` is the *other* copy,
   and it is the one on the primary observability path.
2. **AC-3's grep-set had the same blind spot** — it asserted `toolCallsObserved`
   appears in `src/cli/trace.ts` and `src/executors/step.ts`, and never looked at
   `src/otel.ts`. An AC that enumerates reader sites is only as good as the grep
   that found them (the reader-mirror analogue of the contract-mirror rule).

**Disposition: HAND-FIXED THIS SITTING.** Guard at `packages/sdk-ts/src/otel.ts:237`;
pinned by `packages/sdk-ts/test/executors/step-span-observability.test.ts:97,111`
(unobserved omitted · observed zero and unmarked historical unchanged). No WP.

### F-377 🟡 — the judge's own concern: a changed reader with no repo test (TRUE POSITIVE)

The escalation, verbatim: *"The OpenTelemetry omission for unobserved counts is
implemented in recordStepSpan, but the shown committed test changes do not include
a focused assertion that the tool.calls attribute is absent."* Verified against the
tree — correct. Three of the four readers gained a repo test; the executor-level
span gained none, and the goal explicitly required repo-resident pinning (F-356).

This is a **genuine pre-land catch**: the judge condemned a delivery whose
behaviour was right but whose durability was not. It sits one file away from
F-376 — the judge questioned the test for the site that WAS fixed while an
unfixed sibling site sat inside the same diff's blast radius.

**Disposition: HAND-FIXED THIS SITTING.**
`packages/sdk-ts/test/executors/step-span-observability.test.ts:51,67` — both arms
drive the real adapter over the fake wire (not the private span helper), so a
refactor that stops threading the mark still fails here.

### F-378 🟡 — the mark-vs-value fix landed on the priors, not on the subject

`estimateKilledStepUsage` now excludes an unobserved **prior** from the rate basis
(`killed-step-usage.ts:64`), but its **subject** is still a bare number:
`killedToolCalls: number` (`killed-step-usage.ts:58`), called with only
`record.toolCalls` (`runner/activities.ts:1566`). An unobservable adapter reporting
a nonzero placeholder would have that placeholder multiplied by a real rate
(`:76-81`) — the same "estimate scaled off a guess" the goal forbids, at the other
end of the same function.

**Latent today**, and honestly so: the call is gated by `isBlindMeteredStep`, which
requires zero metered tokens, and `parseAgyOutput` always estimates non-zero
tokens. Not reachable under any adapter that exists. It becomes live the day one
does — the same conditional the spec used to justify the priors half.

**Disposition: → WP-633 (queued, track-B).**

### F-379 🟡 — a completion review that CONDEMNS prints `✓ PROCEED`

Operator-visible output, one line apart:

```
[16:38:23] verdict ✓ PROCEED (0/0 criteria) @ step 1
[16:38:23] ⚠️ terminal FAILED — completion review: unresolved finding on a converged step
```

The judge verdict object genuinely is PROCEED (0 criteria evaluated); the seal
comes from the rubric row. Both lines are true and the terminal line is adjacent,
so nothing is lost — but a review whose whole purpose is to condemn should not
lead with a green check.

**Disposition: track-B note** (reporting only, no behaviour change).

### F-306 recurrence 🟠 — executor summary still opens with live narration

The step summary's first four lines are `"I've launched the test run …"` /
`"Waiting for background tests to finish."` (twice) before any account of the
work. Already tracked → **WP-606**; recorded here as a live recurrence, since
that text rides into the judge's evidence and the pacing estimate. No new F.

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-376 | 🔴 | `chikory.run.step` span (`otel.ts:238`) still published `tool.calls: 0` for an unobserved count; probe-proven RED | **HAND-FIXED THIS SITTING** — `src/otel.ts:237`, pinned at `test/executors/step-span-observability.test.ts:97,111`; suite 1537 passed / 23 skipped |
| F-377 | 🟡 | judge true-positive: executor-level span omission had no repo test (the run's FAILED reason) | **HAND-FIXED THIS SITTING** — `test/executors/step-span-observability.test.ts:51,67` |
| F-378 | 🟡 | `estimateKilledStepUsage` takes the killed step's own count unmarked (`killed-step-usage.ts:58`, `activities.ts:1566`) | **→ WP-633 (queued)** |
| F-379 | 🟡 | condemning completion review prints `verdict ✓ PROCEED` one line before `terminal FAILED` | **track-B note** |

## Verdict on the thesis

- **Judging works, and it caught something.** First pre-land true positive since
  dogfood-149. The concern was specific, checkable, and correct, and the gate held
  the line at $0.096 — a rounding error against a $20 budget, 100% of it judge spend.
- **But the catch was one notch too shallow.** The judge asked "is the changed
  reader tested?" and never asked "are these all the readers?" That is the same
  altitude gap as F-373/374/375: the judge reasons over the diff it is shown, and
  an *unchanged* file cannot appear in a diff. Human review found F-376 by grepping
  the symbol across `src/`, which is not something the current judge form asks for.
- **The condemn-don't-repair gate is the right trade, and it costs a run.** The
  concern was ~30 lines of test. The loop spent 0 steps healing it because
  `agent-loop.ts:462-475` deliberately makes this gate terminal-or-nothing. The
  ledger records a FAILED run whose delivery was 90% correct and is landing.
- **Standing caution:** three consecutive campaigns have now shipped a defect in a
  *sibling* of the site the spec named (dogfood-150 ×3, dogfood-151 ×1). The spec's
  measured premise is doing the enumeration, and a premise written by grepping one
  call site enumerates one call site.

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | 1 step / 8m 56s | 3 steps (dogfood-149) over trailing 3 |
| kill → resume count | 0 | 0 over trailing 3 |
| judge true-positives pre-land | **1** (F-377) | 2 of last 3 runs (149, 151) |
| meta:product headline ratio | 0:1 (product) | **0:3** — cap ≤1 meta per 3 not busted |
| per-step reliability (runs ≥5 steps) | n/a (<5 steps) | 94.7% (9 rollbacks / 170 steps, 21 runs) — target 99%+ |
| ladder rung vs exit gate | rung 0 (off-ladder) | P3 rung-5 half-open; remaining half = WP-304, operator-by-hand |
