# Dogfood-017 - WP-227 final journal drain (redundant spec; judge ESCALATE true-positive)

**WP**: WP-227 · **Date**: 2026-06-13 · **Task spec**: [`examples/dogfood/dogfood-017.yaml`](../../examples/dogfood/dogfood-017.yaml) · **Run**: `run-19c25609-6ab5-4c37-8f94-e1a3161cc27d` · **Outcome**: **FAILED** (escalation rejected) · **WP-227 itself**: already landed by hand in `26b9964` before the run

> Seventeenth dogfood campaign and the **first non-SUCCESS** — and it is the
> strongest single data point for the thesis so far. WP-227 had already been
> implemented and committed by hand (`26b9964`, "ensure final journal entries
> are drained upon run completion") four hours before this spec launched. The
> spec was never retired, so the executor ran against a baseline that already
> satisfied the goal. It produced an essentially empty diff yet **claimed in its
> step summary that it had exported `followRun`, added the regression test, and
> verified everything**. All three acceptance checks and all four rubric items
> passed — a pure text/test grader would have sealed SUCCESS. The Gemini judge
> cross-checked the claim against the actual diff, saw the diff was empty, and
> ⚠ ESCALATEd. The run was rejected. The judge caught a hallucinated completion
> that every green signal endorsed.

## The run

Zero-secrets setup matched dogfood-002...016: Codex executor (OpenAI family)
and Gemini judge behind the local OpenAI-compatible shim. Family diversity held
(executor OpenAI ≠ judge Gemini).

```text
run run-19c25609... · FAILED · 2 steps · $1.41 / $5.00 · 2h 29m · executor codex(openai) · judge openai-compat
 1   Implemented WP-227: Exported `followRun`...     807k/3.5k  $1.04   (583-byte diff)
 2   WP-227 is implemented as specified...           219k/1.8k  $0.29   ⚠ ESCALATE (0-byte diff)
totals: decisions 2 · judge passes 1 ($0.08, 5.4%) · rollbacks 0 · escalations 1
        checkpoints 2 · issues found 1 · changes made 1
failed: judge escalation rejected — "diff entirely missing the required logic
        changes in commands.ts and the new test case; executor claims complete
        but the changes were not captured in the diff."
```

The 2h 29m wall-clock is human think-time: the run sat in `AWAITING_APPROVAL`
from 23:21 until the reject at 01:46. Productive executor+judge time was ~5 min.

### Why the spec was redundant

dogfood-016 surfaced F-23 and queued WP-227. Between that report and this
launch, WP-227 was implemented and committed by hand as `26b9964` (three files,
+101/-33). `git log -S` confirms both the `export async function followRun`
refactor and the `"final drain renders a transition appended during terminal
status()"` regression test were introduced by that commit. The run's baseline
diff was therefore taken `since 26b99641917d` — a tree that already contained the
entire deliverable. There was nothing for the executor to do.

## Delivery quality (human review, post-run)

There is no delivery to land — the run was rejected and the working tree is
clean (`git status` empty, HEAD still `26b9964`). WP-227's actual delivery lives
in `26b9964` and is independently green:

- **AC-1** (`vitest run test/cli/cli.test.ts`) - 6 passed.
- **AC-2** (full SDK suite) - 235 passed, 19 skipped.
- **AC-3** (typecheck + lint) - both clean.
- The required symbols are present: `commands.ts:90` `export async function
  followRun`, the `drainJournal()` closure, the double drain at lines 135/138,
  and the regression test at `cli.test.ts:293`. WP-227 is genuinely done.

## New friction

**F-25 - A superseded dogfood spec was launched against an already-satisfied
baseline.** WP-227 landed by hand in `26b9964` at 19:16; dogfood-017 launched at
23:16 without the spec being retired. The executor had no work, produced a
~empty diff, and the campaign failed. The dogfood-assessor and the launch path
have no guard that the target WP is still un-done at HEAD. -> **WP-228**: a
launch-time baseline precheck — before step 1, run the spec's acceptance
`check`s against the clean baseline; if they already all pass, warn (or refuse)
that the goal may already be satisfied. Plus the operating rule now in
DOGFOODING §7: retire/supersede a dogfood spec the moment its WP lands by any
other path.

**F-26 - The executor narrated a completed deliverable over an empty diff
(hallucinated SUCCESS).** Step 1's summary states it "Exported `followRun` with
final terminal journal drain" and "Added deterministic regression test", with a
clean verification block — while its actual diff was 583 bytes (a single deleted
comment) and step 2's was 0 bytes. The summary describes the *spec narrative*,
not what the executor did. This is the empty-diff-vs-claim failure mode that
**WP-221** (completion-signal wiring over the frozen `claimsComplete` contract)
exists to police; this run is its sharpest motivating case. **No new WP** —
F-26 reinforces WP-221 and raises its priority. The decisive mitigation today is
the judge's diff-inspection, which worked (see thesis below).

**F-27 - The live `--watch` ESCALATE line drops the judge's reasoning.** The
operator watching the run saw only `verdict ⚠ ESCALATE @ step 2` and `run is
AWAITING_APPROVAL — answer with: chikory approve …`. The rich `escalateReason`
and `concerns[]` (the entire value of the judge) were written to the journal but
never rendered; deciding approve-vs-reject required reading `journal.db` / a
`chikory trace`. `commands.ts:119-127` formats the AWAITING_APPROVAL line from
the verdict payload but discards `verdict.escalateReason`. -> **WP-229**: render
the escalate reason (and top concern) on the AWAITING_APPROVAL watch line.

Recurrences and baseline:

- **F-11 recurred** (sixteenth data point): step 2 was the empty-diff completion
  probe — 0 bytes, 219k input tokens, $0.2923, **20.7% of run cost**, the
  high end of the historical 5.4%-35.1% spread. Here both steps were effectively
  no-ops because the goal was pre-satisfied.
- **Token economics — an outlier**: step 1 burned **807k input tokens / $1.04**
  to delete one comment. With no real work to anchor on, the executor thrashed
  searching the repo for the (already-present) changes. This is the
  highest cost-per-byte step in the campaign and is an artifact of F-25, not
  normal executor behavior.
- **Operational gotcha (no WP)**: a deliberate human reject seals the run FAILED,
  so `chikory run --watch` exits non-zero and `devbox run dogfood` reports
  `exit status 1` and tears down services. Correct behavior, but visually
  indistinguishable from a crash — noted in DOGFOODING §7.

## Verdict on the thesis (seventeenth data point — the judge earns its place)

- **This is the value proposition demonstrated.** Every cheap signal was green:
  3/3 acceptance checks passed, 4/4 rubric items passed, the executor reported
  SUCCESS twice. A text grader or a tests-only gate **ships this**. The judge
  inspected the diff, found it empty against a claim of substantial change, and
  ESCALATEd. Agent-as-a-Judge in the inner loop, structurally different family,
  diff-grading not text-grading — exactly the design — is what stopped a phantom
  success from sealing.
- **The human-in-loop gate worked end to end**: ESCALATE -> AWAITING_APPROVAL ->
  durable checkpoint `@5` -> reject -> terminal FAILED with the reason recorded.
  The loop integrity held; no duplicate entries, no re-execution.
- **The failure was upstream of the engine**: a process miss (F-25) launched
  redundant work; the engine then behaved exactly as designed by refusing to
  bless it. The reliability lesson points at spec hygiene (F-25), executor
  honesty (F-26 -> WP-221), and observer transparency (F-27 -> WP-229), not at
  the judge or the durable runner.
- Next: dogfood-018 delivers WP-229 (surface the ESCALATE reason in `--watch`),
  the friction this very run made us feel; WP-221 and WP-228 follow.
