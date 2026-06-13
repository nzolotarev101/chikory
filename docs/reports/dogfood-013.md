# Dogfood-013 — WP-208 slice 2 (pure `slackPayloadFor` formatter)

**WP**: WP-208 · **Date**: 2026-06-13 · **Task spec**: [`examples/dogfood/dogfood-013.yaml`](../../examples/dogfood/dogfood-013.yaml) · **Run**: `run-048635b1-e845-413d-8f39-ab1104fef01a` · **Landed**: pending — diff verified in the workspace clone, harvested uncommitted on `main` (review precedes commit)

> Thirteenth dogfood, thirteenth consecutive first-attempt SUCCESS, and the
> **seventh** campaign with zero new friction (after dogfood-006, dogfood-008,
> dogfood-009, dogfood-010, dogfood-011, dogfood-012). The engine added the
> pure half of WP-208's delivery layer — `slackPayloadFor`, a function mapping
> a single `Notification` to the Slack message body `{ text }` the webhook
> POST will carry, with a trigger-specific emoji prefix
> (`🚨`/`✅`/`🏁`) — in exactly the two NEW files the spec allowed, hitting the
> prescribed `Record<Notification["trigger"], string>` lookup and the three
> emoji-prefixed payloads byte-for-byte. The actual side-effectful delivery
> (the `fetch` to `slackWebhookEnv`, the desktop ping) and the runner
> call-site remain deferred to a later, non-pure slice. The only friction this
> run shows is the familiar WP-217 completion-probe tax (F-11), here a **new
> record-high 35.1 %** of run cost ($0.2966 / 220k input tokens) — edging
> past dogfood-011's 34.3 %; the spread (now **5.8 %–35.1 %**), not the
> magnitude, is the WP-221 argument.

## The run

Zero-secrets setup identical to dogfood-002…012: `codex` executor (ChatGPT
OAuth), Gemini judge behind `scripts/cli-judge-proxy.mjs` (openai executor /
`gemini-3.1-pro-preview` judge — invariant #2 holds; the trace header's
"judge openai-compat" is only the shim backend label, the real judge family
is Gemini, structurally distinct from the openai/codex executor; judge share
4.1 % ≪ the 0.5 cap).

```
run run-048635b1… · SUCCESS · 2 steps · $0.85 / $5.00 · 3m 10s · executor codex(openai) · judge openai-compat
 1   Implemented WP-208 slice 2 with exa…  387k/3.0k   $0.51
 2   WP-208 slice 2 was already implemen…  220k/2.1k   $0.30   ✓ PROCEED (3/3 criteria)
totals: decisions 2 · judge passes 1 ($0.03, 4.1%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 2 · feedback frequency 1/2 steps
        issues found 0 · changes made 1 (issues:changes 0:1)
        components over time: s0 s1 j@1
```

Step 1 did all the work (18 tool calls, 1 m 29 s, diff **1861 bytes** — the
14-line `notification-delivery.ts` module + the three-test
`notification-delivery.test.ts`) and self-verified: 21 focused tests passed,
strict typecheck and lint clean, exactly the two authorized new files
created, no existing file changed, no commit. Step 2 produced an **empty
diff** (13 tool calls, 58 s, 220k input tokens — re-ran `pnpm install` + the
SDK suite + typecheck/lint, then "WP-208 slice 2 was already implemented
exactly as requested on `HEAD`; no edits were needed… Worktree remains
clean"); the WP-217 empty-diff milestone and the cadence-2 tick landed on the
same step again — **ninth campaign in a row**, the milestone trigger has
still never fired *off*-cadence in production. The judge executed all three
checks in the workspace clone (`3 passed, 0 failed`), passed all four rubric
items, and sealed SUCCESS.

Journal integrity clean: no duplicate entries, no re-execution, no resume;
checkpoint chain consistent (`@1` `610839ad241d` lastGood:false pre-judge →
`@5` `5d939dda47a6` lastGood:true after PROCEED), 2 checkpoints / 2
decisions.

Cost telemetry healthy (ninth priced campaign): $0.5141 step 1 + $0.2966
step 2 + $0.0349 judge ≈ $0.85, no `⚠ cost meter blind` warning; **16.9 %**
of the $5 cap consumed — the cheapest priced campaign to date. Per-step costs
carry the honest `(estimated)` tag — codex returns no exact usage, so tokens
are estimated and priced against the `2026-06-12` table
(`gemini-3.1-pro-preview` present in `packages/sdk-ts/src/pricing.ts`; judge
$0.0349 at the judge step's measured tokens, 5004 evidence bytes, 42 s).

## Delivery quality (human review, post-run)

Verified independently in devbox against the harvested change (delivery not
yet landed; the run's workspace files are mirrored uncommitted on `main` and
are **byte-identical** to the run-workspace copies — `diff` against
`.chikory/runs/run-048635b1…/workspace/…` reports `IDENTICAL` for both
files). All three acceptance checks rerun by hand, real output:

- **AC-1** — `pnpm --filter @chikory/sdk exec vitest run test/runner/notification-delivery.test.ts`:
  **3 passed**, 1.29 s — the escalate/milestone/terminal emoji-prefixed Slack
  payloads.
- **AC-2** — `vitest run test/runner/notifications.test.ts test/cli/trace.test.ts`:
  **18 passed**, 1.03 s. The new module has no call-sites, so nothing else
  can change — confirmed.
- **AC-3** — `tsc --noEmit` and `eslint .`: both clean, no output.

**The change is exactly the spec.** `notification-delivery.ts` imports
`Notification` as a TYPE import from `"./notifications.js"`, defines the
`const EMOJI: Record<Notification["trigger"], string>` lookup
(`{ escalate: "🚨", milestone: "✅", terminal: "🏁" }`) exactly as prescribed,
and `slackPayloadFor` returns `{ text: `${EMOJI[notification.trigger]} ${notification.message}` }`
— no other export, no other trigger handling (the union is exhaustive), no
network/IO. The test imports `slackPayloadFor` from the `.js` specifier,
builds three inline `Notification` fixtures
(`escalate`/atStep 1, `milestone`/atStep 2, `terminal`/atStep null) inside a
`describe("slackPayloadFor (WP-208)", …)` block, and `.toEqual`s the three
prescribed emoji-prefixed bodies — the three required cases, no more.

- **Scope discipline held**: `git status --short` = exactly the two NEW
  files, `packages/sdk-ts/src/runner/notification-delivery.ts` and
  `packages/sdk-ts/test/runner/notification-delivery.test.ts`. Every
  restricted path the goal named (`types.ts`, `schemas.ts`, `taskspec.ts`,
  the runner agent loop, `notifications.ts` — slice 1, on HEAD, untouched —
  all existing src/tests) is unchanged; no new dependency, no new journal
  kind, no contract change. AGENTS.md conventions honored (strict TS, ESM
  `.js` imports, named exports only, no default export).

**WP-208 status**: slice 2 done pending commit. The pure payload-formatting
half now exists with no call-site (`Notification` → `{ text }`). Remaining
work: WP-208 slice 3 — the side-effectful delivery (Slack webhook via
`slackWebhookEnv`, desktop ping) + the runner call-site that invokes
`notificationsFor` and dispatches `slackPayloadFor` output. That slice is
non-pure (touches the runner loop). One pure piece can still be carved off
ahead of it — the desktop-ping payload formatter, mirroring `slackPayloadFor`
— and is queued as the next 🟢 (see dogfood-014); the `fetch`/dispatch +
call-site is the last, non-pure slice.

## New friction

**None.** Highest friction number stays F-19 (closed in dogfood-009).
Recurrences and baseline data only:

- **F-11 recurred** (completion probe tax), **twelfth data point, ninth
  priced campaign**: 220k input tokens / 13 tool calls / 58 s / **$0.2966 —
  35.1 % of run cost** to confirm "nothing to do" (155k → 211k → 158k →
  245k → 156k → 136k → 252k → 34k → 144k → 244k → 212k → **220k** across
  dogfood-002…013; priced cost-share 15.3 % → 14.8 % → 18.9 % → 25.4 % →
  5.8 % → 16.1 % → 34.3 % → 25.1 % → **35.1 %** over the nine priced
  campaigns). The share is a **new record high** — it edges past
  dogfood-011's 34.3 %, widening the spread to **5.8 %–35.1 %**. The record
  is driven not by an expensive probe (220k is mid-range, the probe re-ran
  `pnpm install` + the full SDK suite + typecheck/lint as always) but by the
  **cheapest productive step yet** ($0.5141 step 1, a 14-line module + 3
  tests): the smaller the real work, the larger the fixed-cost probe looms.
  That is precisely the WP-221 argument — the probe's cost is independent of
  the work it follows. The milestone coincided with the cadence tick for the
  **ninth straight** campaign; the inferred completion signal has still never
  fired off-cadence in production. WP-221 (explicit `claimsComplete`, judge
  the *productive* step directly) unchanged, still rides the next
  architect-reviewed contracts PR.
- **Token-economics baseline** (WP-203/WP-207 data): 607k executor input
  tokens (387k step 1 + 220k step 2) for a 2-step, 1861-byte-diff, ~50-line
  change ($0.85) — the **cheapest and lowest-token priced campaign to date**
  (next under dogfood-009's 638k/$0.86). The probe step's 220k again
  duplicates the authoritative judge check (Memory-Pointer-Pattern / WP-202
  candidate, flagged since dogfood-009); no new number. Priced trend:
  1 592k/$2.14 → 1 056k/$1.43 → 722k/$1.00 → 958k/$1.32 → 638k/$0.86 →
  901k/$1.22 → 689k/$0.94 → 829k/$1.14 → **607k/$0.85**.
- **Ceremony note**: delivery again verified in the workspace clone and
  harvested uncommitted on `main` for review. WP-224 (`chikory land
  --verify`) remains available and was again not used this run. No new
  number.

## Verdict on the thesis (thirteenth data point)

- Thirteen campaigns, thirteen first-attempt SUCCESSes; **seventh** zero-new-
  friction campaign. The engine extended WP-208 cleanly into its delivery
  layer: a pure `Notification` → `{ text }` formatter under a strict
  two-NEW-file scope contract, hitting the prescribed emoji lookup and
  payload strings exactly — the eighth clean pure/renderer-shaped slice the
  dogfood loop has delivered.
- The lone recurring tax (F-11) set a **new record high (35.1 %)** across
  twelve data points, widening the spread to **5.8 %–35.1 %**. The record was
  set from below — the probe was mid-range (220k) but the productive step it
  follows was the cheapest yet ($0.51). That is the sharpest WP-221 argument
  to date: an inferred completion signal's *share* balloons whenever the real
  work is small, because the probe's cost is fixed and independent of it; an
  explicit signal that judges the productive step directly pays zero probe.
  WP-221 stays contract-gated, waiting on the next architect-reviewed PR.
- Open friction is unchanged: WP-219's ADR (objective gap, human-design) and
  the two contract-gated items (WP-221, WP-218 slice 2) riding the next
  architect PR. WP-208's pure formatter landed; its remaining work splits
  into one more pure piece (the desktop-ping payload formatter — the next 🟢,
  dogfood-014) and the side-effectful delivery + runner call-site (the last,
  non-pure slice). With dogfood-014 the WP-208 pure vein is exhausted; the
  loop then meets the contract/ADR-gated wall — slice 3, WP-221, WP-218
  slice 2, and WP-219 all need hand-done architect work first.
