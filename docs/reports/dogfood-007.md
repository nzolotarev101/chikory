# Dogfood-007 — WP-223 (watch renders journal transitions) through Chikory

**WP**: WP-223 · **Date**: 2026-06-12 · **Task spec**: [`examples/dogfood/dogfood-007.yaml`](../../examples/dogfood/dogfood-007.yaml) · **Run**: `run-22b337a9-d183-4485-ad20-1e62a5b73b84` · **Landed**: pending — diff applied + verified, uncommitted on `main` (review precedes commit)

> Seventh dogfood, seventh consecutive first-attempt SUCCESS. The engine
> fixed its own observer seam: the F-15 watch race that bit a harvest
> (dogfood-004), an executor workspace and a human review (dogfood-006) is
> closed — three host full-suite runs post-fix show `cli.test.ts` stable
> under parallel load. Two closure proofs in one campaign: the F-14 env
> leak acceptance test set by dogfood-006 also passed (zero shim noise in
> this run's executor transcript). One new friction number (F-19): the
> independent review's first AC-2 rerun flapped on a *different*,
> pre-existing test race in `agent-loop.test.ts`.

## The run

Zero-secrets setup identical to dogfood-002…006: `codex` executor (ChatGPT
OAuth), Gemini judge behind `scripts/cli-judge-proxy.mjs` (openai executor /
gemini-3.1-pro-preview judge — invariant #2 holds; judge share 3.7 % ≪ the
0.5 cap).

```
run run-22b337a9… · SUCCESS · 2 steps · $1.00 / $5.00 · 3m 33s · executor codex(openai) · judge openai-compat
 1   Implemented WP-223 in exactly two f…  586k/4.1k   $0.77
 2   WP-223 is already implemented as sp…  136k/1.8k   $0.19   ✓ PROCEED (3/3 criteria)
totals: decisions 2 · judge passes 1 ($0.04, 3.7%) · rollbacks 0 · escalations 0 · checkpoints 2
```

Step 1 did all the work (20 tool calls, 1 m 56 s, diff 3 674 bytes across
exactly the two in-scope files) and reported full verification — typecheck,
lint, CLI suite 5/5, `git diff --check`. Step 2 produced an empty diff
(13 tool calls, 51 s, 136k input tokens re-verifying); the WP-217
empty-diff milestone and the cadence-2 tick landed on the same step again
(third campaign in a row — the milestone trigger has still never fired
*off*-cadence in production). The judge executed all three checks in the
workspace clone, passed all four rubric items, and sealed SUCCESS.

Journal integrity clean: 7 entries (2 step, 1 judge, 1 verdict,
2 checkpoint, 1 terminal), no duplicates, checkpoint chain consistent
(`@1` `e20cae52` lastGood:false pre-judge → `@5` `594efcb0` lastGood:true
after PROCEED).

Cost telemetry healthy (third fully priced campaign): $0.7743 step 1 +
$0.1886 step 2 + $0.0372 judge = $1.0001, arithmetic consistent with the
`2026-06-12` table (≈586k in × $1.25/MTok + 4.1k out × $10/MTok ≈ $0.77).
No `⚠ cost meter blind` warning; 20 % of the $5 cap consumed.

## Delivery quality (human review, post-landing)

Verified independently (devbox, host repo). The working-tree diff is
**byte-identical** to the run's step-1 diff artifact (`f013effe…`,
3 674 bytes, verified with `diff` — `IDENTICAL`).

- **AC-1**: `vitest run test/cli/cli.test.ts` — 5/5, including the two new
  exactly-once assertions.
- **AC-2**: `vitest run test/runner/budget-gate.test.ts
  test/runner/agent-loop.test.ts test/cli/trace.test.ts` — **failed on the
  first host rerun** (1 failed / 21 passed), then passed 9 of the next 9.
  The failure is a pre-existing flake in `agent-loop.test.ts >
  incomplete empty-diff verdict keeps RUNNING…` — unrelated to this diff
  (the runner suite imports nothing from `src/cli/`); see F-19. The
  judge's in-workspace execution of the same check exited 0.
- **AC-3**: `tsc --noEmit` and `eslint .` — clean.
- **Full suite ×3**: 201 passed, 19 skipped, 0 failed — all three runs.
  `cli.test.ts` no longer flakes under full-suite parallel load (it had
  failed under load in both dogfood-004's harvest and dogfood-006's
  review). **F-15 is closed by construction**: transition lines now come
  from durable journal entries, not poll sampling.
- **The change is exactly the spec.** `followRun` consumes journal entries
  from `nextEntryIdx` on *every* poll (no longer only `--watch`);
  `budget_event`/halt prints the SUSPENDED line verbatim from
  `details.spentUsd`/`details.budgetUsd` (`toFixed(2)`); ESCALATE verdict
  entries print the AWAITING_APPROVAL line verbatim; `top_up` prints
  nothing; the sampled-status prints and `lastStatus` tracking are
  deleted; the status poll is kept for TERMINAL detection; payload
  narrowing follows the `trace.ts` local-cast pattern. Both new test
  assertions are the exactly-once `filter(...).toHaveLength(1)` form the
  spec asked for.
- **Scope discipline held**: exactly the 2 named files, 25 insertions /
  18 deletions; restricted files (`types.ts`, `schemas.ts`, `src/runner/`,
  `src/workflow/`, `src/executors/`, `src/cli/trace.ts`) untouched.
- **F-14 closure confirmed** (the acceptance test dogfood-006 set): step
  1's transcript contains zero `HTTP 500`s, zero `providers.integration`
  hits, zero `OPENAI_COMPAT_BASE_URL` mentions — the executor child saw
  only its own family key. The WP-222 scrub held in production.

**WP-223 status**: done pending commit. CG-2's transparency break (a
budget suspension vanishing from watch output) and the IF-4 watch-fidelity
reopen are both addressed.

## New friction

- **F-19 — `agent-loop.test.ts` waitFor race can flap a clean AC-2.**
  `incomplete empty-diff verdict keeps RUNNING and feeds rationale into
  the next step` failed 2 of 13 host invocations during this review
  (`expected undefined to deeply equal { kind: 'PROCEED', atStep: +0 }`).
  Root cause confirmed in code: the test's `waitFor` predicate
  (`test/runner/agent-loop.test.ts:251-259`) gates on `wire.hits === 1 &&
  currentStep === 1 && status === "RUNNING"` but not on the verdict being
  applied — the fake judge wire counts the hit at HTTP response time,
  before the runner journals the verdict, so line 262's
  `running.lastVerdict` can still be `undefined`. This is the same class
  of bug WP-223 just fixed in the CLI (asserting on sampled state instead
  of durable state), now in the test harness itself — and it sits inside a
  judge-executed acceptance check (dogfood-007 AC-2), so it can fail a
  future run or harvest spuriously. → **WP-225**: gate the predicate on
  `report.lastVerdict !== undefined` (one-line test fix, no product
  change). 🟢
- **F-11 recurred** (completion probe tax), sixth data point: 136k input
  tokens / 13 tool calls / 51 s / **$0.19 — 18.9 % of run cost** to
  rediscover "nothing to do" (155k → 211k → 158k → 245k → 156k → 136k
  across dogfood-002…007). Milestone trigger coincided with the cadence
  tick for the third straight campaign. WP-221 (`claimsComplete`)
  unchanged, still rides the next contracts PR. No new number.
- **Token-economics baseline** (WP-203/WP-207 data): 722k executor input
  tokens for a 2-step, 3.7 KB-diff change ($1.00) — the cheapest campaign
  yet (1 592k/$2.14 → 1 056k/$1.43 → 722k/$1.00 over the three priced
  campaigns); per-step input (586k) still dominated by the codex CLI's
  internal re-reading loop.
- **Ceremony note**: the delivery was again applied to the host working
  tree and left uncommitted for review rather than landed via
  `chikory land` — rational while `land` commits unverified (F-17).
  WP-224 (`land --verify`, dogfood-008) is what makes `land` the default
  path. No new number.

## Verdict on the thesis (seventh data point)

- Seven campaigns, seven first-attempt SUCCESSes. This one closed two open
  friction loops with in-run evidence: F-15 (fixed by the delivery, proven
  by three clean full-suite runs) and F-14 (the closure test dogfood-006
  defined, passed by this run's clean executor transcript).
- The flake class itself is instructive: both F-15 and F-19 are "assert on
  sampled state instead of durable state". The product-side instance is
  now fixed; the test-harness instance (F-19) is queued. The journal as
  single source of truth keeps earning its keep.
- Open friction is now: WP-224 (`land --verify`, next), WP-225 (F-19 test
  fix, trivial), WP-219's ADR, and the two contract-gated items (WP-221,
  WP-218 slice 2) riding the next architect PR.
