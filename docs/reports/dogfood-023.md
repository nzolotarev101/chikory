# Dogfood-023 — WP-219 S2 Slice 2: the pure plan-assembly half (`buildPlan`, clean SUCCESS in ONE step — F-11 stays closed, no probe; input tokens fell to a recent low)

**WP**: WP-219 (S2 Slice 2, the pure plan-assembly half) · **Date**: 2026-06-15 · **Task spec**: [`examples/dogfood/dogfood-023.yaml`](../../examples/dogfood/dogfood-023.yaml) · **Run**: `run-2d40ded5-d3be-46a5-8884-c6490e711e26` · **Outcome**: **SUCCESS** (judge PROCEED 3/3) · **Landed**: harvested IDENTICAL, uncommitted on `main`

> Twenty-third campaign, twenty-second first-attempt SUCCESS. With the F-11 probe
> retired (dogfood-022), this is now the *normal* shape: a single productive step
> emits `CHIKORY_TASK_COMPLETE`, the judge fires off-cadence on that step
> (`components over time: s0 j@0`), and SUCCESS seals — no empty-diff probe step.
> The delivery is the second and last pure half of the S2 planner:
> `buildPlan(reply, input, opts): Plan` mirrors the judge's `buildVerdict` — it
> assembles a validated `Plan` from the planner's schema-valid `{ nodes }` reply,
> leaving the JSON parse / id / clock to the non-pure `decompose` wrapper. **No
> new friction.** Notable bright spot: input tokens fell to **451k** — the lowest
> of the last four runs, half of dogfood-022's 969k high.

## The run

Zero-secrets setup unchanged: Codex executor (OpenAI family) + Gemini judge
behind the local OpenAI-compatible shim. Family diversity held (judge
`gemini-3.1-pro-preview` ≠ executor `codex`/openai).

```text
run run-2d40ded5... · SUCCESS · 1 steps · $0.64 / $5.00 · 4m 10s · executor codex(openai) · judge openai-compat
 1   Implemented WP-219 S2 Slice 2: - Ad…  451k/4.2k  $0.61  ✓ PROCEED (3/3 criteria)
totals: decisions 1 · judge passes 1 ($0.03, 5.2%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 1 · feedback frequency 1/1 steps
        issues found 0 · changes made 1 (issues:changes 0:1)
        components over time: s0 j@0
```

**One step. No probe.** `components over time: s0 j@0` — the judge fired *at* the
productive step (the F-11-closed shape, not the `s0 s1 j@1` probe signature of
dogfood-021 and its twenty predecessors). The step-0 summary ended with
`CHIKORY_TASK_COMPLETE` → `claimsCompleteFromSummary` set `claimsComplete ===
true` → `isCompletionMilestone` fired the judge off-cadence → PROCEED sealed
SUCCESS. The phase-0 evidence pack confirms it independently: `probe step: none
detected (no empty-diff step) — F-11 did not recur this run`.

## Delivery quality (human review, post-landing)

The functional delivery matches the spec line by line, exactly three files, and
is a faithful structural mirror of the judge's pure `buildVerdict`:

- **`packages/sdk-ts/src/planner/assemble.ts`** (new, 45 lines) — type-only
  imports of `Plan`, `PlanInput`, `PlanNode` from `../types.js`; JSDoc citing
  WP-219 S2 / ADR-005 D1 on both exports:
  - `interface BuildPlanOptions { id: string; createdAt: string }` — the two
    non-deterministic fields the (later, non-pure) `decompose` wrapper injects,
    keeping `buildPlan` pure exactly as `buildVerdict` takes `runId`/`costUsd`
    in its options.
  - `buildPlan(reply: { nodes: PlanNode[] }, input: PlanInput, opts:
    BuildPlanOptions): Plan` — validates STRUCTURE (not quality) before
    assembling, throwing a plain `Error` on each violation: (a) non-empty nodes
    (`"planner returned no nodes"`); (b) unique ids via a private
    `collectNodeIds` helper (`"duplicate plan node id: <id>"`); (c) every
    `dependsOn` id references an existing node (`"plan node <nodeId> depends on
    unknown node <depId>"`). Returns `{ id: opts.id, goal: input.goal, nodes:
    reply.nodes, createdAt: opts.createdAt }` only when all three pass.
  - **Verified against the frozen contract**: the returned object is exactly
    `Plan` (`types.ts:434` — `id`, `goal`, `nodes`, `createdAt`), no extra or
    missing field. No mutation of `reply`/`input`/`reply.nodes`; no I/O, clock,
    or id generation — genuinely pure, as the spec required and the rubric
    confirmed.
- **`packages/sdk-ts/src/index.ts`** — exactly one re-export line,
  `export { buildPlan, type BuildPlanOptions } from "./planner/assemble.js";`,
  placed immediately after the `buildPlannerMessages` re-export as instructed.
  Nothing else.
- **`packages/sdk-ts/test/planner/assemble.test.ts`** (new, 5 tests) — covers
  all five required assertions plus the explicitly-requested non-mutation case:
  happy path (`id`/`createdAt` from `opts`, `goal` from `input`, nodes in
  order); empty nodes throws `"no nodes"`; duplicate id throws (message
  contains the duplicated id); dangling `dependsOn` throws (message names both
  the node and the unknown dep); and `reply.nodes` length + ids unchanged after
  the call. Fixture is a valid two-node reply (`N-1` empty `dependsOn`, `N-2`
  depends on `N-1`), a `PlanInput`, and a `BuildPlanOptions`.

Scope discipline held: no router/agent-loop/contract/type/schema/journal/prompt
change, no new dependency, no `decompose` impl, no `JSON.parse` — exactly the
pure half the spec carved out. Exactly three files (one new source, one edited
source, one new test), as instructed down to the count.

Independent verification (working tree): AC-1 plan-assembly 5 passed · AC-2 full
SDK suite 272 passed / 19 skipped · AC-3 typecheck (both `tsc` passes, incl. the
WP-230 `tsconfig.test.json` over `test/**`) + lint clean. Scope = exactly the
three named files; harvest byte-diff **IDENTICAL** on all three.

**WP-219 S2 is functionally done at the pure layer.** Both halves — prompt
construction (dogfood-022) and reply assembly (this run) — are now pure,
isolated, and unit-tested. The only S2 piece left is the thin non-pure
`decompose` wrapper (route `buildPlannerMessages` through the `plan` stage,
`JSON.parse` the reply, call `buildPlan`), which is hand-design (TASK-PROTOCOL
§4, LLM call).

## New friction

**None.** The anomaly checklist came back clean:

- **Wasted steps**: **zero** — one productive step, no empty-diff probe (the
  F-11-closed shape, now the established norm).
- **Cost telemetry**: $0.6054 step + $0.0332 judge = $0.6386, all non-zero,
  models priced; no `UNPRICED`/blind-meter warning. Sound. Cheapest run since
  the probe was retired (budget used 12.8 %).
- **Judge**: one pass, all three judge-executed checks exited 0 (not a form-only
  PROCEED), rubric justifications accurate (scope/no-deletions/no-secrets all
  true and specific), verdict a true positive. Family diversity real
  (`gemini-3.1-pro-preview` ≠ codex/openai).
- **Human ceremony**: launched once, watched to terminal. **F-30 did not recur**
  — single run for this spec, no duplicate launch.
- **Loop integrity**: one checkpoint (`run-2d40ded5...@3`, `lastGood true`), no
  duplicate journal entries, no re-execution.

Baseline data:

- **Token economics**: step 1 = **451k input / 4.2k output** for a 4655-byte
  diff (one new 45-line source file, a one-line re-export, a ~79-line test)
  across 19 tool calls. This is the **lowest input-token count of the last four
  runs** (dogfood-022 969k, 021 862k, 020 646k, 019 921k) and roughly half the
  022 high. The change is comparably small to 022's, so the drop is most likely
  codex repo-search variance rather than a structural improvement — but it is a
  useful counter-data-point to 022's "the trend keeps climbing" worry: the
  productive-step input cost is noisy, not monotonic. Still the standing
  motivation for WP-203 compaction / WP-207 pacing; not new friction.

## Verdict on the thesis (twenty-third data point — the pure-slice method completes S2's deterministic surface)

- **WP-219 S2's pure surface is complete.** The judge component was carved into
  a pure prompt half (`buildJudgeMessages`) and a pure verdict-assembly half
  (`buildVerdict`); the S2 planner now mirrors that decomposition exactly —
  `buildPlannerMessages` (dogfood-022) + `buildPlan` (this run). Both dogfooded
  cleanly as one-step pure slices because the contracts (`Plan`/`PlanNode`/
  `PlanInput`/`PlanVerdict`) were frozen by hand first. The remaining
  `decompose` wrapper is a single LLM call wrapping these two pure functions —
  hand-design territory, but its risky logic is already pure and tested.
- **The F-11-closed loop shape is holding.** Two consecutive runs (022, 023)
  have now sealed SUCCESS in one productive step with no probe. The
  longest-running friction of the campaign is not just retired in code — it is
  observably the steady-state behavior.
- **Cost is noisy, not monotonic.** dogfood-022 flagged a climbing input-token
  trend as the next watch-item; this run came in at half that. The honest read:
  per-step input cost on small, well-specified changes is high (hundreds of k
  tokens) and *variable*, which keeps WP-203/WP-207 on the priority list, but
  there is no evidence of a one-way ratchet. Correctness, scope, telemetry, and
  loop integrity all held.
- Next: **WP-219 S2b — the pure plan meta-judge prompt half** (`buildPlanJudgeMessages`
  + `PLAN_JUDGE_SYSTEM_PROMPT` + `PLAN_VERDICT_RESPONSE_SCHEMA`), mirroring the
  judge's pure prompt half (`judge/prompt.ts`) exactly as dogfood-022 did for
  the planner. The plan meta-judge (ADR-005 D2) grades a `Plan` against the
  goal's acceptance criteria and emits a `PlanVerdict` (`PROCEED`/`REVISE`/
  `ESCALATE`); `PlanVerdict` and the pure `planCoverageGaps` coverage check are
  already landed, so the prompt regime is a clean one-step pure dogfood
  (dogfood-024). The non-pure plan-judge harness (router call + parse + verdict
  assembly) is the later hand-design follow-up.
