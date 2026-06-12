# Dogfood-003 — WP-217 (judge-on-completion) through Chikory

**WP**: WP-217 · **Date**: 2026-06-12 · **Task spec**: [`examples/dogfood/dogfood-003.yaml`](../../examples/dogfood/dogfood-003.yaml) · **Run**: `run-b2f3504d-64ca-4b85-a511-56bd367981ac` · **Landed**: `ef4b16f`

> Third dogfood, third consecutive first-attempt SUCCESS, and the first time
> Chikory modified its own runner loop. The landed trigger then fired in the
> very run that delivered it — though not unambiguously (F-12). New friction:
> F-11…F-13, continuing dogfood-002's F-8…F-10.

## The run

Zero-secrets setup identical to dogfood-002: `codex` executor (ChatGPT
OAuth), Gemini judge behind `scripts/cli-judge-proxy.mjs`
(openai executor / gemini-3.1-pro-preview judge — invariant #2 holds).

```
run run-b2f3504d… · SUCCESS · 2 steps · $0.00 / $5.00 · 6m 9s · executor codex(openai) · judge openai-compat
 1   Implemented WP-217. - Added off-cad…  1167k/8.7k   $0.00
 2   WP-217 is implemented in the existi…   211k/2.2k   $0.00   ✓ PROCEED (3/3 criteria)
totals: decisions 2 · judge passes 1 · rollbacks 0 · escalations 0 · checkpoints 2
```

Step 1 did all the work (36 tool calls, 3 m 55 s, diff 8259 bytes across the
3 in-scope files). Step 2 produced an empty diff (14 tool calls, 1 m 9 s,
211k input tokens re-verifying), which — under the *just-landed* WP-217 code
running the loop — triggered the judge, who executed all three checks in the
workspace clone (agent-loop 4/4 · other runner suites 12/12 · typecheck+lint
clean), passed all four rubric items, and sealed SUCCESS.

Journal integrity clean: 7 entries (2 step, 1 judge, 1 verdict, 2
checkpoint, 1 terminal), no duplicates, final checkpoint `@5` is
`lastGood: true`. (Checkpoint ids embed the journal index, not a
checkpoint counter — `@1` → `@5` is expected, not a gap.)

## Delivery quality (human review, post-landing)

Verified independently after harvest (`devbox run` over `ef4b16f`):

- **AC-1**: `vitest run test/runner/agent-loop.test.ts` — 4/4 passed,
  including both new tests (`empty successful diff triggers an off-cadence
  judge pass and seals SUCCESS`; `incomplete empty-diff verdict keeps
  RUNNING and feeds rationale into the next step`).
- **AC-2**: budget-gate, checkpoint, crash-recovery, verdict-gating — 12/12
  passed.
- **AC-3**: `tsc --noEmit` and `eslint .` — clean.
- **The change is exactly the spec.** `agent-loop.ts`: one new pure
  predicate `completionMilestone = record.status === "SUCCESS" &&
  record.diffRef.bytes === 0`, OR-ed into the existing cadence condition;
  comment names both JD-2 conditions; on a milestone PROCEED whose criteria
  don't all pass, `verdict.rationale` rides into the next step as
  `judgeFeedback` (previously feedback was always cleared on PROCEED). No
  new activities, no I/O, no `types.ts`/`schemas.ts` changes — determinism
  constraint honored.
- **Tests follow house patterns.** New `ScriptedConfig.emptyDiffSteps` +
  `echoJudgeFeedback` knobs in `helpers.ts` are minimal and reusable; tests
  assert journal-entry counts, fake-judge-wire hit counts, and the feedback
  string in the next step's summary — not just terminal status.
- **Scope discipline held in the run** — the run's diff touched only
  `agent-loop.ts`, `agent-loop.test.ts`, `helpers.ts`. The *harvest commit*
  did not: see F-13.

**WP-217 status**: the no-contracts half (empty-diff inference) is **done**.
The explicit `claimsComplete` signal the plan row also named is split out →
WP-221 (F-11).

## New friction (numbering continues dogfood-002)

- **F-11 — completion still costs one full probe step.** WP-217 removes the
  *wait* for the cadence boundary, but the trigger needs an empty-diff step
  to exist before it can fire: this run still paid 211k input tokens /
  14 tool calls / 69 s for step 2 to discover "nothing to do" (dogfood-002
  paid 155k for the same probe). The executor's step-1 summary already said
  "Implemented WP-217 … 16/16 passed" — the completion claim is on the wire
  a step earlier, just not in `StepRecord`. The fix is the half of the
  WP-217 plan row deliberately deferred from this slice: an explicit
  `claimsComplete` on `StepRecord` (contracts PR, architect-reviewed), which
  the trigger can OR-in to judge the *productive* step directly.
  → **WP-221**.
- **F-12 — the dogfood spec never isolated the feature it shipped.** With
  `cadence: 2` and completion at step 2, the cadence trigger
  (`2 % 2 === 0`) fired at the same boundary as the new milestone trigger —
  pre-WP-217 code would have sealed this run identically. The live run
  therefore demonstrates the *old* path; only the two landed tests prove
  the new one. Spec-authoring lesson: when dogfooding new trigger/behavior
  logic, configure the spec so old code observably could NOT produce the
  outcome (here: `cadence` > `max_steps`, so only the milestone path can
  fire — which dogfood-004 now does). → no WP; DOGFOODING.md §3.7 note.
- **F-13 — the harvest commit isn't the run's diff.** `ef4b16f` contains
  the run's 3-file delivery **plus** hand-written harvest tooling
  (`scripts/harvest.sh`, +130 lines, and a `devbox.json` task) that no run
  produced and no spec scoped. The commit-cites-run-id convention exists so
  `git show <landed>` ≍ the run's diff artifact; that audit equality is now
  broken for this campaign (delivery is recoverable from artifact
  `c0b20c6f0da1`). → no new WP — WP-220 (`chikory land`) produces the pure
  squashed commit mechanically; until it lands, DOGFOODING §6 now says:
  human tooling goes in its own commit, never the harvest commit.

Recurrences, not new numbers:

- **F-9 recurred** ($0.00 for 1.39M tokens): `pricing.ts` still lacks
  `gpt-5.5` *and* the judge's `gemini-3.1-pro-preview`; budget gate inert
  on the documented default path for the third run running. WP-218 already
  queued — dogfood-004 takes its no-contracts slice.
- **Token-economics baseline** (WP-203/WP-207 data): 1.39M input tokens
  total for a 2-step, 8.3 KB-diff runner change (1167k step 1 · 211k step 2
  · 17k judge). Same shape as dogfood-002's 1.25M — the executor CLI's
  internal loop, not Chikory's step loop, is where the tokens go.

## Verdict on the thesis (third data point)

- Three campaigns, three first-attempt SUCCESSes, three real WP slices on
  the branch — and this one was the engine **changing its own inner loop**,
  with the judge executing the runner's full test suite as the gate. The
  reliability story keeps holding.
- The leverage gaps from dogfood-002 are still the story, now with sharper
  numbers: the completion tax is ~200k tokens/slice and survives WP-217
  (F-11); the cost meter has been $0.00 for 2.6M tokens across two runs
  (F-9 → WP-218, next up); the human still slices, launches, harvests —
  and this time the hand-harvest contaminated the audit trail (F-13 →
  WP-220).
- New lesson for the methodology itself: a dogfood run must be designed to
  *falsify* the old behavior, or it proves nothing about the new one
  (F-12). Cheap fix, now in the spec-writing guidance.
