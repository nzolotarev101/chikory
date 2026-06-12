# Dogfood-004 — WP-218 slice 1 (pricing refresh + blind-cost-meter warning) through Chikory

**WP**: WP-218 slice 1 · **Date**: 2026-06-12 · **Task spec**: [`examples/dogfood/dogfood-004.yaml`](../../examples/dogfood/dogfood-004.yaml) · **Run**: `run-9edbcd28-0c32-4c54-858f-6ef86a7ef219` · **Landed**: pending — harvest verification aborted on a pre-existing flaky test (F-15); the run's diff is applied, verified, and uncommitted on `wp-218-pricing-and-blind-meter-warning`

> Fourth dogfood, fourth consecutive first-attempt SUCCESS — and the first
> *designed falsification* (dogfood-003 F-12): `cadence: 5 > max_steps: 4`
> meant only the WP-217 completion-milestone trigger could seal the run, and
> it did. The poetic payoff: after rebuild, `chikory trace` flags this very
> run with the `⚠ cost meter blind (unpriced tokens)` warning the run itself
> shipped. New friction: F-14…F-16, continuing dogfood-003's F-11…F-13.

## The run

Zero-secrets setup identical to dogfood-002/003: `codex` executor (ChatGPT
OAuth), Gemini judge behind `scripts/cli-judge-proxy.mjs`
(openai executor / gemini-3.1-pro-preview judge — invariant #2 holds).

```
run run-9edbcd28… · SUCCESS · 2 steps · $0.00 / $5.00 · 3m 49s · executor codex(openai) · judge openai-compat
 1   Implemented WP-218 slice 1, modifyi…  694k/4.7k   $0.00
 2   WP-218 slice 1 is implemented and v…  158k/1.7k   $0.00   ✓ PROCEED (3/3 criteria)
totals: decisions 2 · judge passes 1 · rollbacks 0 · escalations 0 · checkpoints 2
```

Step 1 did all the work (17 tool calls, 2 m 23 s, diff 6854 bytes across the
4 in-scope files). Step 2 produced an empty diff (10 tool calls, 49 s, 158k
input tokens re-verifying). With `cadence: 5` unreachable inside
`max_steps: 4`, the **only** sealing path was the WP-217 empty-diff
milestone trigger — it fired, the judge executed all three checks in the
workspace clone (pricing 6/6 + trace 14/14 = 20 tests · typecheck+lint
clean), passed all four rubric items, and sealed SUCCESS. This is the live
isolation proof dogfood-003 couldn't give (F-12 closed as designed).

Journal integrity clean: 7 entries (2 step, 1 judge, 1 verdict, 2
checkpoint, 1 terminal), no duplicates, final checkpoint `@5` is
`lastGood: true`.

Cost telemetry: still $0.00 for 852k input tokens — expected and final.
Costs are journaled at run time against the *pre-WP-218* table; this is the
last blind run. With the landed table the same traffic would have metered
≈ $1.13 executor (852k in / 6.4k out at gpt-5.5 $1.25/$10 per MTok) +
≈ $0.04 judge — real data the $5 budget gate would finally have seen.

## Delivery quality (human review, post-landing)

Verified independently after harvest (devbox, on the applied diff):

- **AC-1 + AC-2**: `vitest run test/pricing.test.ts test/cli/trace.test.ts`
  — 20/20 passed, including the four new prices, the
  `gpt-5.5-2026-01-15` → `gpt-5.5` longest-prefix assertion, the
  `PRICING_VERSION === "2026-06-12"` pin, the UNPRICED step flag, and the
  blind-meter header warning (positive and negative cases).
- **AC-3**: `tsc --noEmit` and `eslint .` — clean.
- **The change is exactly the spec.** `pricing.ts`: four entries with the
  spec's verbatim figures, grouping comments kept, version bumped.
  `trace.ts`: one new pure predicate `isUnpricedStep` (exactly
  `costEstimated && costUsd === 0 && tokens > 0`), used by both the step
  detail annotation and the header `entries.some(...)` scan — rendering
  only, no journal/schema reads beyond existing payload fields.
  `types.ts`/`schemas.ts` untouched as ordered.
- **Live proof on real data**: after `pnpm --filter @chikory/sdk build`,
  `chikory trace run-9edbcd28…` renders
  `… · judge openai-compat · ⚠ cost meter blind (unpriced tokens)` on this
  run's own header. (It did *not* render before the rebuild — see F-16.)
- **Scope discipline held**: `git diff --stat` = exactly the four permitted
  files, 64 insertions, 3 deletions. No commit was created by the run, as
  instructed.
- The host full-suite failure that aborted harvest
  (`cli.test.ts > budget halt → resume --add-budget`) is **not a WP-218
  regression**: it passes 3/3 consecutive re-runs with the diff applied,
  the failing assertion is about `run --watch` output for a fake-executor
  run with exact (non-estimated) costs, and the diff is rendering-only.
  Root cause is a pre-existing watch race — see F-15.

**WP-218 status**: slice 1 (pricing refresh + honest-$0 warning) is
**done** pending commit. Slice 2 — the `budget_tokens` cap — is a
contracts change (TaskSpec/schemas) and stays hand-done per
TASK-PROTOCOL §4.

## New friction (numbering continues dogfood-003)

- **F-14 — judge-shim env leaks into the executor.** Twice during step 1
  the shim logged `[cli-judge:gemini] FAILED … code: 404 … "Requested
  entity was not found."`. Forensics: the two failed gemini sessions
  (18:36:50, 18:36:54) contain the prompts `Reply with the single word:
  pong` and the color/number JSON-schema probe — verbatim
  `test/providers.integration.test.ts`. Chain: the dogfood launch exports
  `OPENAI_COMPAT_BASE_URL` for the judge shim → the codex executor child
  process inherits it → the executor ran the test suite in its workspace →
  the openai-compat conformance block (skipped only when that env var is
  absent) un-skipped and called the **live judge shim** with its default
  model `llama3.2` → `gemini -m llama3.2` → 404. Consequences: executor
  traffic reaches the judge backend (burns its quota, blurs the
  family-diversity seam), and the executor's in-workspace test runs are
  nondeterministic (it watched two tests fail that have nothing to do with
  its task — an error-compounding seed). The run survived because the
  executor scoped its verification to the targeted suites afterward.
  → **WP-222**: executor subprocess env allowlist — adapters spawn CLIs
  with provider/judge env vars scrubbed; pass-through is an explicit
  TaskSpec opt-in.
- **F-15 — `run --watch` can miss a state transition; the flake aborted
  harvest.** Harvest verification failed on
  `cli.test.ts > budget halt → resume --add-budget continues to SUCCESS`:
  `expected … to contain 'SUSPENDED at the budget cap'`. The test's own
  status polling *did* observe `SUSPENDED` (that's what gated the resume),
  but the watch output never printed it — the suspend→resume window fell
  between watch polls. Two real defects, one flake: (a) product — a budget
  suspension can vanish from `--watch` output entirely, breaking the
  CG-2 transparency promise and any tooling that greps for it; (b)
  process — `devbox run harvest` aborts pre-commit on any flake, leaving
  the landing half-done (this campaign's commit is still pending because
  of it). Passes 3/3 on re-run; unrelated to the diff. → **WP-223**: watch
  renders state *transitions* derived from the journal/status history
  (print every transition, never sample), which also de-flakes the test.
- **F-16 — the printed forensics command ran yesterday's code.** The
  `chikory` bin points at `dist/`; the dogfood script builds **before**
  the run (pre-WP-218 code) and `harvest.sh` applies the src diff but
  never rebuilds. Result: the `chikory trace …` command the run itself
  prints rendered this run **without** the just-landed UNPRICED flag and
  blind-meter warning — the delivered feature was invisible in the very
  forensics step that should showcase it, until a manual build.
  → no new WP: `scripts/harvest.sh` now runs `devbox run build` before
  verification (fixed with this review), and WP-220's `chikory land` must
  rebuild before verifying for the same reason.

Recurrences, not new numbers:

- **F-11 recurred** (completion probe tax), third data point: 158k input
  tokens / 10 tool calls / 49 s for step 2 to rediscover "nothing to do"
  (155k dogfood-002, 211k dogfood-003). WP-221 unchanged.
- **F-9 closed by this run** (pending commit): the pricing table now
  prices `gpt-5.5` and `gemini-3.1-pro-preview`, and any future $0 +
  tokens>0 step is flagged loudly in trace. The next dogfood run is the
  end-to-end proof that the meter reads nonzero.
- **Token-economics baseline** (WP-203/WP-207 data): 869k input tokens
  total for a 2-step, 6.8 KB-diff change (694k step 1 · 158k step 2 ·
  17k judge). Smallest run yet in tokens *and* wall clock (3 m 49 s) —
  scale tracks diff size, and the executor CLI's internal loop remains
  where the tokens go.

## Verdict on the thesis (fourth data point)

- Four campaigns, four first-attempt SUCCESSes. This one adds two firsts:
  a spec **designed to falsify** the old behavior (F-12 methodology
  applied: the milestone trigger sealed a run the old code provably could
  not have sealed), and a delivered feature **verified live on the run
  that delivered it**.
- The friction is migrating outward: nothing new is wrong inside the loop
  (journal, checkpoints, judge gating all clean again) — the new findings
  are seam hygiene (F-14 env leak), observer fidelity (F-15 watch race),
  and landing ceremony (F-16 stale build, commit still pending on a
  flake). The engine works; the *operating environment around it* is now
  the reliability frontier.
- The blind-meter era ends here: three runs and 3.5M tokens at $0.00 was
  the cost of a missing table row. The fix took one 2-file slice and
  4 minutes of engine time — the expensive part was *noticing*, which is
  exactly what the warning now automates.
