# Dogfood-002 — WP-201 first slice (Python contracts parity) through Chikory

**WP**: WP-201 (slice 1) · **Date**: 2026-06-11 · **Task spec**: [`examples/dogfood/wp-201.yaml`](../../examples/dogfood/wp-201.yaml) · **Run**: `run-2899005b-24b6-41a4-8bde-32e5b9e9354d` · **Landed**: `eb5c57e`

> Second dogfood, first *routine* one: no new harness code, no babysitting a
> broken gate — the spec was written per DOGFOODING.md and the run went
> SUCCESS on the first attempt. This report assesses delivery quality,
> records the new friction (F-8…F-10, continuing dogfood-001's F-1…F-7), and
> derives the WP-217…WP-220 additions to the P2 queue.

## The run

Zero-secrets setup identical to dogfood-001 runs 2–4: `codex` executor
(ChatGPT OAuth), Gemini judge behind `scripts/cli-judge-proxy.mjs`
(invariant #2 holds for real: openai executor / gemini judge).

```
run run-2899005b… · SUCCESS · 2 steps · $0.00 / $5.00 · 5m 7s · executor codex(openai) · judge openai-compat
 1   Implemented WP-201's first slice…   1096k/8.8k   $0.00
 2   The WP-201 contract port is alre…    155k/1.9k   $0.00   ✓ PROCEED (3/3 criteria)
totals: decisions 2 · judge passes 1 · rollbacks 0 · escalations 0 · checkpoints 2
```

Step 1 did all the work. Step 2 produced an **empty diff** — the executor
re-verified everything (12 tool calls, 49 s, 155k input tokens) and reported
"no edits were necessary" — because cadence 2 meant the judge couldn't look
until step 2 completed. The judge then executed all three checks in the
workspace clone (pytest 40 passed · pyright clean · ruff clean), passed all
four rubric items, and sealed SUCCESS.

## Delivery quality (human review, post-landing)

Verified independently after harvest (`devbox run` over the landed commit —
pytest 40/40, pyright 0 errors, ruff clean, all three AC commands re-run
green):

- **Parity is faithful.** All 29 contract names from the goal exist in
  `types.py`; the shared `ContractModel` base (camelCase alias generator,
  `extra="forbid"`, `populate_by_name`) mirrors the zod `.strict()` regime.
  Cross-field validators match the TS schemas one-for-one: RoutingPolicy
  stage-completeness, TaskSpec writable-repo / unique-criterion-ids /
  family-diversity, JudgeVerdict ROLLBACK-requires-rollbackTo and
  ESCALATE-requires-escalateReason.
- **Conformance is shared, not parallel.** `test_contracts.py` walks
  `fixtures/contracts/` (all 39 fixtures: 25 valid round-trip semantically,
  14 invalid raise `ValidationError`) — the same files the TS suite uses, so
  the two SDKs cannot drift silently.
- **Scope discipline held.** Runtime stubs (`router.py`, `judge.py`,
  `runner.py`) were *reduced* to typed `NotImplementedError` shells exactly
  as instructed; no new dependencies (`pyproject.toml` untouched); no
  runtime behavior smuggled in. The judge's `scope_matches_instruction`
  rubric item confirmed the same from the diff.
- One review nit, not worth a fix PR: `JudgeFormResult.pass_` needs an
  explicit `alias="pass"` (Python keyword) — handled correctly, just the
  only spot where the alias generator wasn't enough.

**WP-201 status**: first slice (contracts + shared conformance suite — the
deliverable named in plan.md §6) is **done**. Remaining parity slices when
they're needed: Python `Router` implementation and any client-side runtime.

## New friction (numbering continues dogfood-001)

- **F-8 — completion/cadence mismatch burns a filler step.** The executor
  finished in step 1, but the judge's only trigger is `cadence`, so the run
  paid a full executor session (155k input tokens, 49 s, 12 tool calls) to
  discover "nothing to do" before the judge could seal SUCCESS. For an
  engine meant to run long horizons this is a per-slice tax of up to
  cadence−1 wasted steps, and on API-key auth it is real money. The signal
  is already on the wire: step 2's diff artifact was 0 bytes. → **WP-217**.
- **F-9 — the cost meter read $0.00 for 1.25M tokens.** Two compounding
  holes: (1) the pricing table has `gpt-5.2` but not `gpt-5.5` — the model
  this run actually used — and unknown models estimate to $0; (2) the
  zero-secrets routing labels everything `openai-compat`, which defaults to
  $0 by design. Result: CG-2's "hard budget cap" is fully inert on the
  *documented default* path (dogfood-001 already noted subscription runs
  report $0; this run shows even the estimator path yields $0). Tokens,
  however, were measured exactly. Governance should be denominated in the
  currency that is always on the wire. → **WP-218**.
- **F-10 — the human is still the planner and the harvester.** The engine's
  share of this WP was 5 minutes; the human's share was: slice the WP, write
  the yaml, launch, watch, then §6-harvest by hand (diff apply, verify,
  commit, push, report). Acceptable for dogfooding the gate; fatal for the
  actual objective — *long-running, full-application engines*. Two separable
  gaps: (a) nothing decomposes a goal bigger than 1–3 steps into sequenced,
  judge-gated slices (P1 deliberately has no planner; P2 had no
  decomposition WP at all — WP-207 paces *within* a run but doesn't plan
  *across* runs) → **WP-219**; (b) run → branch/PR is manual ceremony that
  a command can do → **WP-220**.

Data point for WP-203/WP-207 (no action yet): a *mechanical* 2-step port
consumed 1.25M input tokens inside the executor CLI's internal loop. That is
the context-economics baseline long-horizon pacing has to beat.

## Verdict on the thesis (second data point)

- The P1 promise held end-to-end with zero new harness code: fresh clone,
  journaled steps, judge-executed checks (3/3), real family diversity,
  checkpoint-per-step, full forensics from `chikory trace` alone, harvest
  commit citing the run-id. Two consecutive dogfoods, two SUCCESSes, two
  real WP slices on `main`.
- The gap is no longer reliability — it's **leverage**: F-8 (wasted steps),
  F-9 (blind budget), F-10 (human-in-the-loop everywhere the loop isn't).
  That is exactly the P2 boundary this report feeds: WP-217…WP-220 queued
  ahead of the rest of P2 in plan.md §6.
- **Total spend: $0.00 on the wire** (subscription auth) — which is itself
  finding F-9.
