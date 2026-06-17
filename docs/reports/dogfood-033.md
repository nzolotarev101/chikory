# Dogfood-033 — WP-205: pure branch-target parser (SUCCESS in ONE step; no new friction)

**WP**: WP-205 (branching & rollback, pure branch-target parser slice) · **Date**: 2026-06-17 · **Task spec**: [`examples/dogfood/dogfood-033.yaml`](../../examples/dogfood/dogfood-033.yaml) · **Run**: `run-41dd7c98-3a94-4f77-b77f-bd644684d5f3` · **Outcome**: **SUCCESS** (judge PROCEED 3/3) · **Landed**: harvested IDENTICAL, staged uncommitted on `main`

> Thirty-third campaign, thirty-second first-attempt SUCCESS. WP-205 now has its
> first pure helper: `parseBranchTarget(input)`, which canonicalizes
> `chikory branch <run-id>@<step>` targets before any CLI command, workflow fork,
> or git worktree side effect exists.

## The run

Zero-secrets setup unchanged: Codex executor (OpenAI family) + Gemini judge
behind the OpenAI-compatible shim. Family diversity held.

```text
run run-41dd7c98-3a94-4f77-b77f-bd644684d5f3 · SUCCESS · 1 steps · $0.48 / $5.00 · 3m 11s · executor codex(openai) · judge openai-compat
 1   Implemented the WP-205 parser slice… 327k/4.1k  $0.45  ✓ PROCEED (3/3 criteria)
totals: decisions 1 · judge passes 1 ($0.03, 6.2%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 1 · feedback frequency 1/1 steps
        issues found 0 · changes made 1 (issues:changes 0:1)
        components over time: s0 j@0
```

There was no empty-diff probe step. The productive step emitted
`CHIKORY_TASK_COMPLETE`, the judge fired on that step, and SUCCESS sealed at
`components over time: s0 j@0`.

## Delivery quality (human review, post-landing)

The delivered diff matches the spec's two-file scope:

- **`packages/sdk-ts/src/cli/branch-target.ts`** (NEW) exports named
  `BranchTarget` and `parseBranchTarget(input)`. The helper accepts exactly one
  `@` separator, rejects empty run ids and empty steps, accepts `base`, accepts
  positive integer steps, rejects zero/negative/non-integer steps, and
  canonicalizes numeric checkpoint ids through the parsed number
  (`run-205@007` -> `checkpointId: "run-205@7"`).
- **`packages/sdk-ts/test/cli/branch-target.test.ts`** (NEW, 10 assertions)
  covers positive integer parsing, `base`, canonical checkpoint ids, missing
  separator, empty sides, zero, negative, decimal, and multiple separators.

Independent checks from the phase-0 verifier:

```text
AC-1 pnpm --filter @chikory/sdk exec vitest run test/cli/branch-target.test.ts  PASS (10 tests)
AC-2 pnpm --filter @chikory/sdk typecheck                                      PASS
AC-3 pure parser/test scope only                                                PASS
```

Harvest integrity held: both changed files are byte-`IDENTICAL` to the run
workspace. There is no landed commit yet; the files are staged in the working
tree for review. The run workspace has one checkpoint commit
(`a93cd6269e2c`) on top of base `61196dd`.

## New friction

No new friction numbers.

Other anomaly checks:

- **Wasted steps**: none. One productive step, no trailing probe.
- **Cost telemetry**: exact sum $0.4801; budget used 9.6 %; judge share 6.2 %.
  Metering is nonzero and consistent with the pricing table.
- **Token economics**: step 1 used **327k input / 4.1k output** for a 2931-byte
  two-file diff. This is the new low in the adjacent one-step pure-slice band
  (021..033: 862k, 969k, 451k, 976k, 467k, 807k, 527k, 410k, 462k, 434k, 375k,
  489k, **327k**), but still high enough to keep WP-207 runtime pacing useful.
- **Judge behavior**: the judge executed both check commands, judged the
  description-only scope criterion from the diff, and correctly PROCEEDed.
- **Human ceremony**: one zero-step `RUNNING` directory
  (`run-1d4718db-dbff-4eb6-b339-ce4b0d29edcc`) exists from an earlier launch
  attempt, but it recorded no steps, no artifacts, and $0.00 spend. The reviewed
  run is the terminal SUCCESS run.
- **Loop integrity**: one checkpoint, no rollback, no resume, no duplicate
  journal entries inside the terminal run.

## Verdict on the thesis

- **WP-205 can now start from a tested pure parse surface.** The parser is small,
  deterministic, and free of command dispatch or git/worktree side effects.
- **The F-11 fix remains stable.** Dogfood-033 is another one-step,
  marker-triggered SUCCESS with no probe.
- **No process finding emerged.** The next dogfoodable WP-205 slice should stay
  pure: derive the default branch name for a parsed target before implementing
  the side-effectful `chikory branch` command.
