# Dogfood-032 — WP-231: dogfood landing-scope audit (SUCCESS after one true-positive ESCALATE; closes F-31)

**WP**: WP-231 (dogfood landing-scope audit) · **Date**: 2026-06-17 · **Task spec**: [`examples/dogfood/dogfood-032.yaml`](../../examples/dogfood/dogfood-032.yaml) · **Run**: `run-4f1fbe0a-1d63-407d-a170-c51a208319dc` · **Outcome**: **SUCCESS** (step 1 ESCALATE, step 2 PROCEED 3/3) · **Landed**: `ded282b`

> Thirty-second campaign, thirty-first first-attempt SUCCESS. This was the first
> run to intentionally close a post-landing audit gap rather than product
> runtime behavior. The judge made a useful first-pass catch: the initial
> verifier integration could have aborted under `set -e` when the new helper
> found a mismatch. Step 2 fixed that with `|| true`, keeping the mismatch visible
> while preserving the verifier's existing acceptance-check flow.

## The run

Zero-secrets setup unchanged: Codex executor (OpenAI family) + Gemini judge
behind the OpenAI-compatible shim. Family diversity held.

```text
run run-4f1fbe0a-1d63-407d-a170-c51a208319dc · SUCCESS · 2 steps · $0.80 / $5.00 · 10m 15s · executor codex(openai) · judge openai-compat
 1   Implemented the WP-231 landing-scop… 331k/7.8k  $0.49  ⚠ ESCALATE
 2   Implemented the judge feedback: `sc… 158k/1.7k  $0.21  ✓ PROCEED (3/3 criteria)
totals: decisions 2 · judge passes 2 ($0.09, 11.6%) · rollbacks 0 · escalations 1
        injections 0 · checkpoints 2 · feedback frequency 1/1 steps
        issues found 1 · changes made 2 (issues:changes 1:2)
        components over time: s0 j@0 s1 j@1
```

There was no empty-diff probe step. The second step was a real correction from
judge feedback, so F-11 did not recur.

## Delivery quality (human review, post-landing)

The delivered diff matches the spec's three-file scope:

- **`scripts/dogfood-landed-scope.sh`** (NEW) compares a run workspace's
  `chikory-base..HEAD` diff to a landed commit's diff against the same base.
  It prints stable labels for `MATCH`, `EXTRA_IN_COMMIT`, `MISSING_IN_COMMIT`,
  and `DIFFERS_FROM_RUN`, sorts path sets, returns 0 only on exact match, and
  handles explicit error cases for invalid workspaces, missing base commits, and
  invalid landed refs.
- **`scripts/dogfood-verify.sh`** now has a `## 6. Landed commit scope` section
  after the harvest byte-diff section. It reuses the existing `git log --grep
  "$RUN_ID"` harvest lookup when present. When no run-linked commit exists, it
  prints a manual helper command. When a linked commit exists, it runs the helper
  with `|| true`, so scope mismatches are report evidence rather than a verifier
  abort.
- **`scripts/test-dogfood-landed-scope.sh`** builds temporary git fixtures and
  covers exact match, extra path, missing path, and same-path-different-content
  cases.

Independent checks:

```text
AC-1 bash scripts/test-dogfood-landed-scope.sh                         PASS
AC-2 bash -n scripts/dogfood-verify.sh scripts/dogfood-landed-scope.sh scripts/test-dogfood-landed-scope.sh  PASS
manual landed-scope check against HEAD                                 MATCH
```

The manual landed-scope command had to be explicit because `ded282b` does not
cite the run-id, so `dogfood-verify` correctly reported no run-linked harvest
commit:

```text
bash scripts/dogfood-landed-scope.sh .chikory/runs/run-4f1fbe0a-1d63-407d-a170-c51a208319dc/workspace HEAD
MATCH
```

Scope discipline held: `HEAD` contains only the three requested script paths,
and the explicit helper comparison says the run workspace diff and `ded282b`
match. No product runtime, TypeScript SDK, schema, journal, router, judge,
executor prompt, Temporal workflow, dependency, or dogfood task/report changed
inside the run.

## New friction

No new friction numbers.

Other anomaly checks:

- **Wasted steps**: step 2 was not filler; it implemented the judge's abort-risk
  feedback. No empty-diff probe.
- **Cost telemetry**: exact sum $0.7979, budget used 16.0 %, judge share 11.6 %.
  No blind-meter warning.
- **Token economics**: step 1 used 331k input / 7.8k output for the 9149-byte
  initial diff; step 2 used 158k / 1.7k for the 603-byte correction. Total input
  was 489k, within the recent low-band sawtooth and still high enough to keep
  WP-207 runtime pacing relevant.
- **Judge behavior**: the first ESCALATE was a true positive outside the rubric;
  the final PROCEED correctly verified the guard. Checks executed under the
  judge both times.
- **Human ceremony**: single launch. The one manual action was supplying `HEAD`
  to the new helper because the landed commit message lacks the run-id; the
  helper exists precisely to make that fallback explicit.
- **Loop integrity**: two checkpoints, no rollback, no resume, no duplicate
  journal entries.

## Verdict on the thesis

- **F-31 is closed for dogfood review.** The review procedure now has a
  mechanical check for "what ran" vs "what landed"; a contaminated commit like
  dogfood-031's `67eb167` would now be visible as `EXTRA_IN_COMMIT`.
- **The judge improved the verifier before it landed.** Step 1 passed the stated
  acceptance checks, but the judge still caught a process-level abort risk that
  mattered to future reviews. That is the Agent-as-a-Judge thesis in miniature.
- **No new process finding emerged.** With WP-231 done, the queue can return to
  the standing Phase 2 work. The next dogfoodable slice is WP-205's CLI branch
  target parser, setting up `chikory branch <run-id>@<step>` without touching
  workflow forking yet.
