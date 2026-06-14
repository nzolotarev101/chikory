# Dogfood-019 — WP-221 pure trigger half (`isCompletionMilestone`); judge gate blind to test types (F-29)

**WP**: WP-221 (Slice A, pure trigger half) · **Date**: 2026-06-14 · **Task spec**: [`examples/dogfood/dogfood-019.yaml`](../../examples/dogfood/dogfood-019.yaml) · **Run**: `run-d836635b-389e-4aca-9bd8-85f352c14a29` · **Outcome**: **SUCCESS** (judge PROCEED 3/3) · **Landed**: harvested + staged on `main`, pending commit

> Nineteenth campaign, eighteenth first-attempt SUCCESS. The functional delivery
> is exactly to spec — the WP-217 empty-diff judge trigger is now a pure,
> unit-tested `isCompletionMilestone(record)` that ORs in `claimsComplete`, with
> behavior unchanged on today's runs. **But this is the first SUCCESS run whose
> human review found a defect every green signal missed**: the new test's
> fixtures violate the `ArtifactRef` contract (`{uri, sha256, bytes}` where the
> type is `{id, kind, bytes, summary}`), and nothing caught it — because the
> `typecheck` AC compiles only `src/`, and Vitest transpiles tests without
> type-checking. dogfood-002's lesson (a SUCCESS run can still surface
> plan-changing gaps) repeats. → **F-29 / WP-230.**

## The run

Zero-secrets setup unchanged: Codex executor (OpenAI family) + Gemini judge
behind the local OpenAI-compatible shim. Family diversity held.

```text
run run-d836635b... · SUCCESS · 2 steps · $1.66 / $5.00 · 5m 41s · executor codex(openai) · judge openai-compat
 1   Implemented WP-221 pure completion milestone predicate   921k/6.0k  $1.21   (4284-byte diff)
 2   Implemented exactly the requested test/wiring             320k/1.9k  $0.42   ✓ PROCEED (3/3 criteria)
totals: decisions 2 · judge passes 1 ($0.03, 2.0%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 2 · issues found 0 · changes made 1 (0:1)
        components over time: s0 s1 j@1
```

All real work in step 1 (4284-byte diff). Step 2 was the empty-diff completion
probe (F-11, below). Judge ran once at the cadence-2 boundary, graded the
cumulative diff, PROCEEDed 3/3 + 4/4 rubric.

## Delivery quality (human review, post-landing)

The functional delivery matches the spec line by line:

- **`packages/sdk-ts/src/workflow/judge-trigger.ts`** (new) — exports the pure
  `isCompletionMilestone(record: StepRecord): boolean` returning
  `status === "SUCCESS" && (diffRef.bytes === 0 || claimsComplete === true)`.
  Named export, `StepRecord` imported as a type from `../types.js`, pure, with a
  (terse) JSDoc citing WP-217/WP-221 F-11. Correct.
- **`packages/sdk-ts/src/workflow/agent-loop.ts`** — the inline
  `completionMilestone` expression at line 211 is replaced by
  `isCompletionMilestone(record)` plus the import; nothing else changed. The
  empty-diff path stays true, so the existing agent-loop integration tests pass
  unchanged. Correct, behavior-preserving.
- **`packages/sdk-ts/test/runner/judge-trigger.test.ts`** (new) — all six
  required cases present with the correct expected booleans (SUCCESS+empty→true,
  SUCCESS+claim→true, SUCCESS+diff+no-claim→false, SUCCESS+diff+false-claim→false,
  FAILED+empty→false, FAILED+claim→false). The *logic* under test is right.

Independent verification (working tree): AC-1 6 passed · AC-2 242 passed/19
skipped · AC-3 typecheck+lint clean. Scope = exactly the three named files;
harvest byte-diff **IDENTICAL** on all three. No deps, no contract/type/schema/
journal/runner-activity change.

**WP-221 Slice A is genuinely delivered.** It changes no observable behavior on
today's runs (nothing populates `claimsComplete` yet — that is Slice B); the F-11
probe step is *not* yet retired. This is plumbing for the cost win, not the win.

## New friction

**F-29 — the acceptance gate type-checks only `src/`, so a test can ship
contract-violating fixtures with every signal green.** The new test's
`makeRecord` builds `diffRef`/`transcriptRef` as `{ uri, sha256, bytes }`, but
`ArtifactRef` (`types.ts:263`) is `{ id, kind, bytes, summary }`. Compiling the
test under the project's strict config produces **seven `TS2353` errors**
(verified this review: temp tsconfig adding `test/runner/judge-trigger.test.ts`
→ `error TS2353: 'uri' does not exist in type 'ArtifactRef'` ×7). Yet AC-3
(`pnpm --filter @chikory/sdk typecheck` = `tsc --noEmit` over
`include: ["src/**/*"]`) passed clean, because **test files are outside the
typecheck program**, and Vitest transpiles via esbuild without type-checking.
The predicate only reads `.bytes`, so the fixtures run and the six assertions
pass. The judge graded the diff, saw passing unit tests and a clean typecheck,
and PROCEEDed — it cannot catch a type error the toolchain itself never surfaces.
ESLint runs over `test/` but type-shape errors are not lint errors.
→ **WP-230**: extend the typecheck gate to cover `test/**/*` (a test-inclusive
`tsconfig` without the `src` `rootDir` constraint, or project references, wired
into a `typecheck` AC and CI), and fix the `judge-trigger.test.ts` fixtures to
valid `ArtifactRef` values. This is a blind spot in the *cheap* gate that the
whole Chikory thesis says must not be trusted blindly — here it endorsed
type-incorrect code. 🟡, mechanical, no contracts change.

> Triggering evidence (not a separate F): with F-28's lighter prescription, the
> executor was told to "build a minimal valid record helper; only the fields the
> predicate reads need realistic values." It fabricated the `ArtifactRef` shape
> from a wrong mental model rather than reading `types.ts`. The *behavior* it
> chose to leave to the executor was fine; the *fixture types* it invented were
> not — and only WP-230 would catch that. F-28 (less prescription) and F-29
> (unchecked test types) interact: more executor latitude makes a test-type gate
> more valuable, not less.

Recurrences and baseline:

- **F-11 recurred (eighteenth data point)** — step 2 empty-diff probe: 0 bytes,
  320k input tokens, $0.4187, **25.2 % of run cost** (mid-range of the
  5.4 %–35.1 % spread). The irony noted in dogfood-018 holds: the run delivering
  WP-221's trigger half still paid the probe-step tax, because the win only
  arrives with Slice B (adapters populating `claimsComplete`). No new WP — this
  *is* WP-221.
- **Token economics — new campaign high**: step 1 burned **921k input tokens /
  $1.21** to produce a 4284-byte diff (a ~10-line pure function + a one-line
  wiring swap + an ~80-line test). Highest single-step input of the campaign,
  surpassing dogfood-017's 807k. Codex repo-search overhead on a small,
  well-specified change; baseline data for WP-203/WP-207. Run still 33.2 % of $5.

## Verdict on the thesis (nineteenth data point — the judge's ceiling is the gate's reach)

- **The functional engine work is right**: the inner-loop judge trigger (JD-2)
  is now pure, isolated, and unit-tested, with the `claimsComplete` OR in place
  for Slice B to activate. Behavior preserved, integration tests green.
- **The honest finding cuts the other way from dogfood-017.** There, the judge
  caught a defect every cheap signal missed (empty diff vs completion claim) —
  the thesis win. Here, a defect (contract-violating test fixtures) slipped past
  *because it lived in a region no signal inspects* — not the judge's diff
  grading, not the typecheck (src-only), not Vitest (no type-check), not lint.
  The judge is only as good as the evidence it is handed; when the toolchain
  itself is blind to test types, the judge inherits that blind spot. **F-29 is
  about widening what the cheap gate sees, so the judge's diff-grading sits on
  top of a trustworthy floor.**
- **Loop integrity held**: two checkpoints, `lastGood` true only at the PROCEED
  step, no duplicate entries, no re-execution.
- Next: **WP-230** hardens the typecheck gate to cover tests (and fixes these
  fixtures) — do this before more test-bearing slices land on an unchecked
  floor. Then **WP-221 Slice B** (adapters populate `claimsComplete`) finally
  retires the F-11 probe step this run, again, paid for.
