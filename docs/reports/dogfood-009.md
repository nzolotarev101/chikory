# Dogfood-009 — WP-225 (de-flake the WP-217 milestone test) through Chikory

**WP**: WP-225 · **Date**: 2026-06-12 · **Task spec**: [`examples/dogfood/dogfood-009.yaml`](../../examples/dogfood/dogfood-009.yaml) · **Run**: `run-841bc838-321f-42f8-985b-a55bf3677fd0` · **Landed**: pending — diff verified in the working tree, uncommitted on `main` (review precedes commit)

> Ninth dogfood, ninth consecutive first-attempt SUCCESS, and the
> **third** campaign with zero new friction (after dogfood-006 and
> dogfood-008). The engine fixed the test that had been spuriously
> failing its own judge-executed checks — F-19, the
> sampled-vs-durable-state race in `agent-loop.test.ts`'s `waitFor`
> predicate. The only friction this run shows is a recurrence at its
> opposite extreme: the WP-217 completion-probe tax (F-11) hit its
> **cheapest** share ever — 34k input / $0.05 / **5.8 %** — because the
> probe step skipped the suite re-run entirely. dogfood-008 set the
> record high (25.4 %); this sets the low. The spread itself is the
> argument for WP-221: the tax is unpredictable, not small.

## The run

Zero-secrets setup identical to dogfood-002…008: `codex` executor (ChatGPT
OAuth), Gemini judge behind `scripts/cli-judge-proxy.mjs` (openai executor /
gemini-3.1-pro-preview judge — invariant #2 holds; judge share 3.3 % ≪ the
0.5 cap).

```
run run-841bc838… · SUCCESS · 2 steps · $0.86 / $5.00 · 4m 7s · executor codex(openai) · judge openai-compat
 1   Implemented WP-225 in `agent-loop.t…  604k/3.3k   $0.79
 2   WP-225 is already implemented exact…  34k/448     $0.05   ✓ PROCEED (3/3 criteria)
totals: decisions 2 · judge passes 1 ($0.03, 3.3%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 2 · feedback frequency 1/2 steps
```

Step 1 did all the work (15 tool calls, 2 m 22 s, diff **706 bytes** — the
single predicate line) and self-verified: the targeted test passed **8
consecutive runs**, `typecheck` and `lint` clean, exactly one file changed,
no commit created. Step 2 produced an **empty diff** (3 tool calls, 18 s,
34k input tokens — `git status` / `rg` the predicate / `git diff`, then
"already implemented exactly as requested"); the WP-217 empty-diff
milestone and the cadence-2 tick landed on the same step again — **fifth
campaign in a row**, the milestone trigger has still never fired
*off*-cadence in production. The judge executed all three checks in the
workspace clone, passed all four rubric items, and sealed SUCCESS.

Journal integrity clean: no duplicate entries, no re-execution, no resume;
checkpoint chain consistent (`@1` `96a1e0f8` lastGood:false pre-judge →
`@5` `20df4bed` lastGood:true after PROCEED), 2 checkpoints / 2 decisions.

Cost telemetry healthy (fifth fully priced campaign): $0.788 step 1 +
$0.047 step 2 + $0.028 judge ≈ $0.86, arithmetic consistent with the
`2026-06-12` pricing table (judge ≈ 34k cached-in × $1.25/MTok + 448 out ×
$10/MTok). `gemini-3.1-pro-preview` present in
`packages/sdk-ts/src/pricing.ts`. No `⚠ cost meter blind` warning; **17 %**
of the $5 cap consumed — the cheapest priced campaign to date.

## Delivery quality (human review, post-run)

Verified independently in devbox against the working-tree change (delivery
not yet landed; the run's workspace commit is mirrored uncommitted on
`main`). All three acceptance checks rerun by hand, real output:

- **AC-1** — `for i in 1..8; do vitest run test/runner/agent-loop.test.ts;
  done`: **8/8 passed**. The de-flaked test held every run (it had flapped
  2/13 host runs during the dogfood-007 review — the race is closed).
- **AC-2** — `vitest run test/runner/verdict-gating.test.ts
  test/cli/cli.test.ts`: **11 passed**, 8.16 s. The gating + CLI surface is
  behaviorally untouched.
- **AC-3** — `tsc --noEmit` and `eslint .`: both clean, no output.

**The change is exactly the spec — one line.** Against the goal:

```diff
-        return wire.hits === 1 && report.currentStep === 1 && report.status === "RUNNING"
+        return wire.hits === 1 && report.currentStep === 1 && report.status === "RUNNING" && report.lastVerdict !== undefined
```

`agent-loop.test.ts:254`, inside the test titled *"incomplete empty-diff
verdict keeps RUNNING and feeds rationale into the next step"*. The
predicate now releases `waitFor` only once the PROCEED verdict is durably
visible on the status report, so the subsequent `expect(running.lastVerdict)
.toEqual({ kind: "PROCEED", atStep: 0 })` can no longer observe
`lastVerdict === undefined`. The fix is the durable-state class identified
in F-15/WP-223, applied this time to the test harness rather than the
watch renderer.

- **Scope discipline held**: `git show --stat` = exactly one file,
  `packages/sdk-ts/test/runner/agent-loop.test.ts`, **1 insertion / 1
  deletion**. Every restricted path the goal named (`src/`, `types.ts`,
  `schemas.ts`, other tests, fixtures) untouched. Title, `setup` /
  `makeJudgedSpec` calls, every `expect`, the terminal-state and journal
  assertions all byte-identical. No product code, no new dependencies, no
  added or deleted tests, no changed assertion — as instructed.

**WP-225 status**: done pending commit. F-19 is closed — the test that sat
inside a judge-executed check (dogfood-007 AC-2) and could spuriously fail
a run or harvest is now deterministic on the durable verdict.

## New friction

**None.** Highest friction number stays F-19 (now closed). Recurrences and
baseline data only:

- **F-11 recurred** (completion probe tax), **eighth data point and a new
  record _low_ cost share**: 34k input tokens / 3 tool calls / 18 s /
  **$0.05 — 5.8 % of run cost** to confirm "nothing to do" (155k → 211k →
  158k → 245k → 156k → 136k → 252k → **34k** across dogfood-002…009;
  cost-share 15.3 % → 14.8 % → 18.9 % → 25.4 % → **5.8 %** over the priced
  campaigns). The share collapsed because this probe step **skipped the
  suite re-run** — unlike dogfood-008's 252k probe (14 tool calls, full
  suite), this one ran only `git status` / `rg` / `git diff` and stopped.
  That the same mechanism costs 5.8 % one run and 25.4 % the next is itself
  the case for **WP-221**: the empty-diff probe's cost is
  executor-discretion-dependent and unbounded, where an explicit
  `claimsComplete` signal judges the *productive* step directly and
  deterministically. Milestone coincided with the cadence tick for the
  fifth straight campaign; WP-221 unchanged, still rides the next contracts
  PR.
- **Token-economics baseline** (WP-203/WP-207 data): 638k executor input
  tokens (604k step 1 + 34k step 2) for a 2-step, 706-byte-diff, 1-line
  change ($0.86). Step 1's 604k is dominated by the executor self-running
  the AC-1 check itself — 8× `vitest` + `typecheck` + `lint`, every run's
  stdout accumulating in context — which the judge then re-ran identically
  in the workspace clone (16 total suite runs for a one-line de-flake).
  The executor's self-verification is generally protective, but here it
  duplicates the authoritative judge check on an expensive/flaky target;
  worth a Memory-Pointer-Pattern (WP-202) note for step transcripts, no new
  number. Priced trend: 1 592k/$2.14 → 1 056k/$1.43 → 722k/$1.00 →
  958k/$1.32 → **638k/$0.86** (cheapest priced campaign).
- **Ceremony note**: delivery again verified in the workspace and left
  uncommitted on `main` for review. WP-224 (`chikory land --verify`, landed
  `0479a6f`) is now available to make this the first harvested-through-land
  delivery — it was not used this run. No new number.

## Verdict on the thesis (ninth data point)

- Nine campaigns, nine first-attempt SUCCESSes; **third** zero-new-friction
  campaign. The engine de-flaked the very test that gates its own dogfood
  harvests — a self-correcting reliability fix, judge-verified.
- The lone recurring tax (F-11) now spans 5.8 %–25.4 % of run cost across
  eight data points. The *spread*, not the magnitude, is the cleanest
  WP-221 argument: an inferred completion signal has unpredictable cost; an
  explicit one does not. WP-221 stays contract-gated, waiting on the next
  architect-reviewed PR.
- Open friction is now: WP-219's ADR (objective gap, human-design), and the
  two contract-gated items (WP-221, WP-218 slice 2) riding the next
  architect PR. With WP-225 closed, the dogfood queue has no 🟢/no-contracts
  item at the top — dogfood-010 picks the next mechanical slice down the
  list (WP-209, process metrics in trace).
