# dogfood-158 — the write boundary now sees files git was told to ignore (WP-589)

**WP:** WP-589 half (1) (the write-boundary check must see gitignored writes; F-264) · **Date:** 2026-08-19 ·
**Spec:** `examples/dogfood/dogfood-158-wp589-boundary-sees-ignored-writes.yaml` ·
**Run:** `run-71087607-eca4-41ca-b73b-febb0f484b8e` · **Landed:** this review's commit ·
**Ladder:** rung-0 (off-ladder — P3's ladder rung-5 is an operator-run benchmark suite, not a spec)

## Plain lead

A chain node is handed a list of files it is allowed to write. Until this run that list was
checked only against files git tracks, so anything a node wrote into a folder listed in
`.gitignore` was invisible — one earlier run dumped 2.1 GiB across 95,068 files outside its
boundary and still passed. That hole is now closed, and the folders the build tools own
(`node_modules`, `dist`, the Python venv) are correctly waved through.

The interesting part is what the two graders did. The **model judge caught a real defect at
step 1** — the exemption was written too broadly — and the loop **repaired it at step 2** without
a human. Human review then caught the opposite error the judge and all three acceptance checks
missed: the exemption was too *narrow*, waving through only `node_modules` while a real workspace
also carries `dist/`, `.venv/`, `.devbox/` and `coverage/`. As shipped, the feature would have
failed the seal on any node that built the package. Hand-fixed this sitting.

## Trace

| field | value |
|---|---|
| terminal | 🟢 SUCCESS · 2 steps · 16m 8s |
| cost | **$0.1891** of $20 budget (**0.9%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — unpriced (subscription-linked, `zero-wire-cost`; F-268 standing) |
| judge | `openai-compat` / `gpt-5.6-sol` xhigh · 4 passes |
| verdicts | rollbacks 0 · escalations 0 · resumes 0 |
| checkpoints | 2 · injections 0 |
| acceptance | AC-1 PASS · AC-2 PASS · AC-3 PASS (re-run in the working tree (brownfield — harvested delivery)) |
| harvest | 5/5 files byte-**IDENTICAL** to the run workspace |

**Per-step:**

| # | tokens in/out | cost | wall | verdict |
|---|---|---|---|---|
| 1 | 3.7k/1.6k | $0.0000 | 6m 27s | ✓ PROCEED (3/3 criteria) — rubric `design_serves_overall_goal` ✗ |
| 2 | 5.4k/1.7k | $0.0000 | 2m 53s | ✓ PROCEED (3/3 criteria) — all rubric rows ✓ |

No empty-diff probe step — **F-11 (wasted probe step) did not recur**.

## Delivery quality (human review, post-landing)

**Landed files (all byte-identical to the run workspace):**

| file | what changed |
|---|---|
| `packages/sdk-ts/src/runner/activities.ts` | `publishChainHandoff` now builds a separate `candidatePaths` set from four git streams (`packages/sdk-ts/src/runner/activities.ts:2894`) and feeds that — not `changedPaths` — to the admission oracle |
| `packages/sdk-ts/src/chain/write-set.ts` | new `isToolchainPath` exemption and `formatUndeclaredPaths` reason-bounder (`packages/sdk-ts/src/chain/write-set.ts:185`) |
| `packages/sdk-ts/src/index.ts` | both helpers exported |
| `packages/sdk-ts/test/chain/write-set.test.ts` | 6 unit tests for the two helpers |
| `packages/sdk-ts/test/runner/publish-handoff-boundary.test.ts` | 9 integration tests driving the real activity over real git workspaces |

**Goal, line by line:**

| goal clause | verdict |
|---|---|
| undeclared ignored write stops the seal and names the path | 🟢 `packages/sdk-ts/src/runner/activities.ts:2884` adds `git ls-files --others --ignored --exclude-standard` |
| toolchain output still seals | 🟡 **only `node_modules`** — see F-401 |
| `RepoHandoff.changedPaths` unchanged | 🟢 `changedPaths` is still the tracked `BASE_TAG..HEAD` diff and is what the handoff carries; the widening is confined to `candidatePaths` |
| failure `reason` stays readable | 🟢 `formatUndeclaredPaths` caps at 10 paths / 1,500 chars |
| declaration beats ignored-ness | 🟢 declared ignored path seals (AC-1 case B) |
| admission rules (F-218) untouched | 🟢 `write-boundary.ts` unmodified; `WRITE_BOUNDARY_NOTE` intact |
| strict ESM, named exports, no `any` | 🟢 `pnpm run typecheck` (src **and** test) green |
| scope: no planner / gate / rubric / reducer / budget / Python / TaskSpec | 🟢 5 files, all on the seam |

**The designed trap was rejected — by the judge, not the checks.** The spec's named
plausible-but-wrong delivery was *no exemption at all*. The executor shipped an exemption, so that
trap never fired. What fired instead was a defect the spec did not anticipate: step 1 filtered
`isToolchainPath` over the **whole** candidate set, so a *tracked* write under `node_modules` also
escaped. All three acceptance checks passed on that delivery. The judge's `design_serves_overall_goal`
row failed it in plain terms — "an undeclared tracked write under node_modules can bypass the
boundary, re-opening the hole explicitly warned about" — the concern rode into step 2 as
`escalation_concerns_adjudicated`, and step 2 narrowed the filter to `ignoredPaths` only
(`packages/sdk-ts/src/runner/activities.ts:2894`), adding two regression tests for the narrower
semantics. Judge pass #4 adjudicated the concern cleared. **This is the 4th consecutive run where
the judge caught a defect and the loop repaired it in-flight.**

**Independent verification (what the ACs took on trust).** AC-1 drove exactly one exemption family
— `node_modules/pkg/lib/util.js` — and the executor's committed tests mirror the ACs case for case,
inheriting the blind spot F-360 warns about. Driving the real `publishChainHandoff` over the ignore
families a chikory workspace actually accumulates gave, **before the hand-fix**:

| family | probe path | verdict as shipped |
|---|---|---|
| dependency install | `node_modules/pkg/lib/util.js` | 🟢 EXEMPT |
| tsc build output | `packages/sdk-ts/dist/chain/write-set.js` | 🔴 FAILED |
| python virtualenv | `.venv/lib/python3.11/site-packages/x/y.py` | 🔴 FAILED |
| devbox activation | `.devbox/gen/scripts/run.sh` | 🔴 FAILED |
| chikory run data | `.chikory/runs/run-x/journal.db` | 🔴 FAILED |
| vitest coverage | `coverage/index.html` | 🔴 FAILED |
| incremental build stamp | `packages/sdk-ts/tsconfig.tsbuildinfo` | 🔴 FAILED |
| ignored file **present at base**, untouched by the node | `packages/sdk-ts/dist/chain/write-set.js` | 🔴 FAILED |

## New friction

### F-401 🔴 — the toolchain exemption was fitted to the one family the acceptance check drove

`isToolchainPath` exempted a single path segment, `node_modules`. That is the only family AC-1
case C instantiated, the only family the executor's own tests instantiate, and the only family
the judge reasoned about across four passes.

**Evidence (measured, not argued).** A real dogfood workspace,
`.chikory/runs/run-f3d47cf8-6d56-4c7b-85d1-fcfe185badef/workspace`, ends with **2,605 gitignored
files that are not under `node_modules`**: `packages/sdk-ts/dist` (604), `.venv` (1,906),
`benchmarks/harness/dist` (64), `.devbox` (31). None appear in any `writeSet`. A chain node
sealing in that state fails on its own build output. This is precisely the outcome the spec named
as "strictly worse than the hole" — the delivery moved it from *no* exemption to *one*.

**Disposition — HAND-FIXED THIS SITTING.** `isToolchainPath`
(`packages/sdk-ts/src/chain/write-set.ts:173`) now matches a named set of toolchain-owned segments
(`packages/sdk-ts/src/chain/write-set.ts:133`) plus toolchain file suffixes. Segment matching is
preserved, so `lib/dist.ts` and `lib/not_node_modules/file.ts` are still the node's own work.
`benchmarks/results` and `benchmarks/runs` — the families dogfood-123 escaped 2.1 GiB into — are
deliberately **not** exempt. Pinned by 10 table-driven integration cases over the real activity
(`packages/sdk-ts/test/runner/publish-handoff-boundary.test.ts:311`), 4 negative cases
(`packages/sdk-ts/test/runner/publish-handoff-boundary.test.ts:345`), and 2 unit cases
(`packages/sdk-ts/test/chain/write-set.test.ts:171`, `packages/sdk-ts/test/chain/write-set.test.ts:183`).
Declared suite **1663 passed | 23 skipped**, up from 1647 as delivered and 1610 at the launch commit.

### F-402 🟡 — the boundary measures workspace STATE, not what the node wrote

`git ls-files --others --ignored --exclude-standard` (`packages/sdk-ts/src/runner/activities.ts:2884`)
is a snapshot of the working tree. It has no `BASE_TAG` in it, unlike every other stream the check
reads. An ignored file that existed **before the node ran** is therefore reported as an undeclared
write by that node. Probe: a fixture where `packages/sdk-ts/dist/chain/write-set.js` was present at
the base commit and the node only edited `src/a.ts` sealed FAILED, naming the pre-existing file.

Live reachability is currently low — a node's workspace is a fresh `git clone` whose only
pre-existing ignored tree is `node_modules`, written by `ensureWorkspaceDeps`
(`packages/sdk-ts/src/runner/activities.ts:653`), which is exempt. It becomes reachable after a
rollback (tracked files revert, ignored build output does not) and for any non-exempt ignored tree
a future workspace acquires. **Disposition — → WP-638 (queued).**

### F-403 🟡 — the executor's committed tests were case-for-case copies of the grading checks

The spec explicitly warned (F-360) that "a repo test copied verbatim from a grading check inherits
its blind spots". All 9 tests in `packages/sdk-ts/test/runner/publish-handoff-boundary.test.ts` as
delivered are one-to-one restatements of AC-1's cases A–D and AC-2's two cases, plus the two the
judge's step-1 concern forced. Zero of them instantiate an input family the ACs did not name — the
mechanism by which F-401 shipped invisible. The durability floor in AC-3 measures test **count**
(≥1614) and is satisfied by copies. **Disposition — track-B note:** the floor should be paired with
a "name an input family the ACs do not" instruction in the goal; recorded in DOGFOODING §8, no WP.

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-401 | 🔴 | toolchain exemption covered only `node_modules`; a real workspace carries 2,605 other ignored files, so any node that built the package would seal FAILED | **HAND-FIXED THIS SITTING** — `packages/sdk-ts/src/chain/write-set.ts:133`, `packages/sdk-ts/src/chain/write-set.ts:173`; 16 new tests, declared suite 1663 passed |
| F-402 | 🟡 | ignored-path stream is a working-tree snapshot with no `BASE_TAG`, so a file predating the node is blamed on it | **→ WP-638 (queued)** |
| F-403 | 🟡 | committed tests were case-for-case copies of the ACs, so they inherited the AC's blind spot | **track-B note** — DOGFOODING §8 |

## Verdict on the thesis

🟢 **The inner-loop judge earned its cost again, and this time the number is stark: 100% of the
run's $0.1891 was judge spend, and it bought the only defect anyone caught before landing.** Three
acceptance checks — including two that drive the real activity over real git workspaces — passed a
delivery whose exemption re-opened the hole the run existed to close. The judge failed it on a
prose rubric row, the concern survived into the next step through
`escalation_concerns_adjudicated`, the executor narrowed the filter, and pass #4 adjudicated it
cleared. Four consecutive runs now: caught, repaired, in-flight, no human.

🔴 **The standing caution sharpened.** The judge and the checks failed the *same* way this run:
both reasoned only about the input family the spec named. The spec named `node_modules`; the AC
instantiated `node_modules`; the executor's tests copied `node_modules`; the judge argued about
`node_modules` across four passes. Nobody asked what else is in `.gitignore`. This is the
[AC must enumerate input families] failure at a new altitude — not a missing negative case, but a
missing *sibling of the positive one*. An exemption list is a value the loop reads; the arming rule
"drive a non-default value of every scalar the loop reads" needs an extension: **when a fix
introduces a set, enumerate the set from the real environment, not from the spec's example.**

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | 2 steps / 16m 8s | 3 steps (dogfood-155) over trailing 3 |
| kill → resume count | 0 | 0 over trailing 3 |
| judge true-positives pre-land | 1 (repaired in-flight) | 4/4 runs with ≥1 catch (155–158) |
| meta:product headline ratio | 0:1 (product) | **0:3** over trailing 3 — cap ≤1 meta/3 not busted |
| per-step reliability (runs ≥5 steps) | n/a (<5 steps) | 94.7% — 9 rollbacks / 170 steps, 21 runs (target 99%+) |
| ladder rung vs exit gate | rung-0 (off-ladder) | P3 rung-5 = WP-304 OpenHands arm + 19-requirement corpus — operator-run, no agent-runnable work since dogfood-139 |

## NEXT RUN

**Make it impossible for one acceptance check to hand the next one a wrecked workspace — including when the file it wrecked is one git was told to ignore.**

- **Spec:** `examples/dogfood/dogfood-159-wp628-check-isolation-modify-delete.yaml`
- **WP:** WP-628 (judge-check ignored-path isolation must cover MODIFY and DELETE, not only CREATE; F-360)
- **Why THIS and not the ladder rung:** the §0 progression gate reads **⛔ STALLED** with this run in the ledger (max steps 2 vs 3 over the trailing three), and a STALLED verdict *binds* the headline to the current phase ladder rung. That rung cannot be run: P3's ladder is WP-530 and its next rung, rung-5, is WP-304's OpenHands arm plus a corpus wide enough to separate 19 requirements at 95% confidence — a quota-bound, multi-hour benchmark suite the **operator** runs by hand (dogfood-122's lesson), and dogfood-139 already delivered rung-5's other half (WP-303). The binding verdict is **unsatisfiable by any spec**, and is recorded as such rather than quietly reinterpreted. The 🔴 this review opened (F-401) was hand-fixed in the same sitting per TASK-PROTOCOL §4 and does not headline. Among runnable candidates WP-628 wins on thesis value: it is product code on the **judge** pillar, and a judge whose evidence depends on the order its checks happened to run in is not a gate.
- **The designed trap — two of them, and both are armed:**
  1. **Fix the pure planner, ship a broken batch.** `planCheckSideEffectCleanup` is a pure function whose unit tests are trivial to green while `runCriteriaChecks` still hands the next check a corrupted tree. AC-1 asserts at the **consumed seam** — the second check in a real batch reads the file the first check destroyed, and *its own exit code* is the oracle.
  2. **Close the hole by reading every ignored file.** A judge workspace carries 17,372 ignored paths; snapshotting them all, twice per check, is hundreds of megabytes per judge pass. This delivery isolates correctly and is still wrong. AC-2 runs the same batch over two fixtures with the **same file count and 64× the bytes** and requires the ratio under 2×.
- **Gate verdicts:**
  - **§0 progression** — ⛔ STALLED; binding rung is WP-530 rung-5, which is operator-run and not expressible as a spec. Recorded as unsatisfiable; proceeding on the highest-value runnable candidate.
  - **§1.1 failure surface** — ✅ cross-file (`src/judge/hermeticity.ts` + `src/judge/evidence.ts`), on the judge pillar, with two independent ways to fail that a competent agent plausibly takes.
  - **§1.2 product progress** — ✅ the landed diff advances open `plan.md` §6 row WP-628; no throwaway utility, no scaffold carve-out needed.
  - **§1.3 mission-critical** — ✅ PROCEED. Not busy work, not scaffold-hosted: it repairs the inner-loop gate itself.
  - **§1.5 friction budget** — ✅ `class=product`; trailing-3 harness-meta headlines **0/3**, cap ≤1 per 3 not busted.
- **AC arming evidence** — all three ACs are VERIFY-SUITE, so the launch preflight does **not** dry-run them; each was hand-verified in BOTH directions with `dogfood-arm.sh`:

| AC | RED on HEAD | GREEN vs reference | % of 120 s judge cap |
|---|---|---|---|
| AC-1 | ✅ exit **1**, 3s | ✅ exit 0, 2s | 3 % |
| AC-2 | ✅ exit **1**, 4s | ✅ exit 0, 3s | 3 % |
| AC-3 | ✅ exit **1**, 80s | ✅ exit 0, 75s | 67 % |

  Worst case **80 s = 67 % of the 120 s cap**. Every RED prints the check's own assertion text (`MODIFY not isolated: overwritten.txt is [CORRUPTED]`), not a crash — read, not inferred from the exit code (dogfood-133's lesson). **AC-2's cost trap was proven three-way discriminating**, which is why it measures a scaling ratio and not a clock: an absolute wall-clock ceiling could not separate the deliveries at all (307 MB reads off a warm SSD cost ~2 s). Measured at this review — HEAD **fails** (no isolation); an unbudgeted read-every-ignored-file reference isolates correctly and still **fails** at ratio **3.21×** (small=596 ms, big=1912 ms); a size+total-budgeted reference **passes** at **0.60×**. The reference was reverted by name; `git diff packages/sdk-ts/src/judge/hermeticity.ts` is empty.

```sh
devbox run run-dogfood
```
