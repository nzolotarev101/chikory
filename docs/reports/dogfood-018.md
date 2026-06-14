# Dogfood-018 — WP-229 surface the ESCALATE reason in `--watch` (clean SUCCESS; F-27 closed)

**WP**: WP-229 · **Date**: 2026-06-14 · **Task spec**: [`examples/dogfood/dogfood-018.yaml`](../../examples/dogfood/dogfood-018.yaml) · **Run**: `run-59115f35-5b96-4a52-988d-ec5420f4796b` · **Outcome**: **SUCCESS** (judge PROCEED 3/3) · **Landed**: harvested + staged on `main`, pending commit

> Eighteenth campaign, seventeenth first-attempt SUCCESS, and a direct close on
> the friction the *previous* run made us feel: dogfood-017's operator watched a
> live ESCALATE with no reason on screen (F-27). dogfood-018 delivers WP-229 —
> `followRun` now renders `judge escalated: <reason>` on the `--watch` stream
> before the `AWAITING_APPROVAL` line. The diff matches the spec byte-for-byte,
> all three acceptance checks pass against the working tree, and the harvested
> files are byte-identical to the run workspace.

## The run

Zero-secrets setup unchanged from dogfood-002…017: Codex executor (OpenAI
family) and Gemini judge behind the local OpenAI-compatible shim. Family
diversity held (executor OpenAI ≠ judge Gemini).

```text
run run-59115f35... · SUCCESS · 2 steps · $1.28 / $5.00 · 5m 1s · executor codex(openai) · judge openai-compat
 1   Implemented WP-229 in exactly the two requested files   607k/3.5k  $0.79   (3329-byte diff)
 2   WP-229 is implemented in the two requested files         339k/2.2k  $0.45   ✓ PROCEED (3/3 criteria)
totals: decisions 2 · judge passes 1 ($0.04, 3.1%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 2 · issues found 0 · changes made 1 (0:1)
        components over time: s0 s1 j@1
```

All real work landed in step 1 (3329-byte diff). Step 2 produced an empty diff,
re-ran the suite, and summarized "WP-229 is implemented" — the recurring
completion-probe step (F-11, below). The judge ran once at the cadence-2
boundary (step 2), evaluated the **cumulative** workspace diff (3329 bytes — the
full step-1 change, not the empty step-2 diff), and PROCEEDed 3/3.

## Delivery quality (human review, post-landing)

The landed diff is exactly what the spec dictated — two files, additive only:

- **`commands.ts`** — inside `followRun`'s `drainJournal()` closure, the
  `entry.kind === "verdict"` branch widens the payload cast to
  `{ verdict: { kind: string; escalateReason?: string } }`, and for an
  `ESCALATE` verdict reads `const reason = payload.verdict.escalateReason`,
  emitting `judge escalated: ${reason}` **before** the existing
  `AWAITING_APPROVAL` line — guarded on `typeof reason === "string" &&
  reason.length > 0`, so an ESCALATE with no reason prints no extra line. The
  existing AWAITING_APPROVAL line, every other branch, the cursor, the `finally`
  close, and the double drain are byte-for-byte unchanged.
- **`cli.test.ts`** — one new deterministic test, "watch surfaces the judge
  escalate reason before the AWAITING_APPROVAL line", mirrors the final-drain
  test's setup (temp dataDir, empty journal, fake `RunHandle` whose `status()`
  appends one `ESCALATE` verdict with `escalateReason: "diff missing the
  required changes"` and returns terminal FAILED). It asserts the
  `judge escalated: …` line appears exactly once and at an earlier index than
  the AWAITING_APPROVAL line. The existing final-drain test (the
  no-`escalateReason` path) is untouched and still asserts no `judge escalated:`
  line.

Independent verification (working tree, this review):

- **AC-1** (`vitest run test/cli/cli.test.ts`) — 7 passed (was 6; +1 is this slice).
- **AC-2** (full SDK suite) — 236 passed, 19 skipped.
- **AC-3** (typecheck + lint) — both clean.
- Scope discipline: `git status --short` shows only the two named files. Harvest
  byte-diff: both **IDENTICAL** to the run workspace. No new deps, no contract /
  type / journal / workflow / runner change. Goal honored line-by-line.

**F-27 is closed.** The live operator now sees the judge's reason in place and
can decide approve-vs-reject without dropping to `chikory trace` / `journal.db`.

## New friction

**F-28 — The spec dictated the implementation to the keystroke; the executor's
job collapsed from engineering to transcription.** dogfood-018's `goal` named
not just the two files, symbols, and the test's assertions (correct, per
DOGFOODING §3) but the *literal code*: the exact cast text, the variable name
`reason`, the exact guard `typeof reason === "string" && reason.length > 0`, and
the exact emitted string. The executor had no design decision left to make — it
transcribed prose into TypeScript. That is why step 1's diff matches the spec
byte-for-byte. This is fine for *shipping a one-liner safely*, but a campaign of
keystroke-dictated specs stops being evidence for the thesis (long-horizon
agent **autonomy** + the judge catching real divergence) and becomes a
transcription-fidelity test — the judge can only ever confirm the human's own
code. dogfood-017's redundant-spec failure was the sharp end of the same drift
(the human had already written the change, by hand). → **No code WP.** Operating
guidance now in DOGFOODING §3: specs name the *what* (files, symbol signatures,
behavior, the tests and their assertions) and leave the *how* (the code body) to
the executor, so each run actually exercises agent judgment and gives the judge
something independent to grade. The reviewer (this report's author) holds the
next spec to that bar (dogfood-019 below).

Recurrences and baseline:

- **F-11 recurred (seventeenth data point).** Step 2 was the empty-diff
  completion probe — 0 bytes, 339k input tokens, $0.4457, **34.8% of run cost**,
  at the very top of the historical 5.4 %–35.1 % spread. The productive step
  (step 1) signaled no completion, so the loop took a second, redundant step
  whose only output was re-running tests the judge then re-ran again. This is
  exactly what **WP-221** (OR the executor's `claimsComplete` into the WP-217
  empty-diff judge trigger so the *productive* step is judged directly) exists
  to remove — and dogfood-019 delivers its pure trigger half. No new WP.
- **Token economics**: step 1 burned 607k input tokens / $0.79 to produce a
  3329-byte diff (a ~10-line source change + a ~60-line test). High input
  relative to output, consistent with codex repo-search overhead on a small
  edit; well under budget (25.6 % of $5).
- **WP-229's live path stayed unexercised by its own run** (no WP). dogfood-018
  PROCEEDed, so the new `judge escalated:` rendering never fired during the run
  that delivered it — it is covered only by the new deterministic unit test
  (which is rigorous: presence, exactly-once, and ordering). The first live
  proof will come the next time a watched run genuinely ESCALATEs.

## Verdict on the thesis (eighteenth data point — the loop closes its own friction)

- **The dogfood loop is now self-correcting at the process layer.** dogfood-017
  felt F-27 (no reason on the watch stream); dogfood-018 shipped the fix and the
  operator transparency is real. The friction-to-WP-to-delivery cycle ran end to
  end in one campaign.
- **The judge behaved correctly on a clean run**: it graded the cumulative diff
  (not the empty probe-step diff), confirmed 3/3 acceptance criteria and 4/4
  rubric items, and PROCEEDed. No false ESCALATE on legitimate work — the
  complement to dogfood-017's true-positive ESCALATE on illegitimate work.
- **Loop integrity held**: two checkpoints, `lastGood` flips true only at the
  PROCEED'd step, no duplicate journal entries, no re-execution.
- **The honest limitation this run exposes is methodological, not technical**
  (F-28): over-prescribed specs under-test the thesis. The engine is reliable;
  the campaign's evidentiary value now depends on giving the executor real
  decisions to make. dogfood-019 (WP-221 trigger) is a genuine behavioral change
  with a non-obvious correctness condition — a better test of the loop.
- Next: dogfood-019 delivers WP-221's pure judge-trigger half (extract the
  completion-milestone predicate, OR in `claimsComplete`), the direct fix for
  the F-11 probe-step waste this run paid 34.8 % for.
