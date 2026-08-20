# dogfood-159 — a check can no longer hand the next check a wrecked workspace (WP-628)

**WP:** WP-628 (judge-check ignored-path isolation must cover MODIFY and DELETE) · **Date:** 2026-08-20 ·
**Spec:** `examples/dogfood/dogfood-159-wp628-check-isolation-modify-delete.yaml` ·
**Run:** `run-ec5c4bb8-de16-4c28-beba-a8cd09795fa1` · **Landed:** this review's commit ·
**Ladder:** rung-0 (off-ladder) vs the P3 exit gate (WP-530 rung-5, operator-run — see "Why not the rung")

## Plain lead

Before a run is graded, the judge runs each acceptance check one at a time and puts the workspace
back between them. That repair only ever covered files a check had *created*; if a check
overwrote or deleted a build artifact or a log, the damage stood and every later check was graded
against the wreckage. It now covers overwrite and delete too, at a cost a real repository can pay.

The run itself is the best evidence yet that the judge earns its place: it found **four** genuine
defects in the executor's own work and the loop fixed all four before anything landed. Two things
still went wrong. The delivery's cost budget was spent on the wrong files, so on a real
17,372-file workspace the new repair **did not fire** on the artifacts a check actually damages —
both acceptance checks were blind to it because their fixtures had no competition for the budget.
And the run parked itself as FAILED for **1 hour 40 minutes** waiting for a human to type
`resume`, because it was allowed only one repair attempt while three of six steps and 98% of its
budget were still unspent.

## Trace

| field | value |
|---|---|
| terminal | 🟢 SUCCESS · 3 steps · 2h 2m wall clock (**1h 40m 52s of it idle** — see F-408) |
| cost | **$0.3358** of $20 budget (**1.7%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — unpriced (⚠ cost meter blind: 6,080 metered tokens billed $0.00) |
| judge | `openai-compat` (`gpt-5.6-sol xhigh`) · 6 passes |
| verdicts | rollbacks 0 · escalations 0 · resumes 0 *(as counted — the run did resume; see F-409)* |
| checkpoints | 3 · injections 0 |
| acceptance | AC-1 PASS · AC-2 PASS · AC-3 PASS (re-run in the working tree, and again after this review's hand-fixes) |
| harvest | 5/5 files byte-**IDENTICAL** to the run workspace |

**Per-step:**

| # | tokens in/out | cost | wall | verdict |
|---|---|---|---|---|
| 1 | 3.9k/2.2k | $0.0000 | 4m 14s | ✓ PROCEED (3/3 criteria) — 3 design defects found |
| 2 | 6.2k/2.1k | $0.0000 | 3m 27s | ✓ PROCEED (3/3 criteria) — 3 fixed, 1 new defect found → **sealed FAILED** |
| 3 | 7.0k/1.4k | $0.0000 | 3m 12s | ✓ PROCEED (3/3 criteria) — clean, sealed SUCCESS |

No empty-diff probe step — **F-11 (wasted probe step) did not recur**.

**Timeline (journal `.chikory/runs/run-ec5c4bb8-.../journal.db`):**

| j-idx | at | event |
|---|---|---|
| 0 | 21:21:32 | run opens |
| 1–7 | 21:25:50 → 21:29:37 | step 1, judge passes #1–#2 |
| 8–14 | 21:33:04 → 21:37:24 | step 2, judge passes #3–#4 |
| 15 | 21:37:24 | **terminal FAILED** (`resumable: true`) — "completion review: unresolved finding on a converged step — design_serves_overall_goal" |
| 16 | **23:17:16** | `control_event {event: "resume", source: "failed_seal"}` — **1h 39m 52s later**, by hand |
| 17–23 | 23:20:28 → 23:23:49 | step 3, judge passes #5–#6 |
| 24 | 23:23:49 | terminal SUCCESS |

## Delivery quality (human review, post-landing)

### Landed files

| file | + / − | what |
|---|---|---|
| `packages/sdk-ts/src/judge/hermeticity.ts` | +157/−30 | budgeted content preservation for ignored paths; binary-safe restore; unpreserved-path reporting |
| `packages/sdk-ts/src/judge/evidence.ts` | +43/−7 | cleanup warnings flow into `CheckRun.output` on both batch paths |
| `packages/sdk-ts/src/judge/index.ts` | +5 | new exports |
| `packages/sdk-ts/test/judge/check-hermeticity.test.ts` | +93 | 7 planner unit tests |
| `packages/sdk-ts/test/judge/check-isolation.test.ts` | +282 | 7 end-to-end batch tests |

Scope is exactly the goal's surface. No new dependencies. `src/chain/write-set.ts` (dogfood-158),
the rubric, the verdict arithmetic and the Python mirror are untouched, as the goal required.

### The goal, line by line

| goal clause | delivered | verified how |
|---|---|---|
| OVERWRITE of a pre-existing ignored file is isolated | 🟢 | AC-1's oracle check reads the original bytes; independently re-run |
| DELETE is isolated | 🟢 | same batch, same oracle |
| CREATE keeps working | 🟢 | same batch — asserted on one object, so no family is graded alone |
| isolation stays affordable | 🟡 | **affordable, but the budget reaches the wrong files** — F-404 |
| untouched majority left exactly alone | 🟡 | true for restore; **false for reporting** — F-406 |
| WP-623 serial batch + per-check timeout untouched | 🟢 | AC-3 greps + 33 tests in `test/judge/check-*.test.ts` |
| ≥1 committed test pinning a family the ACs do not name | 🟢 | 4 of them: nested-directory delete, sequential 4-check mutation, zero-byte truncation, non-UTF-8 binary |

The design: `snapshotWorkspace` now `stat`s every ignored path (O(inventory), no bytes) and reads
content only for files ≤64 KiB up to a 32 MiB total; unpreserved paths carry a
`stat:size:mtime:inode` fingerprint so a change is still *detected*, and an unrepairable change is
reported into the batch's own output. That is a legitimate reading of the spec's precedence rules,
and the trap the spec was built around — a delivery that reads every ignored file and makes real
judge passes unusable — was correctly avoided.

### Independent verification the ACs did not do

The acceptance checks graded a synthetic fixture of 1,200 files in one flat directory. I ran the
real thing: a clone of `.chikory/runs/run-71087607-.../workspace`, **17,372 ignored paths**.

| measurement | as landed | after this review's fixes |
|---|---|---|
| `snapshotWorkspace` wall clock | 822 ms cold / 434 ms warm | unchanged |
| snapshot entries | 16,488 | 16,488 |
| bytes preserved | 32.0 MiB (budget **saturated**) | 32.0 MiB |
| three-check batch, end to end | 2,313 ms | 2,287 ms |
| a check overwrites `packages/sdk-ts/node_modules/.vite/vitest/<hash>/results.json` | 🔴 `NOT ISOLATED: size=9` | 🟢 `ISOLATED size=17004` |
| false corruption warnings on untouched files | 3 | 0 |

Cost is not the problem — 2.3 s per batch on a real workspace is fine. **Reach** is. Details in
F-404 and F-406.

### The designed traps

| trap the spec set | rejected? |
|---|---|
| fix only the pure planner, leave the batch broken | 🟢 AC-1 asserts at the consumed seam — the second check's own exit code |
| drop the special case and read every ignored file | 🟢 AC-2's ratio; measured 1.02x at 64x the bytes |
| grade one input family alone | 🟢 all four families in one batch on one object |

All three held. The trap nobody set — *which* files the budget buys — is the one the delivery fell
into.

## New friction

Continuing the global sequence from **F-403** (dogfood-158).

### F-404 🔴 — the preservation budget was spent on the files no check ever touches

`snapshotWorkspace` allocated its 32 MiB in the lexical order `git ls-files` returns. On a real
judge workspace that order puts `node_modules/.pnpm` first, and it is large enough to exhaust the
budget by itself.

**Measured** on the 17,372-path workspace, as landed: of 9,467 preserved paths, **9,459 were
`node_modules/.pnpm`** — 99.9%. Every project-owned ignored artifact fell outside the budget,
including `packages/sdk-ts/node_modules/.vite/vitest/<hash>/results.json` at 17,004 bytes, well
inside the 64 KiB per-file cap. Driving the real `runCriteriaChecks` over a clone of that
workspace, a check that overwrote it produced `ORACLE exit=1 :: NOT ISOLATED: size=9` — the WP's
own headline goal, unmet at the only entry point that matters.

Both ACs passed because both fixtures were a single flat `results/` directory: no path competed
with any other for the budget, so ordering could not matter. This is the
"AC must drive the real entry point" family (F-274/F-277/F-283) at a new altitude — the AC drove
the real function, with a real git repo and no mocks, and still could not see the defect, because
the *shape of the inventory* was the untested variable.

**Fixed this sitting** — `packages/sdk-ts/src/judge/hermeticity.ts:41` adds
`ignoredPreservePriority`, a three-tier stable ordering (project-owned → nested vendored cache →
root-level vendored store) applied before allocation. The vendored-store set is enumerated from
`git ls-files` over this repo, not from an example (F-401's rule): `node_modules` 17,410 · `.venv`
8,261 · `__pycache__` 1,072 · `.devbox` 38 · `.cargo` 2 · `venv` 1. Re-probed on the same real
workspace: `ORACLE exit=0 :: ISOLATED size=17004`, batch 2,287 ms — **no cost regression**.

### F-405 🟡 — every later check was told it destroyed a file it never touched

The BEFORE snapshot is taken once and never advances. A corruption the budget could not repair
therefore stays visible in *every* subsequent comparison, so the same warning —
`[check-isolation] Warning: 1 unpreserved ignored file(s) modified or deleted by check` — was
appended to the output of each following check, and printed to stderr via `console.warn` once per
cleanup. In the real-workspace probe one corrupting check produced **four** identical warnings
across three checks. The judge reads `CheckRun.output` as evidence; telling it that an inert
`exit 0` check deleted a file is exactly the kind of false evidence the gate cannot afford.

**Fixed this sitting** — `applyCleanupPlan` takes an `alreadyReported` set
(`packages/sdk-ts/src/judge/hermeticity.ts:414`) and both batch consumers thread one per repo
(`packages/sdk-ts/src/judge/evidence.ts:249`, `packages/sdk-ts/src/judge/evidence.ts:367`). The
library-level `console.warn` is gone; the warning rides the structured channel only.

### F-406 🟡 — the budget line itself read as a corruption

`hash` meant two different things either side of the budget: a content sha256 when the bytes were
kept, a stat fingerprint when they were not. The line **moves** — shrink one preserved file and
the freed bytes admit others — so an untouched file could carry a content hash in the BEFORE
snapshot and a stat fingerprint in the AFTER, and the planner compared them as if they were the
same kind. Latent as landed (the boundary sat in a region the probe did not disturb); it fired
immediately once F-404's fix moved the boundary, producing **3 false corruption reports** against
`node_modules/.pnpm` files no check had opened.

This is the defect judge pass #4 reached for and mis-diagnosed — it blamed concurrent workers
sharing `totalPreservedBytes`; the executor's step 3 dutifully hoisted allocation out of the
workers, which was a real improvement and left the actual cause untouched. **A correct symptom
with a wrong mechanism still bought a repair step that did not repair.**

**Fixed this sitting** — every ignored entry now carries `statHash` alongside `hash`
(`packages/sdk-ts/src/judge/hermeticity.ts:63`), and `planCheckSideEffectCleanup` compares
like with like: content hashes when both sides kept content, `statHash` otherwise
(`packages/sdk-ts/src/judge/hermeticity.ts:210`). Real-workspace probe: 3 false warnings → **0**.

### F-407 🟡 — 884 ignored paths vanish from the snapshot entirely

`snapshotWorkspace` keeps an entry only when `stat().isFile()` is true
(`packages/sdk-ts/src/judge/hermeticity.ts:339`). On the measured workspace
**884 of 17,372 ignored paths (5.1%)** are symlinks to directories — the `@scope/pkg` links pnpm
writes — and they now get no entry at all. Before this WP they at least carried a bare `!!` entry.
A check that deletes one is neither restored nor *reported*, which contradicts the spec's own
precedence rule 3: "CHEAPNESS NEVER BUYS BLINDNESS. Whatever the budget, DETECTION covers every
ignored path." Reachable by any check that runs `pnpm install` or `rm -rf node_modules`.

Not hand-fixed: the right shape is an `lstat`-based fingerprint for non-regular entries plus a
decision about restoring link targets, which is design work, not a correction. → **WP-639**.

### F-408 🟡 — one repair attempt per run, no matter how much run is left

`packages/sdk-ts/src/workflow/agent-loop.ts:1348` grants exactly one bounded completion-review
repair; a second unresolved finding seals FAILED (resumable) regardless of remaining steps or
budget. This run used its grant after step 1, and step 2's review raised a **new** finding
(F-406's symptom), so at 21:37:24 it sealed FAILED with **3 of 6 steps and 98.3% of the budget
unspent**. A human typed `resume` 1h 39m 52s later; step 3 fixed the finding in 3m 12s and the run
sealed SUCCESS. **81% of this run's 2h 2m wall clock was dead air waiting for a human to authorise
work the run was already funded and permitted to do.**

The grant is right to be bounded — F-223…F-226 (plan-gate oscillation) is the failure it prevents.
It is wrong to be a constant. → **WP-640**: scale the grant with remaining steps/budget, and count
an attempt only when the finding is *unchanged* (this run's second finding was new, and a new
finding is progress, not oscillation).

### F-409 🟡 — the run resumed and nothing recorded it

The reopen is journaled as `control_event {event: "resume", source: "failed_seal"}` (j-idx 16), but
`chikory trace` renders neither the FAILED seal nor the reopen — its header reads a flat
`SUCCESS · 3 steps` — and `scripts/dogfood-verify.sh:163` counts resumes by grepping that output
for the word `resumed`. So the pack, the facts blob and the ledger all record **`resumes 0`** for a
run that demonstrably recovered from a sealed terminal state.

That is durable-execution evidence — the thesis pillar — being deleted at the measurement layer.
It also feeds the progression gate, which reads `resumes` as one of its four movement axes: a run
that moved that axis was scored as not having moved it. → **WP-641**.

### F-410 🔴 — an outside PR turned every acceptance check into a vacuous PASS

Found while landing this review: `git push` was rejected because **15 outside PRs** had landed on
`main` during the run. One of them, `5bed806` ("🔒 Fix command injection in runCheck via
criterion.check", #90), replaced `runCheck`'s `/bin/sh -c` execution with `splitCommand` +
direct `execFile` of the first token.

Every dogfood acceptance check is a multi-line shell script. Tokenized, the whole script becomes
**arguments to its own first word**. Measured against the real `runCriteriaChecks` on the rebased
tree, with a check body copied from this very campaign:

```
exitCode: 0
infraFailed: false
output: "hello > out.txt\nif [ ! -f out.txt ]; then echo MISSING; exit 1; fi\n…"
```

`echo` ignored its arguments and exited 0. No file was written, no assertion ran, and the judge
would have recorded *"judge-executed check `AC-1` exited 0"* — **PASS**. The same applies to any
check opening with `cd …`. This is the worst failure a gate can have: the oracle always says yes,
silently, on every criterion of every run.

The change also bought no security. Its own rewritten fixtures pass
`sh -c "sleep 0.5 && test -f landed.txt"` — the identical capability, one token over — so the
shell was never actually removed as an option; only the *honest* usage broke. And the PR's new
test **encoded the defect as the contract**: it asserted `exitCode` `0` for a check whose side
effect provably never happened.

**Fixed this sitting** — `runCheck` executes `/bin/sh -c` again
(`packages/sdk-ts/src/judge/evidence.ts:203`), with the measurement written into the comment.
`splitCommand` stays in `packages/sdk-ts/src/util/command.ts` and keeps its `cli/land.ts` caller,
where tokenizing is the right contract. The two tests that encoded the vacuous pass are replaced
by two that pin the real one — a multi-line body executes as a script, and a failing assertion
still exits non-zero (`packages/sdk-ts/test/judge/run-criteria-checks.test.ts:131`). Re-probed
end-to-end: `AC-DOGFOOD-SHAPED exit=0 :: "AC OK: wrote 6 bytes"` and
`AC-MUST-FAIL exit=1 :: "ABSENT"` — the gate can say yes *and* no again. Full suite green at
**1,745 passed | 23 skipped** across 204 files.

**The standing lesson is about the campaign, not the PR.** dogfood-159's own ACs re-ran green in
this review because `dogfood-arm.sh` executes checks through bash directly — the arming path and
the judge path are different executors, so arming cannot detect a broken judge path. → **WP-642**:
arming must run at least one check through the real `runCheck`, so the two agree.

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-404 | 🔴 | preservation budget allocated in git path order — `node_modules/.pnpm` took 9,459 of 9,467 preserved paths and the real corruption target got none | **HAND-FIXED THIS SITTING** — `hermeticity.ts:41`, `hermeticity.ts:345`; 1 new test (`check-isolation.test.ts:525`), RED-then-GREEN proven, real-workspace probe flipped `NOT ISOLATED` → `ISOLATED` |
| F-406 | 🟡 | `hash` compared across the budget boundary, so an untouched file reads as corrupted when the boundary moves | **HAND-FIXED THIS SITTING** — `hermeticity.ts:63`, `hermeticity.ts:210`; 2 new tests (`check-hermeticity.test.ts:210`); 3 false warnings → 0 on the real workspace |
| F-405 | 🟡 | unrepairable corruption re-reported to every later check, misattributing it, plus `console.warn` from library code | **HAND-FIXED THIS SITTING** — `hermeticity.ts:414`, `evidence.ts:249`, `evidence.ts:367`; 1 new test (`check-isolation.test.ts:584`), RED-then-GREEN proven |
| F-410 | 🔴 | an outside PR (`5bed806`, #90) tokenized `criterion.check` instead of running it in a shell, so every multi-line acceptance check became arguments to its own first word and exited 0 without running — a vacuous PASS on every criterion of every run | **HAND-FIXED THIS SITTING** — `evidence.ts:203` restores `/bin/sh -c`; the two tests that encoded the defect replaced by two that pin the real contract (`run-criteria-checks.test.ts:131`); probed end-to-end both ways; suite 1,745 green |
| F-411 | 🟡 | arming executes checks through bash but the judge executes them through `runCheck` — two different executors, so arming cannot detect a broken judge path (this is why F-410 survived a full green arming pass) | **→ WP-642 (queued)** |
| F-407 | 🟡 | 884/17,372 ignored paths (symlinks to dirs) dropped from the snapshot — no detection, no report, contradicting the spec's own precedence rule 3 | **→ WP-639 (queued)** |
| F-408 | 🟡 | completion-review repair grant is 1 per run regardless of remaining steps/budget — sealed FAILED with 3/6 steps and 98.3% of budget unspent; 1h 40m of human latency followed | **→ WP-640 (queued)** |
| F-409 | 🟡 | a `failed_seal` resume is invisible to `chikory trace` and to `dogfood-verify.sh:163`, so ledger records `resumes 0` for a run that resumed | **→ WP-641 (queued)** |

Suite after the hand-fixes: **1,745 passed | 23 skipped** across 204 files — the review rebased
onto 15 outside PRs during landing, so this is above the 1,681 measured before the rebase (as
landed: 1,677; launch baseline: 1,663). All three acceptance checks re-run green against the
fixed tree.

## Verdict on the thesis

**The judge is doing the job the thesis claims for it, and the loop is now healing what it finds.**
Four true positives, every one a real defect in code that had already passed all three acceptance
checks:

| # | pass | finding | resolved |
|---|---|---|---|
| 1 | #1/#2 | ignored bytes round-tripped through UTF-8 — non-UTF-8 files silently corrupted | step 2 |
| 2 | #1/#2 | a deleted unpreserved ignored file produced no plan entry — neither restored nor reported | step 2 |
| 3 | #1/#2 | budget-exceeded corruption reported only to `console.warn`, never into the batch output | step 2 |
| 4 | #4 | budget selection unstable between snapshots, so untouched files could be rewritten | step 3 (symptom fixed, mechanism missed — F-406) |

This is the fifth consecutive run where the judge caught a defect **and the loop repaired it
before landing** (dogfood-155 → 159). The acceptance checks were green at step 1; without the
rubric, this run ships three defects.

The standing caution sharpens. **A green AC is evidence about the fixture, not about the
workspace.** Every AC here was well built — real git repos, no mocks, the consumed seam, a cost
ratio rather than a clock — and all three were blind to F-404 because they held the inventory's
*shape* constant. When a delivery introduces a *budget*, the untested variable is no longer the
input's size or type; it is **which inputs win the budget, and in what order**.

And a harder caution arrived at landing. **The gate's evidence channel was dead on `main` and
nothing in the campaign could tell.** F-410 made every acceptance check exit 0 without running,
and dogfood-159's own ACs still armed green and re-ran green — because arming and the judge use
different executors. The judge's rubric is not the only altitude that can be silently disabled;
the criteria altitude can be too, and it fails *open*.

And the loop's economics are still gated by a human. This run was funded for six steps, spent
1.7% of its budget, and stopped after two because a constant said so — then waited 100 minutes for
a person to say "keep going." Per-step reliability is not the binding constraint here;
**per-run autonomy** is.

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | 3 steps / 2h 2m wall (10m 53s of it working) | 3 steps (157–159), unchanged |
| kill → resume count | **1** (`failed_seal`, hand-initiated) — recorded as 0, see F-409 | 0 recorded over 157–159 |
| judge true-positives pre-land | **4** | 1 · 1 · 4 (157–159) |
| 🔴 loop-integrity friction hand-fixed | **2** (F-404, F-410) | 1 · 1 · 2 (157–159) |
| meta:product headline ratio | product | **0:3** meta:product — cap ✅ |
| per-step reliability (runs ≥5 steps) | n/a (<5 steps) | 94.7% (9 rollbacks / 170 steps, 21 runs) — target 99%+ |
| ladder rung vs exit gate | rung-0 (off-ladder) | P3 exit gate = WP-530 rung-5 (WP-304, operator-run — no agent-runnable rung remains) |

## NEXT RUN

**Make a run that is still finding new problems keep working, instead of stopping with most of its
budget and half its steps unspent and waiting for a person to say "keep going."**

- **Spec:** `examples/dogfood/dogfood-160-wp640-repair-grant-scales-with-headroom.yaml`
- **WP:** WP-640 (the completion-review repair grant must scale with the run's remaining headroom) — F-408
- **Why THIS and not the ladder rung:** §0 reads ⛔ **STALLED**, which binds the headline to the P3
  ladder rung. That rung is unsatisfiable by any spec: rung-5 (WP-530) is WP-304's operator-run,
  quota-bound benchmark arm, and dogfood-139 delivered its other half (WP-303) — there has been no
  agent-runnable rung since. Recorded as unsatisfiable rather than reinterpreted. Sharp irony this
  review measured: dogfood-159 **did** move the resume axis and the gate scored it 0, because a
  `failed_seal` resume is invisible to the ledger (F-409). WP-640 is product code on the
  durable-execution pillar and F-408 is the first measured case of the loop refusing work it was
  funded and permitted to do — 81% of a 2h 2m run was dead air.
- **The designed trap:** the plausible-but-wrong delivery raises the constant. It satisfies the
  headline case and re-opens the oscillation F-223…F-226 forbids. AC-2 collides the two on one
  loop at one `maxSteps`: different objections must reach SUCCESS in ≥4 steps, **and** the same
  objection repeated must still seal FAILED (resumable) within today's 3-step bound. The second
  trap is keying "same finding" on the rubric id — dogfood-159's two objections shared the id
  `design_serves_overall_goal` and differed only in text, so an id-keyed fix does not fix the run
  that motivated the WP; AC-1 is built from that exact shape. A third trap surfaced while arming:
  comparing the **merged** finding set (which unions the sealing verdict's rows, and those
  legitimately change per step) reads "new" on a plainly oscillating run — it broke
  `sealing-design-repair-live.test.ts`'s "EXACTLY 2 review passes" guard, and AC-3 runs the
  declared suite, so it is graded.
- **Gate verdicts:**
  - §0 progression — ⛔ STALLED; bound rung unsatisfiable, recorded as such. 🟡 ALLOW.
  - §1.1 failure surface — ✅ 2–6 steps, a thesis pillar (durable execution), and the delivery must
    satisfy two invariants that pull against each other.
  - §1.2 product progress — ✅ real open `plan.md` §6 product WP (WP-640, queued this review) in
    `src/workflow/`, not scaffolding.
  - §1.3 mission-critical — ✅ PROCEED. Not busy work, not scaffold-hosted.
  - §1.5 friction budget — ✅ `class=product`; trailing-3 meta:product headline ratio **0:3**, cap
    not busted. WP-641 (the harness-meta sibling) was deliberately not chosen.
- **AC arming evidence** — the launch preflight classed all three as VERIFY-SUITE and dry-ran
  none, so every one was hand-verified in BOTH directions with `dogfood-arm.sh`:

| AC | RED on HEAD | GREEN vs reference | % of 120 s cap |
|---|---|---|---|
| AC-1 | ✅ exit **1**, **5s** | ✅ exit 0, **5s** | 4 % |
| AC-2 | ✅ exit **1**, **4s** | ✅ exit 0, **8s** | 7 % |
| AC-3 | ✅ exit **1**, **83s** | ✅ exit 0, **82s** | 69 % |

  Worst case **83 s = 69% of the 120 s judge cap**. Both directions were re-proven AFTER the
  rebase onto the 15 outside PRs and the F-410 fix, against the re-measured suite baseline
  (1,745 → floor 1,749). The RED text is a genuine assertion, not a
  check that died: AC-1's live loop ran, took 3 steps and sealed
  `FAILED — completion review: unresolved finding on a converged step — design_serves_overall_goal`,
  reproducing dogfood-159 in four seconds. AC-3's RED is the durability floor (1,681 < 1,685).
  The throwaway reference was reverted by name; `git diff` on
  `packages/sdk-ts/src/workflow/agent-loop.ts` is empty.

```sh
devbox run run-dogfood
```
