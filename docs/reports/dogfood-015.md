# Dogfood-015 — WP-219 S3 pure half (pure `readyNodes` chain sequencing)

**WP**: WP-219 · **Date**: 2026-06-13 · **Task spec**: [`examples/dogfood/dogfood-015.yaml`](../../examples/dogfood/dogfood-015.yaml) · **Run**: `run-56d95ffc-e4a4-4ddd-a776-9bca6b9e6b08` · **Landed**: `40ada45` after review exposed F-21 (the earlier `20a43a2` was mislabeled and carried only review docs)

> Fifteenth dogfood, fifteenth first-attempt SUCCESS — and the **first slice
> to code against the ADR-005 contracts**. The engine added `readyNodes(plan,
> completed): PlanNode[]` (the chain executor's dependency-resolution core:
> return, in plan order, every node not yet done whose deps are all done),
> consuming the freshly-frozen `Plan`/`PlanNode` types byte-for-byte. The run's
> own AC-2 re-ran the full contract conformance suite (77 green) *inside the
> workspace*, so this run doubly validates the S1 hand-done contracts: the
> types are usable AND the fixtures still hold. Cheapest campaign to date
> ($0.39). The one new friction is **F-21** — not in the code, in the
> *landing*: the harvested NEW files are untracked, and the operator's commit
> (`20a43a2`) silently omitted them while its message claimed the feature.

## The run

Zero-secrets setup identical to dogfood-002…014: `codex` executor (ChatGPT
OAuth), Gemini judge behind `scripts/cli-judge-proxy.mjs` (openai executor /
`gemini-3.1-pro-preview` judge — invariant #2 holds; judge share 9.8 % ≪ the
0.5 cap; the share is higher only because the run total is tiny).

```
run run-56d95ffc… · SUCCESS · 2 steps · $0.39 / $5.00 · 2m 41s · executor codex(openai) · judge openai-compat
 1   Implemented WP-219 S3 pure half wit…  190k/3.3k   $0.27
 2   WP-219 is already implemented on `H…  56k/970     $0.08   ✓ PROCEED (3/3 criteria)
totals: decisions 2 · judge passes 1 ($0.04, 9.8%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 2 · feedback frequency 1/2 steps
        issues found 0 · changes made 1 (issues:changes 0:1)
        components over time: s0 s1 j@1
```

Step 1 did all the work (14 tool calls, 1 m 23 s, diff **2185 bytes** — the
8-line `src/chain/sequencing.ts` + the four-test `test/chain/sequencing.test.ts`)
and self-verified. Step 2 produced an **empty diff** (6 tool calls, 29 s, 56k
input tokens) confirming "already implemented on HEAD"; the WP-217 milestone
and the cadence-2 tick again coincided — **eleventh campaign in a row**. The
judge executed all three checks in the workspace clone (`3 passed, 0 failed`),
passed all four rubric items, sealed SUCCESS.

Journal integrity clean: 2 decisions, 2 checkpoints, no rollback/escalation/
resume; checkpoint chain `@1` `f89ec8fa76c7` lastGood:false → `@5`
`c15d50703895` lastGood:true.

Cost telemetry healthy (eleventh priced campaign): $0.2701 step 1 + $0.0797
step 2 + $0.0379 judge ≈ $0.39, **7.8 %** of the $5 cap — the cheapest priced
campaign yet. `(estimated)` tags present; priced against the `2026-06-12`
table. Judge evidence 58 316 bytes (the install + vitest output again), benign.

## Delivery quality (human review, post-run)

Verified independently in devbox against the harvested working-tree files
(uncommitted — see F-21). All three acceptance checks rerun by hand:

- **AC-1** — `vitest run test/chain/sequencing.test.ts`: **4 passed**, 1.0 s —
  dependency-free, single-dep, multi-dep, all-complete.
- **AC-2** — `vitest run test/contracts.test.ts`: **77 passed** — the
  `Plan`/`PlanNode` contracts the module imports are intact.
- **AC-3** — `tsc --noEmit` and `eslint .`: both clean.

**The change is exactly the spec.** `src/chain/sequencing.ts` imports `Plan`
and `PlanNode` as TYPE imports from `../types.js` and implements
`readyNodes(plan, completed)` as the prescribed filter — `const done = new
Set(completed); plan.nodes.filter((node) => !done.has(node.id) &&
node.dependsOn.every((dep) => done.has(dep)))` — no other export, no IO. The
test builds the prescribed three-node fixture (N-1 dep-free, N-2 → N-1, N-3 →
N-1/N-2) and asserts the four required cases via `.map((n) => n.id)`. This is
the **first runtime consumer of the ADR-005 `Plan` contracts** — the types are
usable as intended, and the in-workspace conformance run confirms S1 held.

- **Scope discipline held**: exactly the two NEW files (`src/chain/sequencing.ts`,
  `test/chain/sequencing.test.ts`). No existing file touched, no dependency, no
  contract change; judge confirmed `no_unrelated_deletions`/`scope_matches_instruction`.

**WP-219 status**: S1 contracts landed (`d56f35a`); S3 pure half (`readyNodes`)
delivered here. The chain executor now has its dependency-resolution core. Next
pure precondition the executor needs: cycle/validity detection (a cyclic plan
deadlocks `readyNodes` — it would return `[]` forever) → dogfood-016.

## New friction

**F-21 — harvested NEW files land untracked; a partial commit omits them, so a
"feat" commit can ship without its feature's code.** `readyNodes` was harvested
correctly into `src/chain/` + `test/chain/` (verified byte-correct, AC green),
but those paths are **untracked** and commit `20a43a2`
("feat: implement … readyNodes …") contains **only the dogfood-014 review
docs** (`git show --stat 20a43a2` = DOGFOODING/REQUIREMENTS/dogfood-014.md/
README/dogfood-015.yaml/plan.md, zero code). Cause: the harvest *applies*
files but leaves them untracked (by design — it doesn't stage); a subsequent
`git commit -a`/partial-add stages only tracked-modified files and silently
drops new untracked ones, while the message still claims the feature. **Second
occurrence of the pattern** (the same happened at `61f5eb3` for
dogfood-013/14, where the slice-2 file rode in under a "desktopPayloadFor"
message). → spawns **WP-226**: `harvest.sh` should `git add` the files it
applies (stage on apply), so a follow-up commit cannot miss them and the
reconciliation already guarantees what's staged equals the run. Until then,
the harvest guidance's `git add -A` must be followed literally.

  *Tooling sub-note*: `dogfood-verify` §5 reported `not-in-workspace` for
  `src/chain/` because `git status --short` lists the untracked **directory**
  (`?? packages/sdk-ts/src/chain/`), which the byte-diff can't resolve to a
  file. Given F-20's whole point was drop-detection, the verify/audit byte-diff
  should expand untracked dirs to files (`git ls-files --others`). Folded into
  WP-226. AC-1 still proved the files correct, so no delivery risk this run.

Recurrences and baseline only:

- **F-11 recurred** (completion probe tax), **fourteenth data point, eleventh
  priced campaign**: 56k input tokens / 6 tool calls / 29 s / **$0.0797 —
  20.6 % of run cost** (… 252k → 34k → 144k → 244k → 212k → 220k → 125k →
  **56k** across the recent runs; priced cost-share … 35.1 % → 24.1 % →
  **20.6 %** over eleven priced campaigns). Within the **5.8 %–35.1 %** spread,
  no record; eleventh straight cadence coincidence. `claimsComplete` now exists
  (S1, `d56f35a`) — wiring it into the WP-217 trigger to remove this probe is a
  queued implementation slice.
- **Token-economics baseline**: 246k executor input (190k + 56k) for a
  2-step, 2185-byte, ~50-line change ($0.39) — the **lowest-token, cheapest
  priced campaign yet** (under dogfood-014's 499k/$0.74).

## Verdict on the thesis (fifteenth data point)

- Fifteen campaigns, fifteen first-attempt SUCCESSes. The milestone here:
  **the dogfood loop is back on the critical path** — `readyNodes` is the first
  slice to consume the ADR-005 contracts, so the loop is now advancing the P2
  exit gate (chains) rather than clearing 🟢 polish. The hand-done S1 contract
  PR is validated twice over: the types are usable, and the run's own AC-2 kept
  the conformance suite green.
- The defect this run surfaced (F-21) is, again, **in the tooling around the
  loop, not the loop's output** — and again a SUCCESS run exposed it. The code
  is correct and harvested; it just needs committing. WP-226 makes the harvest
  stage what it applies so "feat" commits can't ship empty.
- F-11 stays within spread (20.6 %); its fix is unblocked (contract landed).
  Next: dogfood-016 carves the chain executor's other pure precondition —
  cycle detection over a `Plan` — keeping the S3 pure core growing before the
  non-pure executor slice.
