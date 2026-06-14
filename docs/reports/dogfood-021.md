# Dogfood-021 — WP-221 Slice B: runner consumes the completion marker → `claimsComplete` (clean SUCCESS; F-11 fix landed, the kill-test is next run)

**WP**: WP-221 (Slice B, runner-side consumption) · **Date**: 2026-06-14 · **Task spec**: [`examples/dogfood/dogfood-021.yaml`](../../examples/dogfood/dogfood-021.yaml) · **Run**: `run-91eced6b-3632-4d6d-a2a0-b0bf1c44e6bd` · **Outcome**: **SUCCESS** (judge PROCEED 3/3) · **Landed**: harvested + staged on `main`, pending commit

> Twenty-first campaign, twentieth first-attempt SUCCESS. WP-221 Slice B is the
> F-11 cost win: `claimsCompleteFromSummary` now reads the executor's completion
> marker out of `parsed.summary` and sets `StepRecord.claimsComplete` on the
> SUCCESS branch, which Slice A's `isCompletionMilestone` already ORs into the
> WP-217 judge trigger. **The strongest signal in this run is in the journal, not
> the diff: step 1 (the productive step) ended its summary with
> `CHIKORY_TASK_COMPLETE` on its own line, exactly as the hand-landed prompt
> instructs.** With Slice B now in the tree, that summary would set
> `claimsComplete === true`, fire the judge on step 1 directly, and the empty-diff
> probe step would never be taken. This run could not benefit from its own fix —
> the loop ran the HEAD (pre-consumption) code — so F-11 was paid one last time
> (twentieth data point, 26.6 %). **The next dogfood run is the first real
> kill-test of F-11.** No new friction.

## The run

Zero-secrets setup unchanged: Codex executor (OpenAI family) + Gemini judge
behind the local OpenAI-compatible shim. Family diversity held (judge
`gemini-3.1-pro-preview` ≠ executor `codex`/openai).

```text
run run-91eced6b... · SUCCESS · 2 steps · $1.56 / $5.00 · 5m 1s · executor codex(openai) · judge openai-compat
 1   Implemented WP-221 Slice B (detect marker, set claimsComplete)  862k/3.5k  $1.11   (3360-byte diff)
 2   WP-221 Slice B is complete as specified                         320k/1.6k  $0.42   ✓ PROCEED (3/3 criteria)
totals: decisions 2 · judge passes 1 ($0.04, 2.2%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 2 · issues found 0 · changes made 1 (0:1)
        components over time: s0 s1 j@1
```

All real work in step 1 (3360-byte diff). Step 2 was the empty-diff completion
probe (F-11, below). The judge ran once at the cadence-2 boundary, executed all
three acceptance checks (each exited 0), graded the cumulative diff, and
PROCEEDed 3/3 criteria + 4/4 rubric.

## Delivery quality (human review, post-landing)

The functional delivery matches the spec line by line, exactly three files:

- **`packages/sdk-ts/src/executors/step.ts`** — new exported pure
  `claimsCompleteFromSummary(summary: string): boolean`:
  `summary.split("\n").some((line) => line.trim() === COMPLETION_MARKER)`. Stands
  alone on its own line, trimmed; a substring inside a longer line does not match
  (per the prompt contract). Pure, no I/O, JSDoc cites WP-221 and F-11. In the
  SUCCESS branch the record is now
  `{ ...base, status: "SUCCESS", claimsComplete: claimsCompleteFromSummary(parsed.summary) }`;
  the two FAILED branches are untouched (a failed step's completion claim is moot
  and `isCompletionMilestone` already gates on SUCCESS). `COMPLETION_MARKER` and
  the prompt are unchanged, as required.
- **`packages/sdk-ts/src/executors/index.ts`** — `claimsCompleteFromSummary` and
  `COMPLETION_MARKER` added to the existing `export { … } from "./step.js"` block
  alongside `runCliStep`/`SPAN_STEP`/`ParsedCliResult`. Nothing else.
- **`packages/sdk-ts/test/executors/completion-marker.test.ts`** (new) — all six
  required cases, each building the marker from the imported `COMPLETION_MARKER`
  constant (not a hardcoded literal): exact-marker→true, marker-after-text→true,
  indented/trailing-whitespace→true, empty→false, substring-in-sentence→false,
  normal-no-marker→false. Correct booleans throughout.

`claimsComplete` is **not a new field** — `StepRecord.claimsComplete?: boolean`
already exists (`types.ts:182`, landed before Slice A read it); Slice B only
populates it. So "do NOT modify any contract/type/schema/journal format" holds:
no `types.ts`/`schemas.ts`/`CONTRACTS.md`/`sdk-py` change, no new dependency.

Independent verification (working tree): AC-1 completion-marker 6 passed · AC-2
full SDK suite 248 passed / 19 skipped · AC-3 typecheck (both `tsc` passes,
incl. the WP-230 `tsconfig.test.json` covering `test/**`) + lint clean. Scope =
exactly the three named files; harvest byte-diff **IDENTICAL** on all three.

**WP-221 Slice B is genuinely delivered.** The runner now consumes the marker;
combined with the hand-landed protocol (`COMPLETION_MARKER` in `step.ts` +
`renderStepPrompt` instruction) and Slice A's trigger, the F-11 probe step is
wired to retire on the *next* run that emits the marker — see below.

## The validation hiding in the journal

The run's own loop ran HEAD code (pre-Slice-B), so `claimsComplete` is `null`
on both step records in the journal — the consumption this run *adds* was not
yet active. But the executor still did its half of the protocol: **step 1's
summary ends with the marker on its own line**:

```text
Implemented WP-221 Slice B:
- Detects standalone completion markers in successful CLI summaries.
- Sets `StepRecord.claimsComplete`.
...
CHIKORY_TASK_COMPLETE
```

Feed that summary through `claimsCompleteFromSummary` (verified against the
landed function): it returns `true`. So with Slice B in the tree, step 1 would
have `claimsComplete === true`, `isCompletionMilestone(record)` would fire the
off-cadence judge on the productive step, and a PROCEED would seal SUCCESS
**without taking step 2**. The hand-landed prompt is reliably eliciting the
marker (step 2 emitted it too); the runner now reads it. The end-to-end win is
plumbed — it just couldn't apply to the run that plumbed it.

## New friction

**None.** The anomaly checklist came back clean:

- **Wasted step**: step 2 is the F-11 probe (below) — known, and the fix this run
  delivers is what retires it. Not new friction.
- **Cost telemetry**: $1.1125 + $0.4163 steps + $0.0350 judge = $1.5638, all
  non-zero, models priced; no `UNPRICED`/blind-meter warning. Sound.
- **Judge**: one pass, all three judge-executed checks exited 0 (not a
  form-only PROCEED), rubric justifications accurate, verdict a true positive
  (the delivery is genuinely correct). Family diversity real.
- **Human ceremony**: launched once, watched to terminal. **F-30 did not recur**
  — a single run for this spec, no duplicate launch (operator discipline held).
- **Loop integrity**: two checkpoints, `lastGood` false→true only at the PROCEED
  step, no duplicate journal entries, no re-execution.

Recurrence and baseline:

- **F-11 recurred (twentieth data point)** — step 2 empty-diff probe: 0 bytes,
  320k input tokens, **$0.4163, 26.6 % of run cost** (mid-range of the
  5.4 %–35.1 % spread). This is the *last* run that should pay it: the consumption
  that retires it is now in the tree. No new WP — this *is* WP-221, and its
  closure is now an observation away (next run).
- **Token economics**: step 1 = 862k input / $1.11 for a 3360-byte diff (a
  one-line pure function, a one-line SUCCESS-branch field, an export, and a
  ~34-line test). Consistent with the campaign's codex repo-search overhead on
  small, well-specified changes (dogfood-019 921k, dogfood-020 646k); baseline
  data for WP-203/WP-207. Run 31.2 % of $5.

## Verdict on the thesis (twenty-first data point — the cost win is plumbed, proof pending)

- **The F-11 cost mechanism is now complete in code.** Three landed pieces — the
  hand-done marker protocol (constant + prompt), Slice A's pure trigger
  (`isCompletionMilestone`), and Slice B's pure consumption
  (`claimsCompleteFromSummary` → `claimsComplete`) — compose into: *the executor
  declares completion, the runner reads the declaration, the judge grades the
  productive step directly, and the loop stops without a no-op probe step.* Every
  piece is pure and unit-tested in isolation; the wiring between them is the
  existing SUCCESS-branch + Slice-A OR.
- **The honest gap is verification, not correctness.** No single run has yet
  *shown* the probe step gone, because the run delivering the consumption ran the
  old loop. The spec named this as a documented follow-up. There are two paths to
  closure: (a) **observe it** — the next real dogfood run will either terminate
  in one productive step or it won't; or (b) **guard it** — a deterministic
  agent-loop test with a fake executor that emits the marker, asserting no probe
  step is taken. (b) is the regression guard for the cost win but needs a
  fake-executor seam through the Temporal loop (the runner integration tests boot
  a real dev server) — heavier than a pure dogfood slice, so it is hand-design
  territory (TASK-PROTOCOL §4), not the next dogfood. **The next dogfood resumes
  the pure-slice queue (WP-218 token-budget math); F-11 closure is confirmed by
  observing the first marker-emitting run.**
- **Loop integrity held**, telemetry sound, family diversity real, single clean
  launch. A textbook run — and the first in four campaigns to advance a Phase-2
  cost pillar to *done-in-code* rather than circle tooling.
- Next: **WP-218 pure token-budget math** (`estimateNextStepTokens` +
  `tokenBudgetBreached` in `runner/budget.ts`, mirroring the USD
  `estimateNextStepCost`/`budgetBreached`; contract `TaskSpec.budgetTokens`
  already landed) — the original dogfood-021 slice, reprioritized behind the
  F-11 win on 2026-06-14, now the best remaining pure, contract-landed slice.
  Watch the first run for the retired probe step → F-11 closed.
