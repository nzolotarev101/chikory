# Dogfood-022 — WP-219 S2 Slice 1: the pure goal-planner prompt half (clean SUCCESS in ONE step — **F-11 closed by observation**, no probe step)

**WP**: WP-219 (S2 Slice 1, the pure prompt half) · **Date**: 2026-06-15 · **Task spec**: [`examples/dogfood/dogfood-022.yaml`](../../examples/dogfood/dogfood-022.yaml) · **Run**: `run-499218ef-a164-4afa-9e8d-6b37c38ca78e` · **Outcome**: **SUCCESS** (judge PROCEED 3/3) · **Landed**: harvested IDENTICAL + staged on `main`, pending commit

> Twenty-second campaign, twenty-first first-attempt SUCCESS. The delivery is a
> textbook pure slice — `planner/prompt.ts` mirrors `judge/prompt.ts` symbol for
> symbol — but **the headline is in the trace, not the diff: the run sealed
> SUCCESS in ONE step with no empty-diff probe step.** This was the F-11
> kill-test dogfood-021 named: the first real run on post-Slice-B code where the
> executor emits `CHIKORY_TASK_COMPLETE`. It worked end-to-end — step 1's summary
> carried the marker, `claimsCompleteFromSummary` set `claimsComplete === true`,
> `isCompletionMilestone` fired the judge off-cadence on the productive step, and
> the loop terminated without the no-op probe step that taxed twenty prior runs
> 5.4 %–35.1 %. **F-11 is closed by observation.** No new friction.

## The run

Zero-secrets setup unchanged: Codex executor (OpenAI family) + Gemini judge
behind the local OpenAI-compatible shim. Family diversity held (judge
`gemini-3.1-pro-preview` ≠ executor `codex`/openai).

```text
run run-499218ef... · SUCCESS · 1 steps · $1.30 / $5.00 · 4m 10s · executor codex(openai) · judge openai-compat
 1   Implemented WP-219 S2 Slice 1 with …  969k/4.7k  $1.26  ✓ PROCEED (3/3 criteria)
totals: decisions 1 · judge passes 1 ($0.04, 2.9%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 1 · feedback frequency 1/1 steps
        issues found 0 · changes made 1 (issues:changes 0:1)
        components over time: s0 j@0
```

**One step. No probe.** Compare the shape to every prior campaign:
`components over time: s0 j@0` — the judge fired *at* the productive step
(`j@0`), not after a trailing empty-diff step (`s0 s1 j@1`, the F-11 signature
of dogfood-021 and its twenty predecessors). The judge ran once, executed all
three acceptance checks (each exited 0), graded the diff, and PROCEEDed 3/3
criteria + 4/4 rubric.

## The F-11 kill-test (the journal proof)

dogfood-021 delivered the runner-side consumption (`claimsCompleteFromSummary`
→ `StepRecord.claimsComplete`) but ran the pre-Slice-B HEAD, so it paid F-11 one
last time and left closure "one observation away." This run *is* that
observation. The step-0 journal record:

```json
"summary": "Implemented WP-219 S2 Slice 1 ...\n\nCHIKORY_TASK_COMPLETE",
"status": "SUCCESS",
"claimsComplete": true
```

The chain fired exactly as designed: the executor ended its productive step's
summary with `CHIKORY_TASK_COMPLETE` on its own line → `claimsCompleteFromSummary`
returned `true` → `StepRecord.claimsComplete === true` on the SUCCESS branch →
`isCompletionMilestone(record)` triggered the judge off-cadence (cadence was 2,
but the milestone OR fired at step 0) → a PROCEED sealed SUCCESS with **no probe
step taken**. The phase-0 evidence pack confirms it independently:
`probe step: none detected (no empty-diff step) — F-11 did not recur this run`.

The marker protocol (hand-landed), Slice A's pure trigger, and Slice B's pure
consumption now compose into a live cost win — verified, not just plumbed.

## Delivery quality (human review, post-landing)

The functional delivery matches the spec line by line, exactly three files, and
is a faithful structural mirror of `judge/prompt.ts`:

- **`packages/sdk-ts/src/planner/prompt.ts`** (new) — three pure exports, each
  with a JSDoc citing WP-219 S2 / ADR-005 D1, type-only imports of `Message`,
  `PlanInput`, `AcceptanceCriterion` from `../types.js`:
  - `PLANNER_SYSTEM_PROMPT: string` — a `[ ... ].join("\n")` block (the
    `JUDGE_SYSTEM_PROMPT` idiom) framing the model as a goal decomposer: ordered
    dependency tree of judge-gated slices, each node a self-contained 1–3-step
    brief, every goal criterion covered by ≥1 node, `dependsOn` lists prerequisite
    SUCCESS ids, per-node `budgetUsd` sums within the chain budget, ending with
    "Respond with a single JSON object matching the requested schema."
  - `PLAN_RESPONSE_SCHEMA` (`as const`) — JSON Schema for `{ nodes: [...] }`; the
    node item schema's `required` lists all five `PlanNode` fields
    (`id`,`goal`,`acceptanceCriteria`,`dependsOn`,`budgetUsd`); the nested
    `acceptanceCriteria` item schema matches `AcceptanceCriterion`
    (`id`,`description` required, `check` optional). Verified field-for-field
    against `types.ts:421` (`PlanNode`).
  - `buildPlannerMessages(input): Message[]` — exactly two messages,
    `[system, user]`; the user content renders the goal, the criteria (private
    `renderCriteria` helper → `- <id>: <description>`, `(none defined)` when
    empty), and the chain `budgetUsd` under clear `##` section headers. Does
    **not** reference `input.family` (correctly the meta-judge's concern, per the
    spec's explicit exclusion).
- **`packages/sdk-ts/src/index.ts`** — exactly one re-export line,
  `export { buildPlannerMessages, PLANNER_SYSTEM_PROMPT, PLAN_RESPONSE_SCHEMA } from "./planner/prompt.js";`,
  placed immediately after the `planCoverageGaps` re-export as instructed.
  Nothing else.
- **`packages/sdk-ts/test/planner/prompt.test.ts`** (new) — four tests covering
  all five required assertions: two-message `[system, user]` ordering; system
  content `=== PLANNER_SYSTEM_PROMPT`; user content contains the goal, both
  criterion ids+descriptions, and the `budgetUsd` as a string; empty
  `acceptanceCriteria` → `(none defined)` without throwing; schema `required`
  includes `"nodes"` and the node item `required` equals the five PlanNode
  fields. Fixture is a valid `PlanInput` (non-empty goal, two criteria,
  `budgetUsd: 12.5`, `family: "anthropic"`).

Scope discipline held: no router/agent-loop/contract/type/schema/journal change,
no new dependency, no `decompose` impl — exactly the pure half the spec carved
out. The non-pure `decompose` wrapper (route through the `plan` stage + parse the
reply into a `Plan`) remains the documented follow-up.

Independent verification (working tree): AC-1 planner-prompt 4 passed · AC-2 full
SDK suite 267 passed / 19 skipped · AC-3 typecheck (both `tsc` passes, incl. the
WP-230 `tsconfig.test.json` over `test/**`) + lint clean. Scope = exactly the
three named files; harvest byte-diff **IDENTICAL** on all three.

**WP-219 S2 Slice 1 is genuinely delivered.** The planner's prompt regime is
now pure, isolated, and unit-tested — ready for a later non-pure `decompose` to
route it through the `plan` stage.

## New friction

**None.** The anomaly checklist came back clean:

- **Wasted steps**: **zero** — the first run in the campaign's history with no
  empty-diff probe step. This is the F-11 win, not a finding.
- **Cost telemetry**: $1.2589 step + $0.0379 judge = $1.2968, all non-zero,
  models priced; no `UNPRICED`/blind-meter warning. Sound.
- **Judge**: one pass, all three judge-executed checks exited 0 (not a form-only
  PROCEED), rubric justifications accurate (scope/no-deletions/no-secrets all
  true), verdict a true positive. Family diversity real
  (`gemini-3.1-pro-preview` ≠ codex/openai).
- **Human ceremony**: launched once, watched to terminal. **F-30 did not recur**
  — single run for this spec, no duplicate launch (operator discipline held).
- **Loop integrity**: one checkpoint, `lastGood true`, no duplicate journal
  entries, no re-execution.

Baseline data:

- **Token economics**: step 1 = 969k input / 4.7k output for a 5463-byte diff
  (one new ~78-line source file, a one-line re-export, a ~56-line test) across
  17 tool calls. This is the campaign's high-water mark for input tokens
  (dogfood-019 921k, dogfood-020 646k, dogfood-021 step 1 862k) — codex's
  repo-search overhead on small, well-specified changes keeps climbing. Not new
  friction (it is the standing motivation for WP-203 compaction / WP-207
  pacing), but the trend is worth watching: the productive step alone now costs
  ~$1.26, and with the F-11 probe gone the *productive* step is the whole run.

## Verdict on the thesis (twenty-second data point — the cost win is now proven, not just plumbed)

- **F-11 is closed.** Twenty campaigns paid a completion-probe tax (5.4 %–35.1 %
  of run cost) for a no-op step whose only job was to let the executor rediscover
  "nothing to do." This run took zero probe steps. The fix is the composition of
  three pure, separately-dogfooded pieces — the marker protocol, Slice A's
  `isCompletionMilestone`, Slice B's `claimsCompleteFromSummary` — and it is now
  verified by a live run, exactly the closure path dogfood-021's verdict named.
  The campaign's longest-running friction item is retired.
- **The pure-slice method keeps paying.** WP-219 S2's non-pure `decompose` makes
  an LLM call and is hand-design territory (TASK-PROTOCOL §4), but its prompt
  half is deterministic — so it dogfooded cleanly, mirroring exactly how the
  judge's pure prompt half (`judge/prompt.ts`) was carved from its non-pure
  harness. Three of WP-219's pillars (S3 `readyNodes`/`hasDependencyCycle`, the
  S2 prompt half) have now landed as pure dogfoods; the contracts that made them
  dogfoodable were the right hand-landed investment.
- **The honest watch-item is cost, not correctness.** With the probe step gone,
  the run is one productive step — and that step cost $1.26 on 969k input
  tokens, a new high. Family diversity, telemetry, scope, and loop integrity all
  held; the delivery is correct. But the token trend is the clearest signal yet
  that the next reliability gain is on the input side (WP-203 compaction /
  WP-207 pacing), not the loop-shape side, which is now tight.
- Next: **WP-219 S2 Slice 2 — the pure plan-assembly half** (`buildPlan(reply,
  input, opts): Plan`, mirroring the judge's `buildVerdict`): take the planner's
  schema-valid reply (`{ nodes }`) plus the `PlanInput` and assemble a validated
  `Plan`, keeping the JSON parse / id / clock in the non-pure `decompose`
  wrapper. The last pure sub-slice of S2 before the non-pure wrapper ties prompt
  → route → parse together. Contracts (`Plan`/`PlanNode`/`PlanInput`) are frozen;
  it is a clean one-step pure dogfood.
