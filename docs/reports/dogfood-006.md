# Dogfood-006 — WP-222 slice 1 (executor subprocess env scrub) through Chikory

**WP**: WP-222 slice 1 · **Date**: 2026-06-12 · **Task spec**: [`examples/dogfood/dogfood-006.yaml`](../../examples/dogfood/dogfood-006.yaml) · **Run**: `run-559ea904-1398-494c-873a-205c28da78c6` · **Landed**: pending — diff applied + verified, uncommitted on `main` (review precedes commit)

> Sixth dogfood, sixth consecutive first-attempt SUCCESS — and the first
> campaign that surfaced **no new friction numbers**. The spec was written
> to be self-falsifying and the run obliged: the very env leak this slice
> fixes (F-14) fired inside the run that delivered the fix — the executor's
> in-workspace full-suite run un-skipped `providers.integration.test.ts`
> via the inherited `OPENAI_COMPAT_BASE_URL` and took two HTTP 500s from
> the live judge shim. The next campaign's executor steps must show zero
> shim noise; that's the acceptance test for F-14 closure.

## The run

Zero-secrets setup identical to dogfood-002…005: `codex` executor (ChatGPT
OAuth), Gemini judge behind `scripts/cli-judge-proxy.mjs` (openai executor /
gemini-3.1-pro-preview judge — invariant #2 holds; judge share 2.6 % ≪ the
0.5 cap).

```
run run-559ea904… · SUCCESS · 2 steps · $1.43 / $5.00 · 4m 22s · executor codex(openai) · judge openai-compat
 1   Implemented WP-222 slice 1 in exact…  900k/5.8k   $1.18
 2   WP-222 slice 1 is implemented as re…  156k/1.7k   $0.21   ✓ PROCEED (3/3 criteria)
totals: decisions 2 · judge passes 1 ($0.04, 2.6%) · rollbacks 0 · escalations 0 · checkpoints 2
```

Step 1 did all the work (19 tool calls, 2 m 47 s, diff 8 221 bytes across
exactly the five in-scope files) and reported full verification — env +
adapter suites, typecheck, lint, plus an unprompted full-suite run (where
the F-14 leak and an F-15 flake bit; see recurrences). Step 2 produced an
empty diff (12 tool calls, 47 s, 156k input tokens re-verifying); the
WP-217 empty-diff milestone and the cadence-2 tick landed on the same step
(as in dogfood-005 — the milestone trigger has still never fired
*off*-cadence in production), the judge executed all three checks in the
workspace clone, passed all four rubric items, and sealed SUCCESS.

Journal integrity clean: 7 entries (2 step, 1 judge, 1 verdict,
2 checkpoint, 1 terminal), no duplicates, checkpoint chain consistent
(`@1` lastGood:false pre-judge → `@5` lastGood:true after PROCEED).

Cost telemetry healthy (second fully priced campaign): $1.1831 step 1 +
$0.2123 step 2 + $0.0367 judge = $1.4321, arithmetic consistent with the
`2026-06-12` table (≈900k in × $1.25/MTok + 5.8k out × $10/MTok = $1.18).
No `⚠ cost meter blind` warning; 28.6 % of the $5 cap consumed.

## Delivery quality (human review, post-landing)

Verified independently (devbox, host repo):

- **AC-1**: `vitest run test/executors/env.test.ts` — 4/4 (scrub drops the
  other four when keeping one, no input mutation + unrelated vars
  preserved, and one spawn-level leak assertion per adapter via the
  `FAKE_ECHO_ENV` fake bin).
- **AC-2**: `vitest run test/executors/codex.test.ts
  test/executors/claude-code.test.ts` — 18 passed, 2 gated E2E skipped
  (matches the run's own numbers; conformance behavior untouched).
- **AC-3**: `tsc --noEmit` and `eslint .` — clean.
- **Full suite**: 200 passed, 19 skipped, **1 failed — the known F-15
  flake** (`cli.test.ts > budget halt → resume --add-budget`), which
  passes in isolation (5/5 on rerun). Unrelated to this diff (env scrub
  touches executors only); third F-15 sighting — see recurrences.
- **The change is exactly the spec.** `env.ts`: `PROVIDER_ENV_VARS` with
  the five validated names + pure `scrubExecutorEnv` (spreads, never
  mutates, preserves non-provider vars). Both adapters wire it at their
  existing `env: opts.env ?? process.env` sites — codex keeps
  `["OPENAI_API_KEY"]`, claude-code keeps `["ANTHROPIC_API_KEY"]`;
  `opts.env` stays the test seam. `fake-cli.cjs`: `withEnvSummary` appends
  `provider_env=<names|none>` only when `FAKE_ECHO_ENV=1` — all existing
  fake modes byte-identical otherwise. JSDoc on exports, ESM `.js`
  imports, named exports, no new dependencies.
- **Scope discipline held**: exactly the 5 named files (3 modified + 2
  new), 19 insertions / 4 deletions in the modified files; restricted
  files (`types.ts`, `schemas.ts`, `src/runner/`, `process.ts`, `step.ts`)
  untouched. The worktree harvest is **byte-identical** to the run's diff
  artifact (8 221 bytes both; hunk-level diff equal, file order aside).
- **Self-falsification confirmed.** Step 1's transcript shows the leak the
  slice fixes, live: `providers.integration.test.ts (8 tests | 2 failed |
  6 skipped)` — the two `OPENAI_COMPAT_BASE_URL` conformance tests
  un-skipped by the inherited shim URL, both failing `HTTP 500` against
  the live judge proxy. Post-fix, a codex child sees only
  `OPENAI_API_KEY`; the next campaign's executor steps must report all 8
  provider tests skipped and zero shim traffic.

**WP-222 status**: slice 1 done pending commit. The explicit TaskSpec
pass-through opt-in is a contracts change and rides WP-221's
architect-reviewed PR, as scoped.

## New friction

**None** — the first campaign to add no new F-n. Everything observed was a
known number recurring:

- **F-11 recurred** (completion probe tax), fifth data point: 156k input
  tokens / 12 tool calls / 47 s / **$0.21 — 14.8 % of run cost** to
  rediscover "nothing to do" (155k → 211k → 158k → 245k → 156k across
  dogfood-002…006). WP-221 (`claimsComplete`) unchanged, still rides the
  next contracts PR. Related design note: the WP-217 milestone trigger has
  now coincided with the cadence tick in both campaigns since it landed —
  it has yet to save a judge pass in production; WP-221 is what makes it
  pay off (judge the *productive* step directly).
- **F-14 recurred — by design, for the last time**: the spec predicted the
  leak would fire inside this run and it did (HTTP 500 ×2 from the shim
  during step 1's full-suite run). This campaign's deliverable is the fix;
  closure is confirmed by the *next* campaign's clean executor steps.
- **F-15 recurred twice**: (1) in the executor's workspace full-suite run,
  `cli.test.ts > loop-breaker escalation → approve --reject` flaked — the
  sampled-status `AWAITING_APPROVAL` line never printed, a second flavor
  of the same watch race; (2) on the host during this review,
  `cli.test.ts > budget halt` failed under full-suite parallel load and
  passed 5/5 in isolation. The flake has now bitten a harvest
  (dogfood-004), an executor workspace (this run), and a human review
  (this review). Root cause confirmed in code: `followRun`
  (`packages/sdk-ts/src/cli/commands.ts`) prints transition lines only
  when a 1 s status poll happens to observe the intermediate state.
  → **WP-223 scope extended**, no new number: derive *both* transition
  lines (SUSPENDED **and** AWAITING_APPROVAL) from journal entries —
  `budget_event` halt entries and ESCALATE verdict entries are already
  durably journaled — so every state change prints exactly once.
  **Dogfood-007 targets it** (no contracts change needed).
- **Token-economics baseline** (WP-203/WP-207 data): 1 056k executor input
  tokens for a 2-step, 8.2 KB-diff change ($1.43) — down from
  dogfood-005's 1 592k/$2.14 for a comparable slice; per-step input
  (900k) still dominated by the codex CLI's internal re-reading loop.

## Verdict on the thesis (sixth data point)

- Six campaigns, six first-attempt SUCCESSes — and the friction curve just
  crossed zero: no new numbers, only known ones recurring on schedule.
- The self-falsifying spec pattern matured: dogfood-004 falsified the old
  cost meter, dogfood-005 landed its own run, dogfood-006 watched the bug
  it was fixing fire inside its own executor steps. The engine is now
  generating its own regression evidence.
- The remaining open friction is concentrated in one place: the CLI
  observer seam (F-15/WP-223, dogfood-007) and the post-land verify gap
  (F-17/WP-224) — plus the two contract-gated items (WP-221
  `claimsComplete`, WP-218 slice 2) waiting on the next architect PR.
  Inner loop, judge, checkpoints, and cost governance have now been clean
  for four straight campaigns.
