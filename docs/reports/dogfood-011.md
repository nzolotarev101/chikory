# Dogfood-011 — WP-209 slice 2 (components-over-time timeline in `chikory trace`)

**WP**: WP-209 · **Date**: 2026-06-13 · **Task spec**: [`examples/dogfood/dogfood-011.yaml`](../../examples/dogfood/dogfood-011.yaml) · **Run**: `run-59e0166c-5a8f-4524-a757-a316c9dd814d` · **Landed**: pending — diff verified in the workspace clone, uncommitted on `main` (review precedes commit)

> Eleventh dogfood, eleventh consecutive first-attempt SUCCESS, and the
> **fifth** campaign with zero new friction (after dogfood-006, dogfood-008,
> dogfood-009, dogfood-010). The engine added the temporal half of SE-3 — a
> per-decision executor/judge timeline (`components over time: s0 s1 j@1`) —
> to its own trace footer, in exactly the two files the spec allowed,
> byte-for-byte matching the prescribed line. The only friction this run
> shows is the familiar WP-217 completion-probe tax (F-11), and this time it
> set a **new record-high 34.3 %** cost share ($0.3231 / 244k input tokens) —
> the probe step re-ran the full suite at the high end of executor
> discretion. The tax now spans **5.8 %–34.3 %** across ten data points; the
> spread, not the magnitude, is the WP-221 argument.

## The run

Zero-secrets setup identical to dogfood-002…010: `codex` executor (ChatGPT
OAuth), Gemini judge behind `scripts/cli-judge-proxy.mjs` (openai executor /
gemini-3.1-pro-preview judge — invariant #2 holds; judge share 3.9 % ≪ the
0.5 cap).

```
run run-59e0166c… · SUCCESS · 2 steps · $0.94 / $5.00 · 3m 21s · executor codex(openai) · judge openai-compat
 1   Implemented WP-209 slice 2 in exact…  445k/2.7k   $0.58
 2   WP-209 slice 2 is implemented in th…  244k/1.9k   $0.32   ✓ PROCEED (3/3 criteria)
totals: decisions 2 · judge passes 1 ($0.04, 3.9%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 2 · feedback frequency 1/2 steps
        issues found 0 · changes made 1 (issues:changes 0:1)
        components over time: s0 s1 j@1
```

Step 1 did all the work (13 tool calls, 1 m 25 s, diff **2617 bytes** — the
9-line renderer block + 24-line test) and self-verified: the trace tests
passed (16), `typecheck` and `lint` clean, exactly the two authorized files
changed, no commit created. Step 2 produced an **empty diff** (10 tool
calls, 1 m 3 s, 244k input tokens — re-ran `pnpm install` + the trace suite +
typecheck/lint, then "WP-209 slice 2 is implemented in the two specified
files… Worktree: clean"); the WP-217 empty-diff milestone and the cadence-2
tick landed on the same step again — **seventh campaign in a row**, the
milestone trigger has still never fired *off*-cadence in production. The
judge executed all three checks in the workspace clone (`3 passed, 0
failed`), passed all four rubric items, and sealed SUCCESS.

Journal integrity clean: no duplicate entries, no re-execution, no resume;
checkpoint chain consistent (`@1` `2b3e63b865b5` lastGood:false pre-judge →
`@5` `46e0b5f8f1bc` lastGood:true after PROCEED; workspace commits `step 0` /
`step 1`), 2 checkpoints / 2 decisions.

Cost telemetry healthy (seventh priced campaign): $0.5827 step 1 + $0.3231
step 2 + $0.0367 judge ≈ $0.94, no `⚠ cost meter blind` warning; **18.9 %**
of the $5 cap consumed. Per-step costs carry the honest `(estimated)` tag —
codex returns no exact usage, so tokens are estimated and priced against the
`2026-06-12` table (`gemini-3.1-pro-preview` present in
`packages/sdk-ts/src/pricing.ts`; judge $0.0367 at the judge step's measured
tokens, 7959 evidence bytes, 53 s).

## Delivery quality (human review, post-run)

Verified independently in devbox against the workspace-clone change
(delivery not yet landed; the run's workspace commit `46e0b5f8f1bc` is
mirrored uncommitted on `main`). All three acceptance checks rerun by hand,
real output:

- **AC-1** — `pnpm --filter @chikory/sdk exec vitest run test/cli/trace.test.ts`:
  **16 passed**, 1.06 s, including the new
  `reports components over time in journal order` case.
- **AC-2** — `vitest run test/cli/cli.test.ts test/cli/land.test.ts`:
  **13 passed**, 6.06 s. The rest of the CLI surface is behaviorally
  untouched. (Step 2's executor summary claimed "one unrelated existing
  failure in `cli.test.ts`"; neither the judge's AC-2 run nor this
  independent rerun reproduce it — 13/13 green both times. Spurious,
  unreproduced, gated checks clean; no friction.)
- **AC-3** — `tsc --noEmit` and `eslint .`: both clean, no output.

**The change is exactly the spec.** Against the goal:

```diff
+  const timelineTokens: string[] = [];
+  for (const entry of entries) {
+    if (entry.kind === "step") {
+      timelineTokens.push(`s${(entry.payload as StepPayload).stepIndex}`);
+    } else if (entry.kind === "judge") {
+      timelineTokens.push(`j@${(entry.payload as JudgePayload).atStep}`);
+    }
+  }
+  const timeline = timelineTokens.join(" ");
   ...
+  lines.push(`        components over time: ${timeline}`);
```

`trace.ts:183–209`. The new fourth continuation footer line sits **after**
the slice-1 `issues found … · changes made …` line and **before** the
terminal line — the header, per-step rows, and the first three totals lines
are byte-untouched, so every prior assertion still holds (AC-1's 16 = 15
prior + 1 new). The iteration order is `entries` as received, every non-
`step`/non-`judge` kind contributing no token, joined on a single space —
matching the spec's token grammar exactly; `StepPayload` and `JudgePayload`
were already imported in `trace.ts`, so the only test-side import churn is
adding `JudgePayload` to the test file's type imports. The new test builds
its own `timelineEntries` fixture (two step entries stepIndex 0→1, one judge
entry atStep 1) and `.toContain`s the exact `components over time: s0 s1
j@1` line — the shared `entries` const is not mutated, no existing test
changed.

- **Scope discipline held**: `git diff --stat` = exactly two files,
  `packages/sdk-ts/src/cli/trace.ts` (+10) and
  `packages/sdk-ts/test/cli/trace.test.ts` (+24), **34 insertions, 0
  deletions**. Every restricted path the goal named (`types.ts`,
  `schemas.ts`, the journal layer, other src/tests) untouched; no new
  dependency, no new journal kind, no contract change. AGENTS.md conventions
  honored (strict TS, ESM `.js` imports, named exports).

**WP-209 status**: slice 2 done pending commit. SE-3's temporal half
(components over time) now renders in the trace footer alongside slice 1's
issues-found:changes-made line; both halves of the SE-3 concrete metric set
are present in `chikory trace`. OTel metrics remain a later slice.

> Commit-hygiene note (human-side, no WP): HEAD `546038f` — the dogfood-010
> harvest — is *titled* "add metrics and **components-over-time timeline**",
> but its `trace.ts` contains only the slice-1 `issues found` line; the
> components-over-time line is this (slice-2) uncommitted delivery. The
> message advertised slice 2 a commit early. Harmless once this slice lands,
> but worth tightening the next harvest message to the diff it carries.

## New friction

**None.** Highest friction number stays F-19 (closed in dogfood-009).
Recurrences and baseline data only:

- **F-11 recurred** (completion probe tax), **tenth data point, new record-
  high cost share**: 244k input tokens / 10 tool calls / 1 m 3 s / **$0.3231
  — 34.3 % of run cost** to confirm "nothing to do" (155k → 211k → 158k →
  245k → 156k → 136k → 252k → 34k → 144k → **244k** across dogfood-002…011;
  priced cost-share 15.3 % → 14.8 % → 18.9 % → 25.4 % → 5.8 % → 16.1 % →
  **34.3 %** over the seven priced campaigns). The share set a new high
  because this probe **re-ran the full suite** (`pnpm install` + trace tests
  + cli/land tests + typecheck/lint, 10 tool calls) *and* the productive
  step 1 was comparatively cheap ($0.58), so the fixed-cost probe weighed
  heavier in the ratio. That the identical empty-diff mechanism now costs
  anywhere from **5.8 % to 34.3 %** depending purely on executor discretion
  is, again, the WP-221 case: an inferred completion signal has unbounded,
  unpredictable cost; an explicit `claimsComplete` judges the *productive*
  step directly and deterministically. Milestone coincided with the cadence
  tick for the seventh straight campaign; WP-221 unchanged, still rides the
  next contracts PR.
- **Token-economics baseline** (WP-203/WP-207 data): 689k executor input
  tokens (445k step 1 + 244k step 2) for a 2-step, 2617-byte-diff, 34-line
  change ($0.94) — the cheapest priced campaign to date. Step 1's 445k is
  *not* a new high (757k in dogfood-010 still leads), reflecting the smaller
  slice-2 surface. The probe step's 244k again duplicates the authoritative
  judge check (Memory-Pointer-Pattern / WP-202 candidate, flagged since
  dogfood-009); no new number. Priced trend: 1 592k/$2.14 → 1 056k/$1.43 →
  722k/$1.00 → 958k/$1.32 → 638k/$0.86 → 901k/$1.22 → **689k/$0.94**.
- **Ceremony note**: delivery again verified in the workspace clone and left
  uncommitted on `main` for review. WP-224 (`chikory land --verify`) remains
  available and was again not used this run. No new number.

## Verdict on the thesis (eleventh data point)

- Eleven campaigns, eleven first-attempt SUCCESSes; **fifth** zero-new-
  friction campaign. The engine completed its own SE-3 observability surface
  (the components-over-time half) under a tight two-file scope contract and
  hit the prescribed output byte-for-byte — the sixth clean renderer-shaped
  slice (WP-142-family) the dogfood loop has delivered, and the second WP-209
  slice in a row.
- The lone recurring tax (F-11) now spans **5.8 %–34.3 %** of run cost across
  ten data points, setting a new high this run. The *spread*, not the
  magnitude, remains the cleanest WP-221 argument: an inferred completion
  signal's cost tracks executor discretion (suite re-run vs skip) and the
  size of the productive step it's measured against; an explicit one does
  not. WP-221 stays contract-gated, waiting on the next architect-reviewed
  PR.
- Open friction is unchanged: WP-219's ADR (objective gap, human-design) and
  the two contract-gated items (WP-221, WP-218 slice 2) riding the next
  architect PR. With both SE-3 halves rendered, WP-209's remaining work
  (OTel metrics) is no longer a pure-renderer slice; dogfood-012 picks the
  next 🟢/no-contracts slice off the §6 queue.
