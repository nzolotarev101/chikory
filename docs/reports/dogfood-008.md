# Dogfood-008 — WP-224 (`land --verify` + git-stderr capture) through Chikory

**WP**: WP-224 · **Date**: 2026-06-12 · **Task spec**: [`examples/dogfood/dogfood-008.yaml`](../../examples/dogfood/dogfood-008.yaml) · **Run**: `run-86c4b628-54bc-4e61-989b-123911d670bd` · **Landed**: pending — diff verified in the run workspace, uncommitted on `main` (review precedes commit)

> Eighth dogfood, eighth consecutive first-attempt SUCCESS, and the
> second campaign with **zero new friction** (dogfood-006 was the first).
> The engine closed the loop on its own landing path: `chikory land` now
> verifies what it commits and surfaces git's stderr instead of leaking
> it — the two gaps (F-17, F-18) that kept every prior delivery on the
> hand-applied-and-uncommitted path. The only friction this run shows is
> a recurrence: the WP-217 completion-probe tax (F-11) hit a **new
> record cost share — 25.4 %** — because the productive step was so cheap
> that the wasted second step dominated proportionally. Strongest WP-221
> evidence yet.

## The run

Zero-secrets setup identical to dogfood-002…007: `codex` executor (ChatGPT
OAuth), Gemini judge behind `scripts/cli-judge-proxy.mjs` (openai executor /
gemini-3.1-pro-preview judge — invariant #2 holds; judge share 3.2 % ≪ the
0.5 cap).

```
run run-86c4b628… · SUCCESS · 2 steps · $1.32 / $5.00 · 4m 47s · executor codex(openai) · judge openai-compat
 1   Implemented WP-224 with exactly thr…  706k/5.8k   $0.94
 2   WP-224 is implemented with exactly …  252k/2.1k   $0.34   ✓ PROCEED (3/3 criteria)
totals: decisions 2 · judge passes 1 ($0.04, 3.2%) · rollbacks 0 · escalations 0 · checkpoints 2
```

Step 1 did all the work (20 tool calls, 2 m 42 s, diff 8 891 bytes across
exactly the three in-scope files) and reported full verification — SDK
suite 204 passed / 19 skipped, ESLint, strict typecheck, `git diff
--check`. Step 2 produced an **empty diff** (14 tool calls, 1 m 6 s, 252k
input tokens re-running the full suite + `git status`/`git diff --check`
to rediscover "nothing to do"); the WP-217 empty-diff milestone and the
cadence-2 tick landed on the same step again — fourth campaign in a row,
the milestone trigger has still never fired *off*-cadence in production.
The judge executed all three checks in the workspace clone, passed all
four rubric items, and sealed SUCCESS.

Journal integrity clean: no duplicate entries, no re-execution, no resume;
checkpoint chain consistent (`@1` `6944178d` lastGood:false pre-judge →
`@5` `512257bd` lastGood:true after PROCEED), 2 checkpoints / 2 decisions.

Cost telemetry healthy (fourth fully priced campaign): $0.9402 step 1 +
$0.3359 step 2 + $0.0419 judge = $1.318 ≈ $1.32, arithmetic consistent
with the `2026-06-12` pricing table (judge ≈ 252k cached-in × $1.25/MTok +
2.1k out × $10/MTok). `gemini-3.1-pro-preview` is present in
`packages/sdk-ts/src/pricing.ts` (`$1.25` in / `$10` out). No `⚠ cost
meter blind` warning; 26 % of the $5 cap consumed.

## Delivery quality (human review, post-run)

Verified independently in devbox against the run-workspace commit (the
diff is committed in the workspace; main's working tree is clean, delivery
not yet landed). All three acceptance checks rerun by hand, real output:

- **AC-1** — `pnpm --filter @chikory/sdk exec vitest run
  test/cli/land.test.ts`: **8 passed** (the five pre-existing WP-220 tests
  plus the three new `--verify`/stderr tests), 3.83 s.
- **AC-2** — `vitest run test/cli/cli.test.ts test/cli/trace.test.ts`:
  **19 passed**, 4.60 s. CLI surface behaviorally untouched. (No AC-2 flake
  this campaign — F-19's `agent-loop.test.ts` race is not in this check's
  file set.)
- **AC-3** — `tsc --noEmit` and `eslint .`: both clean, no output.

**The change is exactly the spec.** Line-by-line against the goal:

- `VERIFY_COMMANDS: readonly string[]` exports the four `devbox run
  build/lint/typecheck/test` commands; the commit message's
  `Verification:` line is now built from `VERIFY_COMMANDS.join(" && ")`, so
  the cited and executed commands cannot drift (the spec's core anti-drift
  ask).
- `LandDeps extends CliDeps { runCheck? }` exported; `cmdLand` signature is
  `deps: LandDeps = {}`; default `runCheck` uses `execSync(command, { cwd,
  stdio: ["ignore", "inherit", "inherit"] })` — live output, throws on
  non-zero. `main()`'s signature widened to `LandDeps` so the injected
  fake forwards through `{ ...deps, … }` (required for the tests' DI).
- `--verify` loop: prints `verify: <command>` per command, runs in order,
  on first throw prints `chikory: verification failed: <command>` + `chikory:
  commit kept: <sha> — inspect with: git -C <repo> show <sha>` and returns
  1 **without rolling back** and without running later commands; on full
  pass prints `verified: 4/4 checks green`. `--json` mode adds `"verified":
  true` and suppresses the verify/verified lines. Without `--verify`,
  byte-identical to before.
- **F-18**: `git()` helper now passes `stdio: ["pipe", "pipe", "pipe"]` to
  `execFileSync` (stderr captured, not inherited); `errorMessage` appends
  the whitespace-collapsed `error.stderr` (when a non-empty string) after
  `": "`. The third new test proves it: a conflicting host-repo
  `landed.txt` forces `git apply` to fail, and the single error line
  contains both `land failed` and `landed.txt` — the filename can only come
  from git's now-captured stderr.
- `main.ts`: `verify: { type: "boolean" }` registered in the land case;
  `verify: values["verify"] === true` passed to `cmdLand`; HELP documents
  the flag under `land options`.
- **Three new tests, five existing kept, fixture unchanged** (8 total).
  Each asserts exactly what the spec named: ordered-commands+cwd equality,
  first-red-stop with surviving commit (`rev-list --count` = 1) + exit 1,
  and the F-18 stderr surfacing.

- **Scope discipline held**: exactly the 3 named files
  (`land.ts` +62/-, `main.ts` +12/-, `land.test.ts` +59/-),
  122 insertions / 11 deletions; every restricted path (`types.ts`,
  `schemas.ts`, `src/runner/`, `src/workflow/`, `src/executors/`,
  `src/cli/trace.ts`, `src/cli/commands.ts`) untouched. No new
  dependencies — only the built-in `node:child_process` `execSync` added
  to an existing import.

One cosmetic nit, spec-authored verbatim (not an executor miss): the HELP
line `--verify   run devbox build/lint/typecheck/ test …` carries the
spec's stray space in `typecheck/ test` and is indented to 3 spaces rather
than aligned with the other `land options` columns. The executor
reproduced the spec string exactly as instructed — no WP.

**WP-224 status**: done pending commit. F-17 (land never verified) and
F-18 (git stderr leak) are both closed; `chikory land --verify` is now the
verified landing path the prior seven campaigns lacked.

## New friction

**None.** Highest friction number stays F-19 (dogfood-007). Recurrences and
baseline data only:

- **F-11 recurred** (completion probe tax), **seventh data point and a new
  record cost share**: 252k input tokens / 14 tool calls / 1 m 6 s /
  **$0.34 — 25.4 % of run cost** to rediscover "nothing to do" (155k →
  211k → 158k → 245k → 156k → 136k → **252k** across dogfood-002…008;
  cost-share 15.3 % → 14.8 % → 18.9 % → **25.4 %** over the priced
  campaigns). The share is a new high precisely because step 1 was cheap
  ($0.94): when the executor is efficient, the wasted probe step dominates
  proportionally. This is the strongest argument yet for **WP-221**
  (`claimsComplete` — OR the executor's final-summary signal into the
  WP-217 trigger so the *productive* step is judged directly, sparing the
  probe). Milestone coincided with the cadence tick for the fourth
  straight campaign; WP-221 unchanged, still rides the next contracts PR.
- **Token-economics baseline** (WP-203/WP-207 data): 958k executor input
  tokens (706k step 1 + 252k step 2) for a 2-step, 8.9 KB-diff, 3-file
  change ($1.32). Per-step input (706k step 1) still dominated by the
  codex CLI's internal repo re-reading loop; this WP's longer,
  multi-part instruction pushed step 1 above dogfood-007's 586k. Priced
  trend: 1 592k/$2.14 → 1 056k/$1.43 → 722k/$1.00 → 958k/$1.32.
- **Ceremony note**: delivery again verified in the run workspace and left
  uncommitted on `main` for review rather than auto-landed. WP-224 itself
  is what makes `chikory land --verify` the safe default — once landed,
  future campaigns can harvest through it. No new number.

## Verdict on the thesis (eighth data point)

- Eight campaigns, eight first-attempt SUCCESSes; second zero-new-friction
  campaign. The engine has now built the tool that closes its own delivery
  ceremony gap (`land --verify`), self-hosted and self-verified.
- The lone recurring tax (F-11 probe step) is sharpening into the clearest
  ROI case in the backlog: at 25.4 % of run cost it now wastes more, in
  proportion, than ever — and the fix (WP-221) is contract-gated, waiting
  only on the next architect-reviewed PR.
- Open friction is now: WP-225 (F-19 test de-flake, trivial — **next
  dogfood**), WP-219's ADR, and the two contract-gated items (WP-221,
  WP-218 slice 2) riding the next architect PR. WP-224 leaves the queue.
