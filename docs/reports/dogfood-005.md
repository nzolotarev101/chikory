# Dogfood-005 — WP-220 (`chikory land <run-id>`) through Chikory

**WP**: WP-220 · **Date**: 2026-06-12 · **Task spec**: [`examples/dogfood/dogfood-005.yaml`](../../examples/dogfood/dogfood-005.yaml) · **Run**: `run-34926e85-ac66-4a71-b2c5-e9bb1607c63e` · **Landed**: pending — diff applied + verified, uncommitted on `wp-220-chikory-land` (the run's review precedes the commit; this is the **last hand-landing** — the deliverable itself automates the next one)

> Fifth dogfood, fifth consecutive first-attempt SUCCESS — and the first
> with a **working cost meter**: the WP-218 pricing landed in `2a4dd21`
> metered this run at $2.14 against its $5 budget, ending three campaigns
> of `$0.00` blindness. The deliverable was verified the strongest way
> available: `chikory land` was run **against its own run** into a clean
> clone and produced the exact pure commit it was built to produce.
> New friction: F-17–F-18, continuing dogfood-004's F-14…F-16.

## The run

Zero-secrets setup identical to dogfood-002/003/004: `codex` executor
(ChatGPT OAuth), Gemini judge behind `scripts/cli-judge-proxy.mjs`
(openai executor / gemini-3.1-pro-preview judge — invariant #2 holds).

```
run run-34926e85… · SUCCESS · 2 steps · $2.14 / $5.00 · 5m 45s · executor codex(openai) · judge openai-compat
 1   Implemented WP-220 in exactly three…  1347k/8.7k  $1.77
 2   WP-220 is implemented in the requir…  245k/2.0k   $0.33   ✓ PROCEED (3/3 criteria)
totals: decisions 2 · judge passes 1 ($0.04, 1.9%) · rollbacks 0 · escalations 0 · checkpoints 2
```

Step 1 did all the work (25 tool calls, 3 m 58 s, diff 10 835 bytes across
the 3 in-scope files) and reported full verification — land+trace suites,
typecheck, lint, build, plus a full-suite run. Step 2 produced an empty
diff (11 tool calls, 1 m 7 s, 245k input tokens re-verifying); the WP-217
empty-diff milestone trigger fired (cadence 2 landed on the same step),
the judge executed all three checks in the workspace clone (land 5/5 +
trace 14/14 = 19 tests · typecheck+lint clean), passed all four rubric
items, and sealed SUCCESS.

Journal integrity clean: 7 entries (2 step, 1 judge, 1 verdict,
2 checkpoint, 1 terminal), no duplicates, checkpoint chain consistent
(`@1` lastGood:false pre-judge → `@5` lastGood:true after PROCEED).

Cost telemetry — **first fully priced campaign**: $1.7707 step 1 +
$0.3261 step 2 + $0.04 judge = $2.1368, arithmetic consistent with the
`2026-06-12` pricing table (1 346 867 in × $1.25/MTok + 8 710 out ×
$10/MTok = $1.77). The `⚠ cost meter blind` warning is correctly absent.
F-9 is closed end-to-end: the budget gate finally saw real numbers
(43 % of the $5 cap consumed; judge share 1.9 % ≪ the 0.5 warn line).

## Delivery quality (human review, post-landing)

Verified independently (devbox, host repo, fresh `devbox run build` first
— the F-16 lesson):

- **AC-1**: `vitest run test/cli/land.test.ts` — 5/5 (happy path,
  `--branch` override, all three failure modes exit 1 with the actionable
  message and create no commit).
- **AC-2**: `vitest run test/cli/trace.test.ts` — 14/14 (main.ts wiring
  intact for other commands).
- **AC-3**: `tsc --noEmit` and `eslint .` — clean.
- **Full suite**: 197 passed, 19 skipped, 0 failed (live provider tests
  correctly skipped on the host — no shim env exported).
- **The change is exactly the spec.** `land.ts`: `cmdLand` on the
  CliDeps/CommonFlags seams, `workspaceDir()` resolution,
  `chikory-base..HEAD` diff with the `main..HEAD` fallback, the three
  ordered failure gates, create-or-checkout branch, `git apply` via stdin,
  one squashed `feat: land <run-id>` commit citing run-id + workspace +
  verification commands, branch/sha/forensics output, `--json` supported,
  `execFileSync` only, `chikory:` error prefix matching the existing CLI
  style. `main.ts`: parse + dispatch + help entries. `types.ts`,
  `schemas.ts`, `src/runner/` untouched as ordered (read-only `paths.js`
  import only).
- **Scope discipline held**: exactly the 3 named files, 264 insertions,
  0 deletions; the worktree harvest is byte-identical to the workspace
  (per-file `diff -q` against the run workspace: 3/3 MATCH).
- **Live proof — `land` landed its own run.** Against a clean clone of
  the host repo at `2a4dd21`:
  `pnpm chikory land run-34926e85… --repo /tmp/land-verify` →
  branch `land-run-34926e85…`, **one** commit, subject
  `feat: land run-34926e85…`, body citing run-id + source workspace +
  the four devbox verification commands, clean tree afterward, and all
  3 files byte-identical to the reviewed harvest. The pure-commit
  auditability F-13 asked for is now mechanical.

**WP-220 status**: done pending commit. The `--pr` half (gh) was
explicitly deferred by the spec and stays in the WP-220 row's tail.

## New friction (numbering continues dogfood-004)

- **F-17 — `land` commits unverified and leaves `dist/` stale.**
  Dogfood-004 F-16 closed with "WP-220's `chikory land` must rebuild
  before verifying" — but the dogfood-005 spec (deliberately, to keep the
  slice offline-mechanical) scoped `land` to harvest.sh's
  *apply-and-commit* half only. Net: `land` creates the commit, runs
  nothing, and the printed `forensics: chikory trace …` line still
  executes yesterday's `dist/` until a manual `devbox run build`. The
  verify half of DOGFOODING §6 (build → lint → typecheck → test) remains
  human ceremony, now *after* the commit exists instead of before.
  → **WP-224**: `chikory land --verify` — rebuild + run the four cited
  commands via devbox after applying, report pass/fail against the fresh
  commit (and exit nonzero on red so tooling can gate on it).
- **F-18 — git stderr chatter bypasses the CLI's out/err seam.** The live
  land printed git's own `Switched to a new branch '…'` before the
  command's output: `execFileSync` pipes stdout but inherits stderr, so
  git noise reaches the terminal raw — untestable via CliDeps, and it
  pollutes stderr for `--json` consumers. → no new WP: one-line fix
  (capture stderr in the `git()` helper, fold it into `errorMessage`)
  rides WP-224's touch of `land.ts`.

Recurrences, not new numbers:

- **F-11 recurred** (completion probe tax), fourth data point and the
  first *priced* one: 245k input tokens / 11 tool calls / 67 s / **$0.33
  — 15.3 % of the run's cost** to rediscover "nothing to do" (155k
  dogfood-002, 211k dogfood-003, 158k dogfood-004). The probe step now
  has a dollar sign on it; WP-221 (`claimsComplete`) unchanged, still
  rides the next contracts PR.
- **F-14 recurred** (judge-shim env leaks into the executor): both step
  summaries report "2 unrelated live provider tests failed" during
  in-workspace full-suite runs — `providers.integration.test.ts`
  un-skipped by the inherited `OPENAI_COMPAT_BASE_URL` again, HTTP 500
  from the shim this time. The executor again shrugged it off, but it's
  burned tokens, judge-backend quota, and nondeterminism on every codex
  campaign. WP-222 is now the top dogfoodable item — dogfood-006 targets
  it.
- **F-13 recurred once more on the human side**: `2a4dd21` mixed
  WP-218's run diff with the dogfood-004 review docs and harvest.sh
  edits in a single commit (the F-15 flake had left the landing half-done
  and everything rode together). Exactly the impurity `chikory land`
  eliminates: run diff → its own pure commit, review docs → separate.
  No new WP; this campaign's deliverable is the fix.
- **Token-economics baseline** (WP-203/WP-207 data): 1 592k executor
  input tokens for a 2-step, 10.8 KB-diff change (1 347k step 1 ·
  245k step 2) — ~1.8× dogfood-004's 869k for a comparably sized slice,
  and now priced: **$2.14 per ~265-line CLI feature**. Step 1's 1.35M
  input across 25 tool calls is the codex CLI's internal loop re-reading
  context; extrapolated to WP-219-style chained runs this is the cost
  curve WP-203 compaction has to bend.

## Verdict on the thesis (fifth data point)

- Five campaigns, five first-attempt SUCCESSes. This one closes the loop
  on landing: the engine now produces work *and* the pure, auditable
  commit that ships it — demonstrated by the deliverable landing itself.
- The meter era begins: the first campaign where budget governance was
  real (CG-2 live at $2.14/$5.00) — and the first where a friction item
  (F-11's probe step) arrives with a price tag instead of a token count.
  Priced friction is sortable friction.
- The frontier keeps moving outward, as dogfood-004 predicted: loop
  internals clean for the third straight run; everything new is operating
  environment — landing verification (F-17), CLI seam cosmetics (F-18),
  and the still-open env-leak (F-14, dogfood-006's target). The
  remaining hand ceremony per campaign is now: write the spec, launch,
  review, and (until WP-224) run the verify commands after `land`.
