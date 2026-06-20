# Dogfood-038 — WP-219 S3-pure: the chain-state reducer (SUCCESS in ONE step; no new friction; fourteenth straight probe-free run)

**WP**: WP-219 (Goal decomposition & run chaining, ADR-005 §S3) · **Date**: 2026-06-20 · **Task spec**: [`examples/dogfood/dogfood-038.yaml`](../../examples/dogfood/dogfood-038.yaml) · **Run**: `run-61e8b0a1-74a0-4b3c-aec7-1d0d09d72880` · **Outcome**: **SUCCESS** (judge PROCEED 3/3) · **Landed**: harvested byte-`IDENTICAL`, uncommitted on the working tree (pending the user's review)

> Thirty-eighth campaign, thirty-seventh first-attempt SUCCESS (dogfood-017 the
> lone FAILED). The first slice off the **just-cleared S3 wall** — the dogfood
> queue broke out of the mechanical WP-201 parity series (dogfood-035/036) to
> deliver the real value lever: the pure chain-state reducer the WP-219 durable
> chain executor consumes. `advanceChain` + `deriveChainStatus` in a new
> `packages/sdk-ts/src/chain/advance.ts` — the `computeVerdict` analog and the
> sibling of the landed pure `readyNodes` / `hasDependencyCycle`
> (dogfood-015/016), folding a sealed `PlanNode`'s `NodeOutcome` into the chain
> and deriving its `ChainStatus` per the hand-frozen ADR-005 §S3 transition
> rules. No contract change (the `NodeOutcome` + `ChainRecord.nodeOutcomes`
> surface landed by hand this session).

## The run

Zero-secrets setup unchanged: Codex executor (OpenAI family) + Gemini judge
behind the OpenAI-compatible shim. Family diversity held (executor `openai`,
judge `gemini-3.1-pro-preview`).

```text
run run-61e8b0a1-74a0-4b3c-aec7-1d0d09d72880 · SUCCESS · 1 steps · $0.85 / $5.00 · 3m 38s · executor codex(openai) · judge openai-compat
 1   Implemented WP-219 S3 pure chain-st…  625k/5.9k  $0.84  ✓ PROCEED (3/3 criteria)
totals: decisions 1 · judge passes 1 ($0.01, 1.0%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 1 · feedback frequency 1/1 steps
        issues found 0 · changes made 1 (issues:changes 0:1)
        components over time: s0 j@0
```

There was no empty-diff probe step. The productive step emitted the completion
marker, the judge fired on that step, and SUCCESS sealed at
`components over time: s0 j@0` — the F-11-closed shape, held for a **fourteenth**
straight one-step run (the spec predicted exactly this).

## Delivery quality (human review, post-landing)

The delivered diff matches the spec's exact three-file scope (5785-byte diff,
additions + one re-export line, no other file touched):

- **`packages/sdk-ts/src/chain/advance.ts`** (new) — reviewed line by line
  against the spec's §S3 precedence rules and the reference pure reducers
  (`src/judge/verdict.ts` `computeVerdict`, `src/planner/meta-judge-verdict.ts`
  `buildPlanVerdict`):
  - `deriveChainStatus(record: ChainRecord): ChainStatus` implements the
    four-rule, first-match-wins precedence **exactly**: (1) any node outcome with
    `verdict === "ESCALATE"` → `"AWAITING_PLAN_APPROVAL"`; (2) else any outcome
    with `status === "FAILED"` → `"FAILED"`; (3) else every `record.plan.nodes`
    id present in `record.nodeOutcomes` with `status === "SUCCESS"` →
    `"SUCCESS"`; (4) else `"RUNNING"`. ESCALATE correctly outranks FAILED. Rules
    1–2 scan `Object.values(record.nodeOutcomes)`; rule 3 uses
    `record.plan.nodes.every(node => record.nodeOutcomes[node.id]?.status === "SUCCESS")`
    — the `?.` guard makes a missing node fall through to RUNNING, matching the
    spec's "every plan node present … with SUCCESS" reading.
  - `advanceChain(record, nodeId, outcome): ChainRecord` folds one sealed node
    by spreading into a new record (`...record`, `nodeOutcomes: {...record.nodeOutcomes, [nodeId]: outcome}`)
    then recomputing `status` via `deriveChainStatus` on the new record. All
    other fields (`planId`, `plan`, `planVerdict`, `nodeRuns`) carry through
    unchanged; no mutation of the input or its nested maps.
  - Pure: reads only its arguments, no I/O / clock / randomness / id-gen.
    `ChainRecord`, `ChainStatus`, `NodeOutcome` imported **type-only** from
    `../types.js`; each export carries a JSDoc citing WP-219 / ADR-005 D3/D4.
    Named exports only, no default export.
- **`packages/sdk-ts/src/index.ts`** — one added line
  (`export { advanceChain, deriveChainStatus } from "./chain/advance.js";`) at
  `index.ts:72`, slotted into the planner re-export block right after the
  `buildPlanVerdict` line, following the explicit named re-export convention.
  Nothing else changed.
- **`packages/sdk-ts/test/chain/advance.test.ts`** (new) — 6 vitest cases over a
  readable 3-node (`N-1`→`N-2`→`N-3`) `ChainRecord` builder, importing the
  functions from the package barrel (`../../src/index.js`) and the types from
  `../../src/types.js`. Covers every assertion the spec named: rule 4 RUNNING,
  rule 3 SUCCESS, rule 2 FAILED, rule 1 ESCALATE-outranks-FAILED precedence,
  the `advanceChain` fold (new outcome present + status consistent with
  `deriveChainStatus`), and immutability (input `record` unchanged — same
  `nodeOutcomes` keys, same `status`, `N-2` still undefined — and the returned
  record is a different object).

`types.ts` / `schemas.ts` / contract models were not touched — confirmed by the
phase-0 scope check (only `index.ts` `M`, the two new files `A`).

Independent checks from the phase-0 verifier, re-run against the working tree:

```text
AC-1 pnpm install --prefer-offline --silent && pnpm --filter @chikory/sdk exec vitest run test/chain/advance.test.ts  PASS (6 passed)
AC-2 pnpm --filter @chikory/sdk test                                                                                  PASS (345 passed | 19 skipped)
AC-3 pnpm --filter @chikory/sdk typecheck && pnpm --filter @chikory/sdk lint                                          PASS (tsc + tsc -p tsconfig.test.json + eslint clean)
```

The suite grew +6 to 345 pass / 19 skip. Harvest integrity held: all three
changed files are byte-`IDENTICAL` to the run workspace (phase-0 §5). The diff is
uncommitted on the working tree, left for the user's review per the skill
default; when committed, run `scripts/dogfood-landed-scope.sh` to confirm the
landing-scope MATCH (the F-31 guard, WP-231/dogfood-032).

## New friction

No new friction numbers. Highest existing remains **F-31** (dogfood-031, closed
by WP-231/dogfood-032).

Other anomaly checks:

- **Wasted steps**: none. One productive step, no trailing probe. F-11 stays
  closed for a fourteenth straight one-step run.
- **Cost telemetry**: exact sum $0.8493; budget used 17.0 %; judge share 1.0 %
  ($0.0087). Metering nonzero and consistent with the pricing table; no `.00`
  with nonzero tokens; no `UNPRICED` warning.
- **Token economics**: step 1 used **625k input / 5.9k output** for a 5785-byte
  three-file diff over 27 tool calls. The one-step pure-slice series now reads
  021 862k → 022 969k → 023 451k → 024 976k → 025 467k → 026 807k → 027 527k →
  028 410k → 029 462k → 030 434k → 031 375k → 033 327k → 034 594k → 035 318k →
  036 398k → **038 625k** (032 excluded — a 2-step run; 037 not yet run). High-mid
  band, within the established sawtooth (well under the 022/024 ~970k peaks),
  tracking neither diff size nor run order; per-step input cost remains *noisy,
  not monotonic*. WP-203/WP-207 stay queued as the variance/ceiling lever, not a
  runaway-trend fix.
- **Judge behavior**: the judge executed all three check commands (AC-1 the new
  reducer test, AC-2 the full SDK suite, AC-3 typecheck + lint), each exited 0,
  and correctly PROCEEDed. Rubric (`tests_pass`, `no_unrelated_deletions`,
  `no_secrets_introduced`, `scope_matches_instruction`) all passed with sane
  justifications ("changes are strictly limited to the S3 pure state reducer
  implementation, its tests, and its re-export from the packages/sdk-ts
  barrel"). Family diversity real (Gemini judge ≠ OpenAI executor).
- **Human ceremony**: standard single launch + watch-to-terminal (F-30 did not
  recur). No zero-step residue this run.
- **Loop integrity**: one checkpoint (`run-61e8b0a1@3`, commit `7f20a68c212f`,
  `lastGood true`), no rollback, no resume, no duplicate journal entries.

## Verdict on the thesis

- **The WP-219 S3-pure reducer now exists — the queue is back on the keystone.**
  After two mechanical WP-201 parity ports (dogfood-035/036), this slice
  delivered the actual value lever the architect's hand-design unblocked: the
  `computeVerdict` analog the durable chain executor consumes. `advanceChain` +
  `deriveChainStatus` join the landed `readyNodes` / `hasDependencyCycle` as the
  complete S3-pure primitive set — the chain dependency-graph, status-derivation,
  and node-fold logic are all pure, unit-tested, and contract-free.
- **The dogfoodable pure surface of WP-219 S3 is now exhausted.** Everything that
  remains is the non-pure **S3-wiring** keystone (hand-design, TASK-PROTOCOL §4):
  the Temporal chain executor that loops `readyNodes` over the meta-judge-gated
  `Plan`, spawns a child run per node from the predecessor checkpoint, folds each
  sealed node's `NodeOutcome` through `advanceChain`, and halt-and-replans on a
  `FAILED` seal (ADR-005 D3) — plus `node_started`/`node_sealed` journaling, S4
  context handoff, S5 suspend/resume, and the S6 chain trace.
- **The F-11 fix remains stable.** Dogfood-038 is the fourteenth straight
  one-step, marker-triggered SUCCESS with no empty-diff probe.
- **No process finding emerged.** The remaining dogfoodable thread is the WP-201
  context-window pacing parity port (dogfood-037), already written and queued
  ("not yet run, deprioritized behind 038"); it is now the next run. The keystone
  after the parity thread stays the hand-design S3 durable chain executor.
