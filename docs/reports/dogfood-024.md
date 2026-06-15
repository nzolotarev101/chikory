# Dogfood-024 — WP-219 S2b: the pure plan meta-judge prompt half (`buildPlanJudgeMessages`, clean SUCCESS in ONE step — F-11 stays closed; input tokens set a new campaign high at 976k)

**WP**: WP-219 (S2b, the pure plan meta-judge prompt half) · **Date**: 2026-06-15 · **Task spec**: [`examples/dogfood/dogfood-024.yaml`](../../examples/dogfood/dogfood-024.yaml) · **Run**: `run-28073328-e185-4686-88b9-a0172ab33530` · **Outcome**: **SUCCESS** (judge PROCEED 3/3) · **Landed**: harvested IDENTICAL, uncommitted on `main`

> Twenty-fourth campaign, twenty-third first-attempt SUCCESS. The F-11-closed
> shape held for a third straight run: one productive step emits
> `CHIKORY_TASK_COMPLETE`, the judge fires off-cadence on that step
> (`components over time: s0 j@0`), SUCCESS seals — no empty-diff probe. The
> delivery carves out the plan meta-judge's pure PROMPT half (ADR-005 D2),
> mirroring the executor judge's `judge/prompt.ts` symbol-for-symbol exactly as
> dogfood-022 did for the planner: `PLAN_JUDGE_SYSTEM_PROMPT` +
> `PLAN_VERDICT_RESPONSE_SCHEMA` + `buildPlanJudgeMessages` turn a decomposed
> `Plan` plus the goal's acceptance criteria into the `Message[]` the (later,
> non-pure) plan-judge harness sends to the router. **No new friction.** The one
> watch-item: input tokens came in at **976k** — a new campaign high, just past
> dogfood-022's 969k and more than double dogfood-023's 451k, confirming
> dogfood-023's read that per-step input cost is *noisy, not monotonic*.

## The run

Zero-secrets setup unchanged: Codex executor (OpenAI family) + Gemini judge
behind the local OpenAI-compatible shim. Family diversity held (judge
`gemini-3.1-pro-preview` ≠ executor `codex`/openai).

```text
run run-28073328... · SUCCESS · 1 steps · $1.31 / $5.00 · 4m 27s · executor codex(openai) · judge openai-compat
 1   Implemented WP-219 S2b pure plan me…  976k/5.5k  $1.27  ✓ PROCEED (3/3 criteria)
totals: decisions 1 · judge passes 1 ($0.04, 2.8%) · rollbacks 0 · escalations 0
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
is a faithful structural mirror of the judge's pure prompt half (`judge/prompt.ts`):

- **`packages/sdk-ts/src/planner/meta-judge-prompt.ts`** (new, 86 lines) —
  type-only imports of `AcceptanceCriterion`, `Message`, `Plan`, `PlanNode`
  from `../types.js`; JSDoc citing WP-219 S2b / ADR-005 D2 on each export:
  - `PLAN_VERDICT_RESPONSE_SCHEMA` (`as const`) — verified field-for-field
    against the frozen `PlanVerdict` contract (`types.ts:475`): object,
    `additionalProperties: false`, `required: ["kind", "rationale",
    "uncoveredCriteria"]`, `kind` a string enum of exactly the three
    `PlanVerdictKind` values `["PROCEED", "REVISE", "ESCALATE"]`, `rationale`
    `{ type: "string" }`, `uncoveredCriteria` `{ type: "array", items: { type:
    "string" } }`. No extra or missing property — the responseSchema mirror is
    exact, the same way `JUDGE_FORM_RESPONSE_SCHEMA` mirrors `JudgeForm`.
  - `PLAN_JUDGE_SYSTEM_PROMPT: string` — a `[ ... ].join("\n")` block in the
    `JUDGE_SYSTEM_PROMPT` idiom: frames the model as an INDEPENDENT plan
    reviewer with no stake in the plan passing; states its only job is judging
    whether the decomposition is sound and complete (every goal criterion
    covered by ≥1 node, dependencies coherent, node scopes self-contained);
    enumerates the three verdict kinds with their semantics (PROCEED→run,
    REVISE→re-plan, ESCALATE→human); requires (a) reasoning into `rationale`,
    (b) every uncovered criterion id in `uncoveredCriteria` (empty on PROCEED);
    forbids judging code/quality (no diff in scope); ends with the standard
    "Respond with a single JSON object matching the requested schema." line.
  - `interface PlanJudgePromptInput { plan: Plan; goalCriteria: AcceptanceCriterion[] }`
    — the decomposed plan under review plus the goal-level criteria it must
    cover, exactly as specified.
  - `buildPlanJudgeMessages(input): Message[]` — returns exactly `[system,
    user]`: the system message carries `PLAN_JUDGE_SYSTEM_PROMPT`; the user
    message is a `[ ... ].join("\n")` block (the `buildJudgeMessages` idiom)
    rendering, under `##` headers, the plan `goal`, the GOAL ACCEPTANCE CRITERIA
    (private `renderCriteria` → `- <id>: <description>` per criterion, or
    `(none defined)` when empty — mirrors `judge/prompt.ts:renderCriteria`), and
    the PLAN NODES (private `renderPlanNode` → each node's `id`, `goal`,
    `dependsOn` list, `budgetUsd`, and its own `acceptanceCriteria` ids). No
    mutation of `input` or its fields; no I/O, clock, or id generation —
    genuinely pure, as the spec required and the rubric confirmed.
- **`packages/sdk-ts/src/index.ts`** — exactly one re-export line,
  `export { buildPlanJudgeMessages, PLAN_JUDGE_SYSTEM_PROMPT, PLAN_VERDICT_RESPONSE_SCHEMA } from "./planner/meta-judge-prompt.js";`,
  placed immediately after the `buildPlan` re-export as instructed. Nothing else.
- **`packages/sdk-ts/test/planner/meta-judge-prompt.test.ts`** (new, 5 tests) —
  covers all the required assertions: messages are `[system, user]` in order
  with the right roles; system content `=== PLAN_JUDGE_SYSTEM_PROMPT`; user
  content contains the plan goal, every goal criterion id, every node id, and a
  node `budgetUsd`; empty `goalCriteria` renders `(none defined)` without
  throwing; `PLAN_VERDICT_RESPONSE_SCHEMA.required` holds all three keys and
  `kind.enum` equals exactly `["PROCEED", "REVISE", "ESCALATE"]`; and the input
  plan is not mutated (`plan.nodes.length` unchanged). Fixture is a valid
  two-node `Plan` (`N-1` empty `dependsOn`, `N-2` depends on `N-1`, each with a
  non-empty goal, a non-empty `acceptanceCriteria`, and a `budgetUsd`) plus a
  goal `AcceptanceCriterion[]`.

Scope discipline held: no router/agent-loop/contract/type/schema/journal/judge/
planner-prompt/planner-assembly change, no new dependency, no `decompose` or
plan-judge harness impl, no `JSON.parse`, no `PlanVerdict` assembly — exactly the
pure prompt half the spec carved out. Exactly three files (one new source, one
edited source, one new test), as instructed down to the count.

Independent verification (working tree): AC-1 plan-judge-prompt 5 passed · AC-2
full SDK suite 277 passed / 19 skipped · AC-3 typecheck (both `tsc` passes, incl.
the WP-230 `tsconfig.test.json` over `test/**`) + lint clean. Scope = exactly the
three named files; harvest byte-diff **IDENTICAL** on all three.

**WP-219 S2b's pure prompt half is landed.** The plan meta-judge now mirrors the
executor judge's pure prompt regime exactly as the S2 planner did. Remaining
S2b: the pure verdict-assembly half (`buildPlanVerdict` mirroring `buildVerdict`,
folding the already-landed pure `planCoverageGaps` into
`PlanVerdict.uncoveredCriteria`) — the next pure sub-slice — then the non-pure
plan-judge harness (router call + `JSON.parse`) and the non-pure
`GoalPlanner.decompose` wrapper, both hand-design (TASK-PROTOCOL §4).

## New friction

**None.** The anomaly checklist came back clean:

- **Wasted steps**: **zero** — one productive step, no empty-diff probe (the
  F-11-closed shape, now three runs deep as the established norm).
- **Cost telemetry**: $1.2746 step + $0.0366 judge = $1.3112, all non-zero,
  models priced; no `UNPRICED`/blind-meter warning. Sound (budget used 26.2 %).
- **Judge**: one pass, all three judge-executed checks exited 0 (not a form-only
  PROCEED), rubric justifications accurate and specific
  (scope/no-deletions/no-secrets all true to the diff), verdict a true positive.
  Family diversity real (`gemini-3.1-pro-preview` ≠ codex/openai).
- **Human ceremony**: launched once, watched to terminal. **F-30 did not recur**
  — single run for this spec, no duplicate launch.
- **Loop integrity**: one checkpoint (`run-28073328...@3`, `lastGood true`), no
  duplicate journal entries, no re-execution.

Baseline data:

- **Token economics**: step 1 = **976k input / 5.5k output** for a 7250-byte
  diff (one new 86-line source file, a one-line re-export, an ~87-line test)
  across 23 tool calls. This is a **new campaign high** for input tokens, just
  past dogfood-022's 969k (prior: 023 451k, 021 862k, 020 646k, 019 921k) — and
  more than **double** the immediately preceding run (023's 451k) for a
  comparably small change. That swing — 451k → 976k across two adjacent
  one-step pure slices of near-identical size — is the cleanest evidence yet that
  per-step input cost is **codex repo-search variance, not a structural
  ratchet**: it moves both ways and is not tracking diff size. Still the standing
  motivation for WP-203 compaction / WP-207 pacing; not new friction.

## Verdict on the thesis (twenty-fourth data point — the plan meta-judge's pure prompt regime mirrors the executor judge's)

- **The judge↔plan-judge symmetry is now real in code.** The executor judge has
  a pure prompt half (`buildJudgeMessages` + `JUDGE_SYSTEM_PROMPT` +
  `JUDGE_FORM_RESPONSE_SCHEMA`) and a pure verdict-assembly half (`buildVerdict`);
  the plan meta-judge (ADR-005 D2) now has the first of those two —
  `buildPlanJudgeMessages` + `PLAN_JUDGE_SYSTEM_PROMPT` +
  `PLAN_VERDICT_RESPONSE_SCHEMA`. Because the `PlanVerdict` contract and the pure
  `planCoverageGaps` check were frozen by hand first, this dogfooded as a clean
  one-step pure slice, same as the S2 planner halves did.
- **The F-11-closed loop shape is steady-state.** Three consecutive runs (022,
  023, 024) have sealed SUCCESS in one productive step with no probe. The
  longest-running friction of the campaign is observably retired, not merely
  patched in code.
- **Cost is noisy, not monotonic — now proven both directions.** dogfood-022
  flagged a climbing input-token trend; dogfood-023 came in at half; this run
  set a new high. Across three adjacent one-step pure slices of near-identical
  size the input cost ran 969k → 451k → 976k. The honest read is unchanged:
  per-step input cost on small, well-specified changes is high (hundreds of k
  tokens) and *variable*, with no one-way ratchet — which keeps WP-203/WP-207 on
  the priority list as a *variance/ceiling* lever, not a runaway-trend fix.
  Correctness, scope, telemetry, and loop integrity all held.
- Next: **WP-219 S2b verdict-assembly half — the pure `buildPlanVerdict`**
  (mirroring the judge's `buildVerdict`), folding the already-landed pure
  `planCoverageGaps(plan, goalCriteria)` into `PlanVerdict.uncoveredCriteria` and
  assembling the validated `PlanVerdict` from a schema-valid `{ kind, rationale }`
  reply. `PlanVerdict` is frozen and `planCoverageGaps` is landed, so it is again
  a clean one-step pure dogfood (dogfood-025). After it, the non-pure plan-judge
  harness (router call + `JSON.parse` + this assembly) and the non-pure
  `GoalPlanner.decompose` wrapper are the hand-design follow-ups (TASK-PROTOCOL
  §4, LLM call).
