# Dogfood-010 — WP-209 slice 1 (issues-found : changes-made process metric in `chikory trace`)

**WP**: WP-209 · **Date**: 2026-06-12 · **Task spec**: [`examples/dogfood/dogfood-010.yaml`](../../examples/dogfood/dogfood-010.yaml) · **Run**: `run-c9df353b-6710-468f-a91b-ec05d8580d80` · **Landed**: pending — diff verified in the workspace clone, uncommitted on `main` (review precedes commit)

> Tenth dogfood, tenth consecutive first-attempt SUCCESS, and the **fourth**
> campaign with zero new friction (after dogfood-006, dogfood-008, and
> dogfood-009). The engine added a process metric to its own trace renderer
> — the issues-found : changes-made ratio that satisfies the concrete half
> of SE-3 — in exactly the two files the spec allowed, byte-for-byte
> matching the prescribed footer. The only friction this run shows is the
> familiar WP-217 completion-probe tax (F-11), this time landing **mid-spread
> at 16.1 %** ($0.196 / 144k input tokens) because the probe step re-ran the
> full suite (10 tool calls) rather than skipping it as dogfood-009 did. The
> tax now spans **5.8 %–25.4 %** across nine data points; the spread remains
> the WP-221 argument.

## The run

Zero-secrets setup identical to dogfood-002…009: `codex` executor (ChatGPT
OAuth), Gemini judge behind `scripts/cli-judge-proxy.mjs` (openai executor /
gemini-3.1-pro-preview judge — invariant #2 holds; judge share 3.5 % ≪ the
0.5 cap).

```
run run-c9df353b… · SUCCESS · 2 steps · $1.22 / $5.00 · 3m 37s · executor codex(openai) · judge openai-compat
 1   Implemented WP-209 slice 1 in exact…  757k/3.7k   $0.98
 2   WP-209 slice 1 is implemented in th…  144k/1.5k   $0.20   ✓ PROCEED (3/3 criteria)
totals: decisions 2 · judge passes 1 ($0.04, 3.5%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 2 · feedback frequency 1/2 steps
```

Step 1 did all the work (17 tool calls, 2 m 5 s, diff **3527 bytes** — the
18-line renderer block + 38-line test) and self-verified: the trace tests
passed (15), `typecheck` and `lint` clean, exactly the two authorized files
changed, no commit created. Step 2 produced an **empty diff** (10 tool
calls, 45 s, 144k input tokens — re-ran `pnpm install` + the trace suite +
typecheck/lint, then "WP-209 slice 1 is implemented in the two authorized
files… No commit created"); the WP-217 empty-diff milestone and the
cadence-2 tick landed on the same step again — **sixth campaign in a row**,
the milestone trigger has still never fired *off*-cadence in production. The
judge executed all three checks in the workspace clone, passed all four
rubric items, and sealed SUCCESS.

Journal integrity clean: no duplicate entries, no re-execution, no resume;
checkpoint chain consistent (`@1` `e7a23140` lastGood:false pre-judge → `@5`
`d9920c19` lastGood:true after PROCEED; workspace commits `step 0` / `step
1`), 2 checkpoints / 2 decisions.

Cost telemetry healthy (sixth priced campaign): $0.983 step 1 + $0.196 step
2 + $0.042 judge ≈ $1.22, no `⚠ cost meter blind` warning; **24.4 %** of the
$5 cap consumed. Per-step costs carry the honest `(estimated)` tag — codex
returns no exact usage, so tokens are estimated and priced against the
`2026-06-12` table (`gemini-3.1-pro-preview` present in
`packages/sdk-ts/src/pricing.ts`; judge $0.042 ≈ 144k cached-in × $1.25/MTok
+ 1.5k out × $10/MTok at the judge step's measured tokens).

## Delivery quality (human review, post-run)

Verified independently in devbox against the workspace-clone change
(delivery not yet landed; the run's workspace commit `d9920c19` is mirrored
uncommitted on `main`). All three acceptance checks rerun by hand, real
output:

- **AC-1** — `pnpm --filter @chikory/sdk exec vitest run test/cli/trace.test.ts`:
  **15 passed**, 1.71 s, including the new
  `reports issues found and changes made` case.
- **AC-2** — `vitest run test/cli/cli.test.ts test/cli/land.test.ts`:
  **13 passed**, 4.74 s. The rest of the CLI surface is behaviorally
  untouched.
- **AC-3** — `tsc --noEmit` and `eslint .`: both clean, no output.

**The change is exactly the spec.** Against the goal:

```diff
+  const issuesFound = entries.reduce((count, entry) => {
+    if (entry.kind !== "judge") return count;
+    const { form } = entry.payload as JudgePayload;
+    return (
+      count +
+      form.criterionResults.filter((result) => result.pass === false).length +
+      form.rubricResults.filter((result) => result.pass === false).length +
+      form.concerns.length
+    );
+  }, 0);
+  const changesMade = entries.filter(
+    (entry) =>
+      entry.kind === "step" && (entry.payload as StepPayload).record.diffRef.bytes > 0,
+  ).length;
   ...
+  lines.push(
+    `        issues found ${issuesFound} · changes made ${changesMade} ` +
+      `(issues:changes ${issuesFound}:${changesMade})`,
+  );
```

`trace.ts:169–209`. The new third continuation footer line sits after the
`injections … · checkpoints …` line and **before** the terminal line — the
header, per-step rows, and the first two totals lines are byte-untouched, so
every prior assertion still holds (AC-1's 15 = 14 prior + 1 new). The
strict `result.pass === false` comparison (not falsy) matches the spec
wording exactly; `JudgePayload` and `StepPayload` were both already imported
(`trace.ts:10`), so no import churn. The new test builds its own
`metricEntries` fixture (one changed step, one zero-diff probe, one judge
entry with a failed rubric + a concern) → `issuesFound 2`, `changesMade 1`,
and `.toContain`s the exact `issues found 2 · changes made 1
(issues:changes 2:1)` line — the shared `entries` const is not mutated.

- **Scope discipline held**: `git show --stat` = exactly two files,
  `packages/sdk-ts/src/cli/trace.ts` (+18) and
  `packages/sdk-ts/test/cli/trace.test.ts` (+38), **56 insertions, 0
  deletions**. Every restricted path the goal named (`types.ts`,
  `schemas.ts`, the journal layer, other src/tests) untouched; no new
  dependency, no new journal kind, no contract change. AGENTS.md conventions
  honored (strict TS, ESM `.js` imports, named exports).

**WP-209 status**: slice 1 done pending commit. SE-3's concrete half (issues
found vs changes made) now renders in the trace footer; OB-6 advances with
it. Components-over-time + OTel metrics remain later slices.

## New friction

**None.** Highest friction number stays F-19 (closed in dogfood-009).
Recurrences and baseline data only:

- **F-11 recurred** (completion probe tax), **ninth data point, mid-spread
  cost share**: 144k input tokens / 10 tool calls / 45 s / **$0.196 — 16.1 %
  of run cost** to confirm "nothing to do" (155k → 211k → 158k → 245k → 156k
  → 136k → 252k → 34k → **144k** across dogfood-002…010; priced cost-share
  15.3 % → 14.8 % → 18.9 % → 25.4 % → 5.8 % → **16.1 %** over the six priced
  campaigns). The share landed mid-range because this probe **re-ran the
  full suite** (`pnpm install` + trace tests + typecheck/lint, 10 tool
  calls) — the opposite of dogfood-009's 3-tool-call skip (5.8 %) and short
  of dogfood-008's 14-tool-call full sweep (25.4 %). That the identical
  empty-diff mechanism costs anywhere from 5.8 % to 25.4 % depending purely
  on executor discretion is, again, the WP-221 case: an inferred completion
  signal has unbounded, unpredictable cost; an explicit `claimsComplete`
  judges the *productive* step directly and deterministically. Milestone
  coincided with the cadence tick for the sixth straight campaign; WP-221
  unchanged, still rides the next contracts PR.
- **Token-economics baseline** (WP-203/WP-207 data): 901k executor input
  tokens (757k step 1 + 144k step 2) for a 2-step, 3527-byte-diff, 56-line
  change ($1.22). Step 1's 757k is a **new per-step high** (vs 604k in
  dogfood-009) — the executor self-ran AC-1 (`pnpm install` + `vitest`) plus
  typecheck/lint, every run's stdout accumulating in context, which the
  judge then re-ran identically in the workspace clone. The self-
  verification is generally protective but again duplicates the
  authoritative judge check; still the Memory-Pointer-Pattern (WP-202)
  candidate flagged in dogfood-009, no new number. Priced trend:
  1 592k/$2.14 → 1 056k/$1.43 → 722k/$1.00 → 958k/$1.32 → 638k/$0.86 →
  **901k/$1.22**.
- **Ceremony note**: delivery again verified in the workspace clone and left
  uncommitted on `main` for review. WP-224 (`chikory land --verify`) remains
  available and was again not used this run. No new number.

## Verdict on the thesis (tenth data point)

- Ten campaigns, ten first-attempt SUCCESSes; **fourth** zero-new-friction
  campaign. The engine extended its own observability surface (a process
  metric for SE-3) under a tight two-file scope contract and hit the
  prescribed output byte-for-byte — the fifth clean renderer-shaped slice
  (WP-142-family) the dogfood loop has delivered.
- The lone recurring tax (F-11) now spans **5.8 %–25.4 %** of run cost across
  nine data points. The *spread*, not the magnitude, remains the cleanest
  WP-221 argument: an inferred completion signal's cost tracks executor
  discretion (suite re-run vs skip); an explicit one does not. WP-221 stays
  contract-gated, waiting on the next architect-reviewed PR.
- Open friction is unchanged: WP-219's ADR (objective gap, human-design) and
  the two contract-gated items (WP-221, WP-218 slice 2) riding the next
  architect PR. dogfood-011 continues WP-209 with slice 2 (components-over-
  time in the trace footer) — the next 🟢/no-contracts renderer slice, same
  proven shape, requires slice 1 landed on HEAD first.
