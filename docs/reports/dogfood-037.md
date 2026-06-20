# Dogfood-037 — WP-219 S6: the pure chain-trace renderer (SUCCESS in ONE step; no new friction; fifteenth straight probe-free run)

**WP**: WP-219 (Goal decomposition & run chaining, ADR-005 §S6) · **Date**: 2026-06-20 · **Task spec**: [`examples/dogfood/dogfood-037.yaml`](../../examples/dogfood/dogfood-037.yaml) · **Run**: `run-295b2947-76be-4244-ab01-860360b68cf9` · **Outcome**: **SUCCESS** (judge PROCEED 3/3) · **Landed**: harvested byte-`IDENTICAL`, uncommitted on the working tree (pending the user's review)

> Thirty-ninth campaign, thirty-eighth first-attempt SUCCESS (dogfood-017 the
> lone FAILED). The chain forensics surface. After the S3-pure reducer
> (dogfood-038) and the hand-landed S3-wiring substrate (the `ChainJournal` store
> + `chainLoop` Temporal workflow), there is finally a chain journal to render —
> so this slice delivers `renderChainTrace`, the chain-level analog of the per-run
> `renderTrace`, in a new `packages/sdk-ts/src/chain/trace.ts`. Given a
> `ChainRecord` (plan tree + node→run map + per-node outcomes) and the chain
> journal's `ChainEntry[]`, it returns one multi-line string a person who didn't
> run the chain can read to reconstruct it. Pure string-building, NO I/O. The
> `chikory trace <chain-id>` CLI branch that loads the `ChainJournal` and calls
> this renderer is the hand-design follow-up (TASK-PROTOCOL §4). A P2-exit-gate
> input: the 24 h chain must be legible in trace.

## The run

Zero-secrets setup unchanged: Codex executor (OpenAI family) + Gemini judge
behind the OpenAI-compatible shim. Family diversity held (executor `openai`,
judge `gemini-3.1-pro-preview`).

```text
run run-295b2947-76be-4244-ab01-860360b68cf9 · SUCCESS · 1 steps · $1.06 / $5.00 · 4m 36s · executor codex(openai) · judge openai-compat
 1   Implemented WP-219 S6 chain trace r…  793k/6.3k  $1.05  ✓ PROCEED (3/3 criteria)
totals: decisions 1 · judge passes 1 ($0.01, 0.9%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 1 · feedback frequency 1/1 steps
        issues found 0 · changes made 1 (issues:changes 0:1)
        components over time: s0 j@0
```

There was no empty-diff probe step. The productive step emitted the completion
marker, the judge fired on that step, and SUCCESS sealed at
`components over time: s0 j@0` — the F-11-closed shape, held for a **fifteenth**
straight one-step run (the spec predicted exactly this).

## Delivery quality (human review, post-landing)

The delivered diff matches the spec's exact three-file scope (7151-byte diff,
two new files + one re-export line, no other file touched):

- **`packages/sdk-ts/src/chain/trace.ts`** (new, 57 lines) — reviewed line by
  line against the spec's render order and the reference per-run renderer
  (`src/cli/trace.ts` `renderTrace`):
  - `renderChainTrace(record: ChainRecord, entries: ChainEntry[]): string` builds
    a `string[]` joined by `"\n"` in the exact spec order:
    1. header — `chain ${planId} · ${status} · ${total} nodes · ${succeeded}/${total} succeeded`,
       with `total = record.plan.nodes.length` and `succeeded` counting nodes
       whose `record.nodeOutcomes[node.id]?.status === "SUCCESS"`;
    2. `goal: ${record.plan.goal}`;
    3. a 60-wide `"─".repeat(60)` rule (`RULE_WIDTH = 60` constant);
    4. one row per node **in `record.plan.nodes` order** (not outcome order):
       `${node.id} · depends-on ${deps} · run ${run} · ${outcomeCell}`, where
       `deps = node.dependsOn.join(",")` or `"—"` when empty, and
       `run = record.nodeRuns[node.id] ?? "—"`;
    5. totals footer `totals: nodes ${total} · succeeded ${S} · failed ${F} · pending ${P}`
       with `P = total - S - F`;
    6. a final `failed: ${reason}` line **iff** `entries` holds a `terminal`
       entry whose payload `status === "FAILED"` with a non-empty `reason`.
  - The local unexported `outcomeCell(record, node)` helper returns `"· pending"`
    when the outcome is absent, `✓ SUCCESS (${verdict})` for SUCCESS, and
    `⛔ FAILED (${verdict})` for FAILED — the `switch (outcome.status)` is
    exhaustive because `NodeOutcome.status` is `TerminalStatus`
    (`"SUCCESS" | "FAILED"`), so the no-default form typechecks (AC-3 green).
  - Pure: reads only its two arguments, returns the joined string, no mutation,
    no I/O / clock / randomness. `ChainRecord` + `PlanNode` imported **type-only**
    from `../types.js`, `ChainEntry` **type-only** from `./store.js`. The terminal
    payload is read through a local `interface TerminalPayload { status; reason? }`
    cast (the `ChainEntry.payload` field is `unknown`). JSDoc on the export cites
    WP-219 / ADR-005 §S6. Named export only, no default.
- **`packages/sdk-ts/src/index.ts`** — one added line at `index.ts:73`
  (`export { renderChainTrace } from "./chain/trace.js";`), slotted right after
  the `advanceChain` / `deriveChainStatus` chain re-export from dogfood-038.
  Nothing else changed.
- **`packages/sdk-ts/test/chain/trace.test.ts`** (new) — 5 vitest cases over a
  readable 3-node (`N-1`→`N-2`→`N-3`) `ChainRecord` builder, importing
  `renderChainTrace` + the `ChainEntry`/`ChainRecord`/`NodeOutcome` types from the
  package barrel (`../../src/index.js`). Covers every assertion the spec named:
  header identity/count, node rows in plan order (`✓ SUCCESS (PROCEED)` + run id
  for an outcome'd node, `· pending` + `run —` + `depends-on —` for an absent
  one), the `⛔ FAILED (HALT)` cell, the `totals: nodes 3 · succeeded 1 · failed 1 · pending 1`
  footer, and the terminal-reason branch (`failed: chain stuck` appended only when
  a `terminal` `{ status: "FAILED", reason }` entry is present; absent otherwise).

`types.ts` / `schemas.ts` / `store.ts` / contract models were not touched —
confirmed by the phase-0 scope check (only `index.ts` `M`, the two new files
`A`). No CLI command wiring was added (the `chikory trace <chain-id>` branch is
the hand-design follow-up).

Independent checks from the phase-0 verifier, re-run against the working tree:

```text
AC-1 pnpm install --prefer-offline --silent && pnpm --filter @chikory/sdk exec vitest run test/chain/trace.test.ts  PASS (5 passed)
AC-2 pnpm --filter @chikory/sdk test                                                                                PASS (365 passed | 19 skipped)
AC-3 pnpm --filter @chikory/sdk typecheck && pnpm --filter @chikory/sdk lint                                        PASS (tsc + tsc -p tsconfig.test.json + eslint clean)
```

The suite grew +5 to 365 pass / 19 skip (049 of 051 test files; 360 pre-run from
the hand-landed S3-wiring substrate + this slice's 5). Harvest integrity held:
all three changed files are byte-`IDENTICAL` to the run workspace (phase-0 §5).
The diff is uncommitted on the working tree, left for the user's review per the
skill default; when committed, run `scripts/dogfood-landed-scope.sh` to confirm
the landing-scope MATCH (the F-31 guard, WP-231/dogfood-032).

## New friction

No new friction numbers. Highest existing remains **F-31** (dogfood-031, closed
by WP-231/dogfood-032).

Other anomaly checks:

- **Wasted steps**: none. One productive step, no trailing probe. F-11 stays
  closed for a fifteenth straight one-step run.
- **Cost telemetry**: exact sum $1.0639; budget used 21.2 %; judge share 0.9 %
  ($0.0095). Metering nonzero and consistent with the pricing table; no `.00`
  with nonzero tokens; no `UNPRICED` warning.
- **Token economics**: step 1 used **793k input / 6.3k output** for a 7151-byte
  three-file diff over 28 tool calls. The one-step pure-slice series now reads
  021 862k → 022 969k → 023 451k → 024 976k → 025 467k → 026 807k → 027 527k →
  028 410k → 029 462k → 030 434k → 031 375k → 033 327k → 034 594k → 035 318k →
  036 398k → 038 625k → **037 793k** (032 excluded — a 2-step run). High band —
  the fourth-highest of the series, below the 022/024 ~970k and 026 807k peaks,
  above this slice's parity-port neighbours (035 318k / 036 398k). The extra
  input over those mechanical ports is explainable: this slice reads the
  freshly-landed S3-wiring substrate (`store.ts` `ChainEntry`, `cli/trace.ts`
  reference renderer, the chain contracts) rather than 1:1-porting one source
  file. Still tracks neither diff size nor run order; per-step input cost remains
  *noisy, not monotonic*. WP-203/WP-207 stay queued as the variance/ceiling
  lever, not a runaway-trend fix.
- **Judge behavior**: the judge executed all three check commands (AC-1 the new
  renderer test, AC-2 the full SDK suite, AC-3 typecheck + lint), each exited 0,
  and correctly PROCEEDed. Rubric (`tests_pass`, `no_unrelated_deletions`,
  `no_secrets_introduced`, `scope_matches_instruction`) all passed with sane
  justifications ("changes are strictly limited to the implementation of the
  renderChainTrace renderer, its export in index.ts, and its tests"). Family
  diversity real (Gemini judge ≠ OpenAI executor). 21136 evidence bytes, 40 s.
- **Human ceremony**: standard single launch + watch-to-terminal (F-30 did not
  recur). No zero-step residue this run.
- **Loop integrity**: one checkpoint (`run-295b2947@3`, commit `b56d0db49a58`,
  `lastGood true`), no rollback, no resume, no duplicate journal entries.

## Verdict on the thesis

- **The chain now has a pure, unit-tested forensics renderer.** `renderChainTrace`
  is the `chikory trace` analog for a chain — the durable chain's legibility
  surface, and a Phase-2-exit-gate input (the 24 h chain must be readable in
  trace). It joins `readyNodes` / `hasDependencyCycle` / `advanceChain` /
  `deriveChainStatus` as the chain executor's pure substrate, all unit-tested and
  contract-free.
- **The dogfoodable pure surface of the WP-219 chain executor is now exhausted.**
  What remains is non-pure hand-design (TASK-PROTOCOL §4): the `chikory trace <chain-id>`
  CLI branch that loads the `ChainJournal` and calls `renderChainTrace`, plus the
  S3-wiring D3 replan, S4 context handoff, and S5 suspend/resume keystones.
- **The F-11 fix remains stable.** Dogfood-037 is the fifteenth straight
  one-step, marker-triggered SUCCESS with no empty-diff probe.
- **No process finding emerged.** With the chain executor's pure surface
  exhausted, the next dogfoodable thread returns to **WP-201 dual-SDK parity** —
  the Python port of the dogfood-038 chain-state reducer (`advance_chain` +
  `derive_chain_status`), whose `ChainRecord` / `NodeOutcome` / `ChainStatus`
  contracts already landed in `sdk-py`. The keystone after the parity thread stays
  the hand-design chain CLI + S3-wiring.
