# Dogfood-014 — WP-208 slice 3 pure half (pure `desktopPayloadFor` formatter)

**WP**: WP-208 · **Date**: 2026-06-13 · **Task spec**: [`examples/dogfood/dogfood-014.yaml`](../../examples/dogfood/dogfood-014.yaml) · **Run**: `run-6b8f648c-1d20-47b9-9639-acdac5f92f75` · **Landed**: `3e1336f` (committed on `main`)

> Fourteenth dogfood, fourteenth consecutive first-attempt SUCCESS — and the
> **first run to modify an existing tracked file** rather than create two new
> ones. The engine added `desktopPayloadFor` (`Notification` → `{ title, body }`,
> a trigger-keyed `TITLE` record + the message as the body) as a pure
> ADDITION beside the existing `slackPayloadFor` in
> `notification-delivery.ts`, plus three tests in the existing test file —
> hitting the prescribed `🚨 Escalation`/`✅ Milestone`/`🏁 Run finished`
> titles byte-for-byte, touching nothing else. That break from the
> two-NEW-file pattern is what surfaced this report's one new friction, **F-20**:
> the harvest tool silently dropped the modified files (non-interactive
> conflict skip) while reporting success. F-20 was root-caused and **fixed
> this session** (harvest rewrite + reconciliation guard + audit tool). The
> recurring WP-217 probe tax (F-11) was a mid-spread 24.1 %.

## The run

Zero-secrets setup identical to dogfood-002…013: `codex` executor (ChatGPT
OAuth), Gemini judge behind `scripts/cli-judge-proxy.mjs` (openai executor /
`gemini-3.1-pro-preview` judge — invariant #2 holds; "judge openai-compat" is
the shim backend label, the real judge family is Gemini, structurally distinct
from the openai/codex executor; judge share 4.3 % ≪ the 0.5 cap).

```
run run-6b8f648c… · SUCCESS · 2 steps · $0.74 / $5.00 · 4m 28s · executor codex(openai) · judge openai-compat
 1   Implemented `desktopPayloadFor` wit…  374k/6.4k   $0.53
 2   Implementation was already present …  125k/2.2k   $0.18   ✓ PROCEED (3/3 criteria)
totals: decisions 2 · judge passes 1 ($0.03, 4.3%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 2 · feedback frequency 1/2 steps
        issues found 0 · changes made 1 (issues:changes 0:1)
        components over time: s0 s1 j@1
```

Step 1 did all the work (25 tool calls, 2 m 49 s, diff **2558 bytes** — the
+16-line `desktopPayloadFor`/`TITLE` addition to `notification-delivery.ts`
plus the +46-line desktop `describe` block and import extension in the test)
and self-verified (24 relevant tests, strict typecheck, lint, `git diff
--check`, no commit). Step 2 produced an **empty diff** (16 tool calls, 50 s,
125k input tokens) confirming "already present exactly as requested"; the
WP-217 empty-diff milestone and the cadence-2 tick again landed on the same
step — **tenth campaign in a row**, the milestone trigger has still never
fired *off*-cadence in production. The judge executed all three checks in the
workspace clone (`3 passed, 0 failed`), passed all four rubric items, sealed
SUCCESS.

Journal integrity clean: 2 decisions, 2 checkpoints, no rollback/escalation/
injection/resume; checkpoint chain consistent (`@1` `42ed6771c5fc`
lastGood:false pre-judge → `@5` `84c4fdc91885` lastGood:true after PROCEED).

Cost telemetry healthy (tenth priced campaign): $0.5305 step 1 + $0.1782
step 2 + $0.0322 judge ≈ $0.74, no `⚠ cost meter blind` warning; **14.8 %**
of the $5 cap — the cheapest priced campaign to date. `(estimated)` tags
present (codex returns no exact usage); priced against the `2026-06-12` table
(`gemini-3.1-pro-preview` present in `pricing.ts`). Judge evidence was large
this pass — **58 052 bytes** vs dogfood-013's 5 004 — the judge pulled the
full `pnpm install` + vitest output into evidence; benign (still 4.3 % cost
share), noted as token-economics baseline, no WP.

## Delivery quality (human review, post-landing)

Verified independently in devbox against the landed commit `3e1336f`. The
run's workspace files were **byte-identical** to the harvested result
(confirmed before commit). All three acceptance checks rerun by hand:

- **AC-1** — `vitest run test/runner/notification-delivery.test.ts`:
  **6 passed**, 0.98 s — the 3 slack + 3 desktop cases (the addition did not
  break slice 2).
- **AC-2** — `vitest run test/runner/notifications.test.ts test/cli/trace.test.ts`:
  **18 passed**, 1.01 s. The new function has no call-sites — confirmed.
- **AC-3** — `tsc --noEmit` and `eslint .`: both clean.

**The change is exactly the spec.** `notification-delivery.ts` gained a NEW
`const TITLE: Record<Notification["trigger"], string>`
(`{ escalate: "🚨 Escalation", milestone: "✅ Milestone", terminal: "🏁 Run finished" }`)
and `desktopPayloadFor(notification): { title; body }` returning
`{ title: TITLE[notification.trigger], body: notification.message }` — no
other export, no other trigger handling, no network/IO. The existing
`slackPayloadFor`/`EMOJI` are **untouched** (`git show 3e1336f` is additive;
the lone "1 deletion" is the import line `import { slackPayloadFor }` →
`import { desktopPayloadFor, slackPayloadFor }`). The test added a
`describe("desktopPayloadFor (WP-208)", …)` block with the three prescribed
inline `Notification` fixtures `.toEqual`-ing the emoji-titled bodies; the
slack `describe` is unchanged.

- **Scope discipline held**: `git show --stat 3e1336f` = exactly the two
  files (`notification-delivery.ts` +16, `notification-delivery.test.ts`
  +46/−1), additive. No restricted path touched (`notifications.ts`,
  `types.ts`, schemas, runner loop all unchanged), no dependency, no contract
  change. AGENTS.md conventions honored (strict TS, ESM `.js`, named exports).

**WP-208 status**: the pure delivery layer is **complete** — slice 1
(`notificationsFor` derivation, dogfood-012), slice 2 (`slackPayloadFor`,
dogfood-013), slice 3 pure half (`desktopPayloadFor`, this run). Remaining:
the side-effectful delivery (Slack webhook via `slackWebhookEnv`, OS desktop
ping) + the runner call-site that invokes `notificationsFor` and dispatches —
non-pure, deferred to the chain/runner work.

## New friction

**F-20 — harvest silently drops modified files and falsely reports success.**
dogfood-014 was the first dogfood to *modify* an existing tracked file (all of
dogfood-001…013 created NEW files). The harvest decided per-file by comparing
the host against the run's **final** version (`cmp`); on "differs" in a
non-interactive terminal it **skipped** the file. For a modified file the host
equals the run's **base** (not its final), so the heuristic mis-classified the
real edit as a conflict, skipped both target files, applied **nothing**, then
printed `Successfully applied changes!` and ran verification (green, because
the host already built). Evidence: the operator's harvest log —
`'…notification-delivery.ts' already exists but differs … Skipping (keeping
host version)` ×2, then `Successfully applied changes`. **Resolved this
session** (commit `0c20694`): `scripts/harvest.sh` now applies the workspace
final version by intent (cp/rm) with a **reconciliation pass** that
hard-errors (exit 1) on any unapplied change — a harvest can no longer claim
success while applying nothing; also dropped a bash-4 `mapfile` dependency
(macOS ships 3.2). Verified by reverting the file to base and re-harvesting:
`mod … → Reconciliation OK → Harvest complete`. No open WP — fixed inline.

  *Audit byproduct*: `scripts/harvest-audit.sh` (new, `devbox run
  harvest-audit`) checked every run's final file content against git history.
  **No functional code was silently lost in any landed campaign.** The only
  `ABSENT` is dogfood-001's `src/memory/pointer-store.ts` — that run's specific
  module was never committed (its WP-143 landing commit took only docs + the
  proxy), but the WP-202 capability exists as `src/artifacts/local.ts`
  (landed via WP-111). Not an active gap.

Recurrences and baseline only:

- **F-11 recurred** (completion probe tax), **thirteenth data point, tenth
  priced campaign**: 125k input tokens / 16 tool calls / 50 s / **$0.1782 —
  24.1 % of run cost** (155k → 211k → 158k → 245k → 156k → 136k → 252k → 34k →
  144k → 244k → 212k → 220k → **125k** across dogfood-002…014; priced
  cost-share 15.3 % → 14.8 % → 18.9 % → 25.4 % → 5.8 % → 16.1 % → 34.3 % →
  25.1 % → 35.1 % → **24.1 %** over ten priced campaigns). Mid-spread, no
  record; spread holds **5.8 %–35.1 %**. The milestone again coincided with
  the cadence tick (tenth straight). **WP-221's contract now exists**
  (`StepRecord.claimsComplete`, landed in the ADR-005 S1 contracts PR
  `d56f35a`) — the remaining work is for adapters to populate it and the
  WP-217 trigger to OR it in, which removes this probe step.
- **Token-economics baseline** (WP-203/WP-207 data): 499k executor input
  tokens (374k step 1 + 125k step 2) for a 2-step, 2558-byte-diff, ~62-line
  change ($0.74) — the **cheapest and lowest-token priced campaign yet** (under
  dogfood-013's 607k/$0.85). Priced trend: … 689k/$0.94 → 829k/$1.14 →
  607k/$0.85 → **499k/$0.74**.

## Verdict on the thesis (fourteenth data point)

- Fourteen campaigns, fourteen first-attempt SUCCESSes. The notable first:
  **an additive edit to an existing file**, not a two-new-file slice — the
  loop handled in-place modification with the same scope discipline (additive
  only, `slackPayloadFor` untouched, judge confirmed `no_unrelated_deletions`).
  WP-208's pure delivery layer is now complete across three slices.
- That same first **exposed F-20** — the harvest's modified-file blind spot —
  which had been latent because every prior dogfood created new files. A
  SUCCESS run again surfaced a real tooling defect (the dogfood-002 lesson);
  it is fixed, with a standing audit (`harvest-audit`) that confirmed no past
  silent losses and now guards against future ones.
- F-11 stays within its **5.8 %–35.1 %** spread (24.1 %, no record). Its fix
  is no longer contract-gated: `claimsComplete` landed in the S1 contracts PR;
  the WP-217 trigger wiring is now an ordinary (dogfoodable) implementation
  slice.
- **The contract wall is down.** ADR-005 (S1) froze the `Plan`/chain contracts
  by hand; the implementation slices that code against them — chain sequencing,
  planner, plan-judge, suspend/resume, chain trace — are dogfoodable again.
  Next: dogfood-015 carves the pure half of the chain executor (S3) —
  `readyNodes(plan, completed)` dependency resolution, the first consumer of
  the new `Plan`/`PlanNode` types.
