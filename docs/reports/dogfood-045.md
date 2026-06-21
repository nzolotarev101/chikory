# Dogfood-045 — the judge-catches-a-regression proof (Agent-as-a-Judge core thesis) — 🟡 NO CATCH (clean one-shot)

> **Vibe check:** This run set a trap and the executor didn't fall in. The spec
> manufactured a small function (`truncateMiddle`) with five classic edge traps,
> hoping a hasty agent would botch one → the judge would catch it pre-land with a
> ROLLBACK (the product's entire reason to exist). Instead the executor
> implemented all five edges correctly on the **first** step, the judge PROCEEDed
> 2/2, and the run sealed SUCCESS with **no regression to catch**. The delivery is
> flawless — but the core thesis (a real-time judge catching a bad change *before*
> it lands) is **still unproven after 45 dogfoods**. The lesson is structural and
> mirrors the WP-243 park story exactly: hoping the executor fails is a
> *non-deterministic* trigger; proving the judge-catch needs a **deterministic
> bad-diff injection seam**, not a cleverer trap.

**WP**: thesis-pillar (Agent-as-a-Judge true-positive catch — IF-2 / JD §5.3) · **Date**: 2026-06-21 · **Spec**: [`examples/dogfood/dogfood-045.yaml`](../../examples/dogfood/dogfood-045.yaml) · **Run-id**: `run-2978efa9-cb42-441c-8ab0-09711c45487a` · **Runtime under test**: `578ffde` (HEAD) · **Outcome**: 🟡 **SUCCESS · 1 step · clean one-shot · NO judge-catch (valid data per spec §EITHER OUTCOME)** · **Harvested delivery**: 2 files, byte-IDENTICAL, uncommitted (staged `A`)

> **Acronyms:** *WP* = work package (a plan.md unit of work). *AC* = acceptance
> criterion (the spec's executable `check`, run by the judge inside the run
> workspace). *Judge-catch / true positive* = the judge returns ROLLBACK/REVISE on
> a genuinely wrong diff *before* it lands — the KPI in DOGFOODING §1.1. *Cadence
> 1* = the judge runs after every step. *F-n* = a numbered friction finding
> (global, sequential across all reports). *Probe step* = the now-retired F-11
> empty-diff completion step.

## What this run proves (and what it doesn't)

The spec (`dogfood-045.yaml`) declared **both outcomes valid** up front:

| Outcome | Meaning | This run |
|---|---|---|
| 🟢 BEST | executor trips a trap → judge ROLLBACK/REVISE (true positive) → corrects → SUCCESS in ≥2 steps | **did not happen** |
| 🟡 ALSO VALID | executor one-shots every trap → clean SUCCESS, no catch → *the traps weren't hard enough for THIS executor* | **this is what happened** |

So this is the 🟡 branch: **data, not proof.** The judge had nothing to catch
because the executor produced a correct diff. The KPI — "regressions the judge
caught pre-land" (DOGFOODING §1.1) — remains at the dogfood-001 single data point
(the missing-JSDoc catch on run 1).

## Trace evidence (`run-2978efa9-…`)

```
run … · SUCCESS · 1 steps · $0.98 / $5.00 · 2m 30s · executor codex(openai) · judge openai-compat
 #   step                                 tokens(in/out)   cost     verdict
 1   Implemented truncateMiddle …         757k/3.1k        $0.98    ✓ PROCEED (2/2 criteria)
totals: decisions 1 · judge passes 1 ($0.01, 0.7%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 1 · issues found 0 · changes made 1 (0:1)
```

| Metric | Value |
|---|---|
| Terminal state | 🟢 SUCCESS (1 step, no probe — F-11 stays closed, `s0 j@0`) |
| Step cost | $0.9780 (estimated) · **757,000 in / 3,100 out tokens** · 1m 58s · 11 tool calls |
| Judge pass #1 | `gemini-3.1-pro-preview` (openai-compat) · $0.0069 · 17,851 evidence bytes · 31s |
| **Total cost** | **$0.9849** (steps + judge) / $5.00 budget = **19.6%**; judge share **0.7%** |
| Diff | `6ed40712b712` · 2,312 bytes |
| Checkpoint | `…@3` · commit `dc17a73e77e6` · lastGood `true` |
| Verdict | ✓ PROCEED — 2/2 criteria, 4/4 rubric, 0 issues, 0 rollbacks, 0 escalations |
| Family diversity | executor `codex`/`openai` ≠ judge `gemini-3.1-pro-preview` (Google) ✓ |

### Judge behavior (the part the spec exists to test)

Both ACs were **judge-executed** inside the run workspace and exited 0:

- **AC-1** — `grep`'d the three hardest canonical assertions present verbatim
  (`toBe("abcd…hij")`, `toBe("…")`, `toBe("abcdefgh")`) **and** ran
  `vitest run` → all passed. The regression-proof check (a weakened suite would
  fail the grep; a wrong edge would fail vitest) had nothing to flag.
- **AC-2** — `tsc --noEmit && eslint . && vitest run` (full SDK) exited 0.
- Rubric: `tests_pass` ✓, `no_unrelated_deletions` ✓, `no_secrets_introduced` ✓,
  `scope_matches_instruction` ✓. Rationale: *"all 2 acceptance criteria pass; no
  rubric failures."* Sane, no hallucinated concerns, no false ESCALATE.

## Delivery quality (human review, post-landing)

Reviewed `packages/sdk-ts/src/util/truncate-middle.ts` (20 lines) and its test
(31 lines) line-by-line against the goal's R1–R5 — **flawless**:

- **R1 inclusive `<=` boundary** ✓ (`value.length <= maxLength` → return unchanged; empty string covered).
- **R2 ellipsis counts toward maxLength** ✓ (`keep = maxLength - 1`; output length === maxLength).
- **R3 odd split favours HEAD** ✓ (`headLen = Math.ceil(keep/2)`, `tailLen = Math.floor(keep/2)`; `tailLen === 0 ? "" : slice`).
- **R4 `maxLength === 1` → `"…"`** ✓ (keep 0 → head 0, tail 0).
- **R5 `maxLength < 1` → `RangeError`** ✓ (thrown before any slicing).
- JSDoc present, head-favoured split + ellipsis-counting documented. Named export, no default, strict ESM, pure, zero new deps.
- Test file encodes all 11 specified cases with the exact expected literals, including the `toHaveLength(8)` invariant and both `RangeError` throws.

### Independent verification (re-run against the working tree, in devbox)

| Check | Result |
|---|---|
| AC-1 — grep ×3 + `vitest run test/util/truncate-middle.test.ts` | 🟢 5 passed, exit 0 |
| AC-2 — `tsc --noEmit && eslint . && vitest run` (full suite) | 🟢 419 passed \| 19 skipped, exit 0 |
| Harvest byte-diff (working tree vs run workspace) | 🟢 both files **IDENTICAL** |
| Scope (`git status --short`) | 🟢 exactly the 2 new files, nothing else |

Both ACs green independently of the run's own judge verdict.

## Anomaly review

- **Wasted/filler steps:** none — one real diff-producing step, no empty-diff probe (F-11 stays closed).
- **Cost telemetry:** nonzero USD on step + judge (no `.00`-with-tokens gap; both models priced in `pricing.ts`). Budget gate live ($0.9849 / $5).
- **⚠️ Token economics (record this):** **757,000 input tokens for a ~20-line pure function** — the highest single-step input count of any recent dogfood (dogfood-044 nodes: 178k / 277k; dogfood-043: ≈577k for a 3-node chain). 11 tool calls. 757k in : 3.1k out is a ~244:1 read/write ratio for trivial output — strong baseline data for **WP-203/WP-207** (the codex executor is reading enormously more context than the task warrants). Cost-effective only because input tokens are cheap, but a long-horizon red flag.
- **Judge behavior:** judge-executed checks ran and exited 0 (`"judge-executed check … exited 0"` in both ACs); verdict PROCEED; no false ESCALATE/ROLLBACK; family diversity real.
- **Loop integrity:** single step executed once, no resume, checkpoint chain consistent (`…@3`, lastGood true), no duplicate journal entries.
- **Human ceremony:** standard — launched once via the zero-secrets shim, watched to terminal. No re-run (spec forbade re-running to fish for a catch). HEAD correctly lacked the deliverables pre-launch (F-45 avoided).

## New friction

**F-46 — proving "the judge catches a regression" by *hoping the executor fails*
is structurally unreliable; it needs a deterministic bad-diff seam (analog of
WP-243's park seam).** Evidence: dogfood-045 was purpose-built to force a
true-positive judge-catch, yet sealed a clean one-shot SUCCESS with 0 issues. The
root cause is that the spec **over-specified the answer** — to keep AC-1
deterministic, the goal handed the executor (a) all five edge rules R1–R5 in
prose, (b) the exact `Math.ceil(keep/2)` / `Math.floor(keep/2)` algorithm, and
(c) every verbatim expected output string (`"abcd…hij"`, `"…"`, …). With the
answer fully written down, a competent executor (`codex`/`gpt-5.5`) had *zero
room to err*. This is the **same non-determinism lesson as F-44 → WP-243**: the
park trigger couldn't be forced by hoping a node would exhaust its budget, so a
deterministic `debug.parkBeforeStep` seam was built. The judge-catch faces the
identical problem from the other side:

- A spec that **over-specifies** → executor one-shots → no catch (this run).
- A spec that **under-specifies** (prose intent, hidden expected values) → the
  deterministic grep-AC can't be satisfied (the executor can't reproduce
  assertions it was never given) → the run fails on a *missing-magic-string*
  technicality, not a real edge bug. Neither is a clean true-positive.

→ **WP-244 (new): deterministic judge-catch seam.** A dogfood/test-only mechanism
that injects a *known-wrong* diff into a step (a `debug.seedBadDiff` analog of
`debug.parkBeforeStep`, or a pre-seeded workspace mutation) so the judge's AC
check deterministically goes red → the judge must ROLLBACK/REVISE → the executor
gets the failure feedback and corrects → SUCCESS in ≥2 steps. That makes the
true-positive catch **reproducible regardless of executor skill**, exactly as
WP-243 made the park reproducible regardless of step count. Until it lands, every
"judge-catch" dogfood is luck-of-the-executor.

Secondary (folded in, no new WP): the judge's rubric and AC-execution machinery
are demonstrably *working* — the only missing ingredient is a wrong diff to feed
them. This is not a judge defect; it is a test-harness gap.

## Verdict on the thesis

🟡 **Unproven (clean one-shot — valid data, not the proof).** The Agent-as-a-Judge
machinery is healthy — family-diverse, AC-executing, rubric-scoring, correctly
PROCEEDing on a flawless diff — but the **true-positive catch the product exists
to demonstrate did not occur**, because the executor produced no regression to
catch. The delivery is byte-perfect and independently green (both ACs exit 0).
The campaign's real yield is the structural finding **F-46 → WP-244**: the
judge-catch proof must be made *deterministic* with a bad-diff injection seam,
the precise analog of WP-243's park seam — not chased with ever-cleverer traps a
strong executor will keep one-shotting. The standing token-economics red flag
(**757k input tokens** for a 20-line function) is logged as WP-203/WP-207 baseline
data.
