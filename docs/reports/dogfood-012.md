# Dogfood-012 — WP-208 slice 1 (pure `notificationsFor` derivation)

**WP**: WP-208 · **Date**: 2026-06-13 · **Task spec**: [`examples/dogfood/dogfood-012.yaml`](../../examples/dogfood/dogfood-012.yaml) · **Run**: `run-ea31f96c-ed6a-4cdf-9e1d-62fbcd4f948c` · **Landed**: pending — diff verified in the workspace clone, harvested uncommitted on `main` (review precedes commit)

> Twelfth dogfood, twelfth consecutive first-attempt SUCCESS, and the
> **sixth** campaign with zero new friction (after dogfood-006, dogfood-008,
> dogfood-009, dogfood-010, dogfood-011). The engine opened a new WP — the
> first slice of WP-208 (checkpoint notifications) — by adding a pure
> `notificationsFor` function that maps a `JournalEntry[]` + `NotificationPolicy`
> to the ordered list of notification messages, in exactly the two NEW files
> the spec allowed, matching the prescribed escalate/milestone/terminal
> message strings and policy-filter behavior byte-for-byte. Actual delivery
> (Slack webhook, desktop ping) and the runner call-site are deferred to a
> later slice by design. The only friction this run shows is the familiar
> WP-217 completion-probe tax (F-11), here **25.1 %** of run cost ($0.2853 /
> 212k input tokens) — squarely inside the established **5.8 %–34.3 %**
> spread; the spread, not the magnitude, is the WP-221 argument.

## The run

Zero-secrets setup identical to dogfood-002…011: `codex` executor (ChatGPT
OAuth), Gemini judge behind `scripts/cli-judge-proxy.mjs` (openai executor /
`gemini-3.1-pro-preview` judge — invariant #2 holds; the trace header's
"judge openai-compat" is only the shim backend label, the real judge family
is Gemini, structurally distinct from the openai/codex executor; judge share
3.0 % ≪ the 0.5 cap).

```
run run-ea31f96c… · SUCCESS · 2 steps · $1.14 / $5.00 · 4m 5s · executor codex(openai) · judge openai-compat
 1   Implemented WP-208 slice 1 with exa…  617k/4.5k   $0.82
 2   WP-208 slice 1 is implemented in th…  212k/2.0k   $0.29   ✓ PROCEED (3/3 criteria)
totals: decisions 2 · judge passes 1 ($0.03, 3.0%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 2 · feedback frequency 1/2 steps
        issues found 0 · changes made 1 (issues:changes 0:1)
        components over time: s0 s1 j@1
```

Step 1 did all the work (24 tool calls, 2 m 3 s, diff **3876 bytes** — the
47-line `notifications.ts` module + the two-test `notifications.test.ts`) and
self-verified: the new tests passed (2/2), the trace/land suites passed
(24/24), `typecheck` and `lint` clean, exactly the two authorized new files
created, no existing file changed, no commit. Step 2 produced an **empty
diff** (11 tool calls, 1 m 18 s, 212k input tokens — re-ran `pnpm install` +
the SDK suite + typecheck/lint, then "WP-208 slice 1 is implemented in the
two requested files… Worktree: clean"); the WP-217 empty-diff milestone and
the cadence-2 tick landed on the same step again — **eighth campaign in a
row**, the milestone trigger has still never fired *off*-cadence in
production. The judge executed all three checks in the workspace clone (`3
passed, 0 failed`), passed all four rubric items, and sealed SUCCESS.

Journal integrity clean: no duplicate entries, no re-execution, no resume;
checkpoint chain consistent (`@1` `9f0a74dd135f` lastGood:false pre-judge →
`@5` `5c8aad0982b6` lastGood:true after PROCEED), 2 checkpoints / 2
decisions.

Cost telemetry healthy (eighth priced campaign): $0.8157 step 1 + $0.2853
step 2 + $0.0343 judge ≈ $1.14, no `⚠ cost meter blind` warning; **22.7 %**
of the $5 cap consumed. Per-step costs carry the honest `(estimated)` tag —
codex returns no exact usage, so tokens are estimated and priced against the
`2026-06-12` table (`gemini-3.1-pro-preview` present in
`packages/sdk-ts/src/pricing.ts`; judge $0.0343 at the judge step's measured
tokens, 8468 evidence bytes, 43 s).

## Delivery quality (human review, post-run)

Verified independently in devbox against the harvested change (delivery not
yet landed; the run's workspace files are mirrored uncommitted on `main` and
are **byte-identical** to the run-workspace copies — `diff` against
`.chikory/runs/run-ea31f96c…/workspace/…` reports no difference for both
files). All three acceptance checks rerun by hand, real output:

- **AC-1** — `pnpm --filter @chikory/sdk exec vitest run test/runner/notifications.test.ts`:
  **2 passed**, 1.31 s — both the escalate/milestone/terminal derivation case
  and the policy-filter case.
- **AC-2** — `vitest run test/cli/trace.test.ts test/cli/land.test.ts`:
  **24 passed**, 3.79 s. The new module has no call-sites, so nothing else
  can change — confirmed.
- **AC-3** — `tsc --noEmit` and `eslint .`: both clean, no output.

**The change is exactly the spec.** `notifications.ts` imports `JournalEntry`,
`NotificationPolicy`, and `VerdictKind` as TYPE imports from `"../types.js"`,
iterates `entries` in order, and pushes at most one `Notification` per entry:
`verdict` → `escalate` (with `escalateReason ?? "(no reason given)"`) when
`policy.on` includes `"escalate"`, else `milestone` on `PROCEED` when
`"milestone"` is included; `terminal` → `{ atStep: null, message:
`terminal: ${status}` }` when `"terminal"` is included; every other kind
(`step`/`judge`/`checkpoint`/`injection`/`budget_event`/`compaction`/`pacing`)
contributes nothing. The `else if` chain matches the spec's "at most one per
entry" rule exactly (a `PROCEED` is never both escalate and milestone). The
test builds its inline `JournalEntry[]` fixture (a `step`, an `ESCALATE`
verdict atStep 1 / reason "needs human", a `PROCEED` verdict atStep 2, a
`terminal` SUCCESS) and `.toEqual`s the prescribed three-element array under
`{ on: ["escalate","milestone","terminal"] }` and the single terminal
element under `{ on: ["terminal"] }` — the two required cases, no more.

- **Scope discipline held**: `git status --short` = exactly the two NEW
  files, `packages/sdk-ts/src/runner/notifications.ts` and
  `packages/sdk-ts/test/runner/notifications.test.ts`. Every restricted path
  the goal named (`types.ts` — `NotificationPolicy` untouched, `schemas.ts`,
  `taskspec.ts`, the runner agent loop, all existing src/tests) is unchanged
  (`git diff --stat packages/sdk-ts/src/types.ts` empty); no new dependency,
  no new journal kind, no contract change. AGENTS.md conventions honored
  (strict TS, ESM `.js` imports, named exports only, no default export).
  (The unrelated `scripts/harvest.sh` modification in the working tree is
  pre-existing hand-work, not part of this run.)

**WP-208 status**: slice 1 done pending commit. The pure derivation
(`JournalEntry[]` + `NotificationPolicy` → ordered `Notification[]`) now
exists with no call-site. Remaining slices: the Slack-webhook /
desktop-ping **delivery** (side-effectful) and the **runner call-site** that
invokes `notificationsFor` and dispatches — both deferred by the spec. The
delivery's pure half (payload formatting) is the next dogfoodable 🟢 slice
(see dogfood-013).

## New friction

**None.** Highest friction number stays F-19 (closed in dogfood-009).
Recurrences and baseline data only:

- **F-11 recurred** (completion probe tax), **eleventh data point, eighth
  priced campaign**: 212k input tokens / 11 tool calls / 1 m 18 s / **$0.2853
  — 25.1 % of run cost** to confirm "nothing to do" (155k → 211k → 158k →
  245k → 156k → 136k → 252k → 34k → 144k → 244k → **212k** across
  dogfood-002…012; priced cost-share 15.3 % → 14.8 % → 18.9 % → 25.4 % →
  5.8 % → 16.1 % → 34.3 % → **25.1 %** over the eight priced campaigns). The
  share lands mid-to-high in the existing **5.8 %–34.3 %** spread (no new
  record) — the probe re-ran `pnpm install` + the full SDK suite +
  typecheck/lint while the productive step 1 was moderately priced ($0.82).
  The milestone coincided with the cadence tick for the **eighth straight**
  campaign; the inferred completion signal has still never fired off-cadence
  in production. WP-221 (explicit `claimsComplete`, judge the *productive*
  step directly) unchanged, still rides the next architect-reviewed
  contracts PR.
- **Token-economics baseline** (WP-203/WP-207 data): 829k executor input
  tokens (617k step 1 + 212k step 2) for a 2-step, 3876-byte-diff, ~90-line
  change ($1.14). Step 1's 617k is not a new high (757k in dogfood-010 still
  leads). The probe step's 212k again duplicates the authoritative judge
  check (Memory-Pointer-Pattern / WP-202 candidate, flagged since
  dogfood-009); no new number. Priced trend: 1 592k/$2.14 → 1 056k/$1.43 →
  722k/$1.00 → 958k/$1.32 → 638k/$0.86 → 901k/$1.22 → 689k/$0.94 →
  **829k/$1.14**.
- **Ceremony note**: delivery again verified in the workspace clone and
  harvested uncommitted on `main` for review. WP-224 (`chikory land
  --verify`) remains available and was again not used this run. No new
  number.

## Verdict on the thesis (twelfth data point)

- Twelve campaigns, twelve first-attempt SUCCESSes; **sixth** zero-new-
  friction campaign. The engine opened a fresh WP (WP-208) cleanly: a pure
  derivation under a strict two-NEW-file scope contract, hitting the
  prescribed message strings and policy-filter semantics exactly — the
  seventh clean pure/renderer-shaped slice the dogfood loop has delivered,
  and proof the loop generalizes past the now-exhausted WP-209 trace-footer
  vein.
- The lone recurring tax (F-11) stays within its **5.8 %–34.3 %** spread
  across eleven data points (25.1 % this run, no record). The *spread*, not
  the magnitude, remains the cleanest WP-221 argument: an inferred completion
  signal's cost tracks executor discretion (suite re-run vs skip) and the
  size of the productive step it's measured against; an explicit one does
  not. WP-221 stays contract-gated, waiting on the next architect-reviewed
  PR.
- Open friction is unchanged: WP-219's ADR (objective gap, human-design) and
  the two contract-gated items (WP-221, WP-218 slice 2) riding the next
  architect PR. WP-208's pure derivation landed; its remaining slices split
  into a pure payload-formatting half (the next 🟢, dogfood-013) and the
  side-effectful delivery + runner call-site (a later, non-pure slice).
