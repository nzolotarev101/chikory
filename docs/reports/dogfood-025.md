# Dogfood-025 — WP-219 S2b: the pure plan meta-judge verdict-assembly half (`buildPlanVerdict`, clean SUCCESS in ONE step — F-11 stays closed; input tokens fell back to 467k, the low band)

**WP**: WP-219 (S2b, the pure plan meta-judge verdict-assembly half) · **Date**: 2026-06-15 · **Task spec**: [`examples/dogfood/dogfood-025.yaml`](../../examples/dogfood/dogfood-025.yaml) · **Run**: `run-0d39fd12-c304-4c97-8cbe-b937ca7e371c` · **Outcome**: **SUCCESS** (judge PROCEED 3/3) · **Landed**: harvested IDENTICAL, uncommitted on `main`

> Twenty-fifth campaign, twenty-fourth first-attempt SUCCESS. The F-11-closed
> shape held for a **fourth** straight run: one productive step emits
> `CHIKORY_TASK_COMPLETE`, the judge fires off-cadence on that step
> (`components over time: s0 j@0`), SUCCESS seals — no empty-diff probe. The
> delivery carves out the plan meta-judge's pure VERDICT-ASSEMBLY half (ADR-005
> D2), mirroring the executor judge's `buildVerdict` (`judge/harness.ts:49`):
> the pure `buildPlanVerdict(reply, plan, goalCriteria)` turns the plan judge's
> schema-valid `{ kind, rationale }` reply into a validated `PlanVerdict`,
> folding the already-landed pure `planCoverageGaps` in as the **deterministic
> coverage override** — code, not the LLM, downgrades a `PROCEED` to `REVISE`
> when the plan drops a goal criterion (the reward-hacking-guard analog of the
> judge's JD-4/JD-7 check overrides). **With this, the plan meta-judge's entire
> pure surface is complete** — prompt regime (dogfood-024) + verdict assembly
> (this run) — symbol-for-symbol mirroring the executor judge. **No new
> friction.** Cost watch-item: input tokens came in at **467k**, back in the low
> band next to dogfood-023's 451k and less than half dogfood-024's 976k —
> tightening the read that per-step input cost is *noisy, not monotonic*.

## The run

Zero-secrets setup unchanged: Codex executor (OpenAI family) + Gemini judge
behind the local OpenAI-compatible shim. Family diversity held (judge
`gemini-3.1-pro-preview` ≠ executor `codex`/openai).

```text
run run-0d39fd12... · SUCCESS · 1 steps · $0.66 / $5.00 · 4m 7s · executor codex(openai) · judge openai-compat
 1   Implemented WP-219 S2b verdict asse…  467k/4.0k  $0.62  ✓ PROCEED (3/3 criteria)
totals: decisions 1 · judge passes 1 ($0.04, 5.7%) · rollbacks 0 · escalations 0
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
is a faithful structural mirror of the judge's pure verdict-assembly half
(`judge/harness.ts:49` `buildVerdict`):

- **`packages/sdk-ts/src/planner/meta-judge-verdict.ts`** (new, 35 lines) —
  type-only imports of `AcceptanceCriterion`, `Plan`, `PlanVerdict`,
  `PlanVerdictKind` from `../types.js`; value import of `planCoverageGaps` from
  `./coverage.js`; JSDoc citing WP-219 S2b / ADR-005 D2 on each export:
  - `interface PlanJudgeReply { kind: PlanVerdictKind; rationale: string }` —
    the plan judge's schema-valid reply (the object the later, non-pure harness
    parses out of the model response via the already-landed
    `PLAN_VERDICT_RESPONSE_SCHEMA`), mirroring how `buildVerdict` takes the
    already-parsed `JudgeForm`.
  - `buildPlanVerdict(reply, plan, goalCriteria): PlanVerdict` — computes
    `uncoveredCriteria = planCoverageGaps(plan, goalCriteria)`, then applies the
    **deterministic coverage override**: a `coverageOverride` flag fires only
    when `reply.kind === "PROCEED"` *and* `uncoveredCriteria.length > 0`, in
    which case `kind` downgrades to `"REVISE"` and the override clause is
    appended to the rationale (`… [coverage override: plan leaves goal criteria
    uncovered: <ids joined by ", "> - cannot PROCEED]`); otherwise `reply.kind`
    and `reply.rationale` pass through unchanged. Returns exactly the frozen
    `PlanVerdict` shape `{ kind, rationale, uncoveredCriteria }` — no extra or
    missing field. No mutation of `reply`, `plan`, `goalCriteria`, or the
    `planCoverageGaps` return (the override path builds a fresh object and a new
    template-literal string; `uncoveredCriteria` is returned as-is, never pushed
    to). Genuinely pure — no I/O, clock, or id generation, as the spec required
    and the rubric confirmed.
- **`packages/sdk-ts/src/index.ts`** — exactly one re-export line,
  `export { buildPlanVerdict, type PlanJudgeReply } from "./planner/meta-judge-verdict.js";`,
  placed immediately after the `buildPlanJudgeMessages` re-export (`index.ts:70`)
  as instructed. Nothing else.
- **`packages/sdk-ts/test/planner/meta-judge-verdict.test.ts`** (new, 5 tests) —
  covers all five required assertions on a valid two-node `Plan` fixture (`N-1`
  empty `dependsOn` carrying `AC-1`, `N-2` depends on `N-1` carrying `AC-2`, each
  with a non-empty goal and `budgetUsd`) plus a goal `AcceptanceCriterion[]`:
  full coverage + `PROCEED` passes through (`uncoveredCriteria` empty, rationale
  unchanged); a coverage gap (`AC-3` carried by no node) downgrades `PROCEED` →
  `REVISE`, surfaces `AC-3` in `uncoveredCriteria`, and mentions it in the
  rationale; a non-`PROCEED` reply (`ESCALATE`) with full coverage is preserved
  with its rationale; the verdict has exactly the keys `kind`, `rationale`,
  `uncoveredCriteria`; and the inputs are not mutated (`reply` deep-equal,
  `plan.nodes` and `goalCriteria` length unchanged).

Scope discipline held: no router/agent-loop/contract/type/schema/journal/judge/
planner-prompt/planner-assembly/`coverage.ts` change, no new dependency, no
`decompose` or plan-judge harness impl, no `JSON.parse`, no prompt build —
exactly the pure verdict-assembly half the spec carved out. Exactly three files
(one new source, one edited source, one new test), as instructed down to the
count.

One cosmetic note, not friction: the spec's override-clause example used an
em-dash (`— cannot PROCEED`); the delivery uses a hyphen (`- cannot PROCEED`).
The spec hedged the wording with "e.g." and asserts only that the rationale
*mentions the uncovered id* (which the test checks via `toContain("AC-3")`), so
this is within spec — noted only for completeness.

Independent verification (working tree): AC-1 meta-judge-verdict 5 passed · AC-2
full SDK suite 282 passed / 19 skipped · AC-3 typecheck (both `tsc` passes, incl.
the WP-230 `tsconfig.test.json` over `test/**`) + lint clean. Scope = exactly the
three named files; harvest byte-diff **IDENTICAL** on all three. The
`PlanVerdict` shape was re-checked field-for-field against the frozen contract
(`types.ts:475`: `{ kind, rationale, uncoveredCriteria }`) and `planCoverageGaps`
against its landed signature (`coverage.ts:16`).

**WP-219 S2b's pure surface is landed — the plan meta-judge now mirrors the
executor judge end to end in pure form.** The judge has a pure prompt half
(`buildJudgeMessages` + `JUDGE_SYSTEM_PROMPT` + `JUDGE_FORM_RESPONSE_SCHEMA`) and
a pure verdict-assembly half (`buildVerdict`); the plan meta-judge now has both
(`buildPlanJudgeMessages` + `PLAN_JUDGE_SYSTEM_PROMPT` +
`PLAN_VERDICT_RESPONSE_SCHEMA`, dogfood-024; `buildPlanVerdict`, this run).
Remaining WP-219 is all **non-pure / hand-design** (TASK-PROTOCOL §4, LLM call):
the plan-judge harness (router call + `JSON.parse` over
`PLAN_VERDICT_RESPONSE_SCHEMA` + `buildPlanVerdict`), the `GoalPlanner.decompose`
wrapper (route `buildPlannerMessages` → parse → `buildPlan`), then the S3 chain
executor and beyond.

## New friction

**None.** The anomaly checklist came back clean:

- **Wasted steps**: **zero** — one productive step, no empty-diff probe (the
  F-11-closed shape, now four runs deep as the established norm).
- **Cost telemetry**: $0.6236 step + $0.0375 judge = $0.6611, all non-zero,
  models priced; no `UNPRICED`/blind-meter warning. Sound (budget used 13.2 %).
- **Judge**: one pass, all three judge-executed checks exited 0 (not a form-only
  PROCEED), rubric justifications accurate and specific
  (scope/no-deletions/no-secrets all true to the diff), verdict a true positive.
  Family diversity real (`gemini-3.1-pro-preview` ≠ codex/openai).
- **Human ceremony**: launched once, watched to terminal. **F-30 did not recur**
  — single run for this spec, no duplicate launch.
- **Loop integrity**: one checkpoint (`run-0d39fd12...@3`, `lastGood true`), no
  duplicate journal entries, no re-execution.

Baseline data:

- **Token economics**: step 1 = **467k input / 4.0k output** for a 5396-byte
  diff (one new 35-line source file, a one-line re-export, a ~95-line test)
  across 17 tool calls. This is **back in the low band** next to dogfood-023's
  451k, and **less than half** the immediately preceding run (024's 976k) for a
  comparably small change. Running input-token series across the five adjacent
  one-step pure slices: 021 862k → 022 969k → 023 451k → 024 976k → 025 467k.
  The sawtooth (it has now swung high→low→high→low across four consecutive
  near-identical changes) is the cleanest evidence yet that per-step input cost
  is **codex repo-search variance, not a structural ratchet** — it tracks
  neither diff size nor run order. Still the standing motivation for WP-203
  compaction / WP-207 pacing as a *variance/ceiling* lever; not new friction.

## Verdict on the thesis (twenty-fifth data point — the plan meta-judge's pure surface now fully mirrors the executor judge's)

- **The judge↔plan-judge symmetry is now complete in pure code.** Both the
  prompt regime and the verdict assembly of the plan meta-judge (ADR-005 D2)
  exist as pure, unit-tested functions that mirror the executor judge
  symbol-for-symbol. Crucially, the **deterministic coverage override** in
  `buildPlanVerdict` is the plan-side analog of the judge's check-override
  safety floor: code — not the model — forbids a passing verdict when the plan
  drops a goal criterion. The bias-mitigation thesis (an independent grader the
  executor cannot talk past) now holds at the *plan* layer, not just the step
  layer, and its hardest guarantee is enforced deterministically.
- **The F-11-closed loop shape is steady-state.** Four consecutive runs (022,
  023, 024, 025) have sealed SUCCESS in one productive step with no probe. The
  longest-running friction of the campaign is observably retired, not merely
  patched in code.
- **Cost is noisy, not monotonic — now proven four swings deep.** Across five
  adjacent one-step pure slices of near-identical size the input cost ran 862k →
  969k → 451k → 976k → 467k — a clean sawtooth. The honest read is unchanged:
  per-step input cost on small, well-specified changes is high (hundreds of k
  tokens) and *variable*, with no one-way ratchet — which keeps WP-203/WP-207 on
  the priority list as a *variance/ceiling* lever, not a runaway-trend fix.
  Correctness, scope, telemetry, and loop integrity all held.
- Next: with WP-219's pure surface fully landed and the rest of WP-219 now
  hand-design (TASK-PROTOCOL §4), the next dogfoodable pure slice is **WP-203 S4
  — the compaction-trace renderer** (`formatEntryLine` gains a `case
  "compaction"` rendering a `CompactionResult` payload `tokensBefore→tokensAfter`
  + digest-pointer presence). It is the direct analog of the WP-209 trace slices
  (dogfood-010/011): a pure renderer over a synthetic `JournalEntry[]` fixture,
  no contract change (the `compaction` JIF kind and `CompactionResult` are frozen
  by ADR-006), and — unlike the WP-203 S2 digest wiring, which stays **blocked**
  on the WP-202 Memory Pointer store — needs nothing un-landed (dogfood-026).
