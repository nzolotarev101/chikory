# dogfood-144 — the grader now sweeps up files git hides, but only the ones a check created (WP-625)

**WP:** WP-625 (check isolation must cover writes git does not track) · **Date:** 2026-08-15 ·
**Spec:** `examples/dogfood/dogfood-144-wp625-ignored-path-isolation.yaml` ·
**Run:** `run-a8fe46f3-b5e1-4f83-961c-2142220daa12` · **Landed:** this review's commit ·
**Ladder:** rung 0 (off-ladder — P3 rung-5 exit gate needs WP-304, an operator-run suite)

## Plain lead

When the grader runs a task's checks, one check used to be able to trip the next one by leaving a
build file behind — the kind of file version control is told to ignore. That is now fixed for files
a check **creates**. It is still broken for files a check **overwrites or deletes**, and the grader
itself said so: it read the delivery, named the missing half precisely, and refused to sign off. It
was right — a probe confirms an overwritten ignored file both leaks to the next check and survives
the batch with the wrong bytes.

The expensive part is what happened next. The run had 5 of its 6 steps and 99.6% of its budget left,
and a precise diagnosis in hand, and it spent none of it. The harness condemned the work instead of
handing the diagnosis back to the agent to finish — the one path that would have closed the gap is
unreachable for exactly this shape of run.

## Trace

| field | value |
|---|---|
| terminal | 🔴 FAILED (resumable) · 1 step · 5m 5s |
| cost | **$0.0831** of $20 budget (**0.4%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — $0.0000 metered on 4,647 tokens; CLI/OAuth-billed, cost meter blind by design |
| judge | `openai-compat` (gpt-5.6-sol xhigh) · 2 passes |
| verdicts | rollbacks 0 · escalations 0 · resumes 0 |
| checkpoints | 1 · injections 0 |
| acceptance | AC-1 PASS · AC-2 PASS (re-run in the working tree (brownfield — harvested delivery)) |
| harvest | 3/3 files byte-**IDENTICAL** to the run workspace |
| seal reason | `completion review: unresolved finding on a converged step — design_serves_overall_goal, escalation_concerns_adjudicated` |

**Per-step:**

| # | tokens in/out | cost | wall | verdict |
|---|---|---|---|---|
| 1 | 3.1k/1.5k | $0.0000 | 2m 44s | ✓ PROCEED (2/2 criteria), rubric `design_serves_overall_goal` ✗ |

Judge passes: #1 31,977/1,088 tok · $0.0509 · 58 s · 19,213 evidence bytes — #2 (completion review)
20,971/603 tok · $0.0322 · 1m 20s · 44,547 evidence bytes. The judge read **11×** the executor's
input tokens.

No empty-diff probe step — **F-11 (wasted probe step) did not recur**.

## Delivery quality (human review, post-landing)

**Landed files** (3, all named or entailed by the goal — scope clean):

| file | change |
|---|---|
| `packages/sdk-ts/src/judge/hermeticity.ts` | +25/−2: ignored-path inventory in the snapshot |
| `packages/sdk-ts/test/judge/check-isolation.test.ts` | +109: a new live `describe` over both call sites |
| `packages/sdk-ts/test/judge/check-hermeticity.test.ts` | +22: two pure-planner unit cases |

**The mechanism.** `snapshotWorkspace` now appends a name-only inventory of ignored paths from
`git ls-files -z --others --ignored --exclude-standard` (`packages/sdk-ts/src/judge/hermeticity.ts:190`),
`isCreatedStatus` accepts the `!!` status (`:39`), and a pre-existing ignored path that disappears is
deliberately **not** queued for `git checkout` restore (`:149`) — correct, since git cannot restore a
file it never tracked. Deliberately no content read and no hash for ignored entries.

**The goal, line by line:**

| goal bullet | verdict | evidence |
|---|---|---|
| an ignored write is invisible to a sibling, both call sites | 🟢 | probe C: observer exit 0; leak gone after batch |
| pre-existing ignored content untouchable, byte for byte | 🔴 **half** | see below |
| the sweep stays cheap | 🟢 | measured on this repo, below |
| nothing WP-623 established regresses | 🟢 | tracked pair isolated either order, cap kills, exit 3 preserved — `packages/sdk-ts/test/judge/check-isolation.test.ts:151` |
| say what it does NOT cover | 🟢 | step summary declares it explicitly, in a table |

**Independent verification of what the ACs took on trust.** I drove the real `runCriteriaChecks`
against a temp git repo (`.gitignore` = `dist/`, `node_modules/`) with a pre-existing
`dist/keep.js`, one mutation family per probe. Probe deleted after the measurement:

| probe | check pair | sibling observer | after the batch |
|---|---|---|---|
| A — **modify** | `printf CLOBBERED > dist/keep.js` → `grep -q pre-existing dist/keep.js` | **exit 1** (leaked) | bytes are `"CLOBBERED"` — **not** byte-identical |
| B — **delete** | `rm -f dist/keep.js` → `test -e dist/keep.js` | **exit 1** (leaked) | file **gone** |
| C — **create** | `mkdir -p dist; printf x > dist/leak.js` → `test ! -e dist/leak.js` | exit 0 🟢 | leak removed 🟢 |

So the judge's finding is a **confirmed true positive on both halves**. Both snapshots record an
ignored path as bare `"!!"` with no hash, so the `b && a` comparison at
`packages/sdk-ts/src/judge/hermeticity.ts:138` can never fire for it, and the `b && !a` skip at `:149`
means a deletion is never repaired. Isolation now covers one of the three mutation families.

**Designed traps** — all five rejected:

| trap | rejected? | how |
|---|---|---|
| A `git status --porcelain --ignored` | 🟢 | used `ls-files`, per-file; no content read for ignored entries |
| B `git clean -xfd` between checks | 🟢 | pre-existing `dist/` + `node_modules/` survive in every landed test |
| C fixing one call site | 🟢 | AC-1 drives `runCriteriaChecks` **and** `collectEvidence`; both green |
| D isolation becomes leniency | 🟢 | `honest-failure` still exits 3; `slow-a`/`slow-b` still `infraFailed` at the cap |
| E regressing WP-623 | 🟢 | tracked pair isolated in either order, tree clean after |

**Cost of the new call, measured on this repo (not on the AC's 1,500-file fixture):**
`git ls-files -z --others --ignored --exclude-standard` enumerates **27,252 paths / 2,776,875 bytes in
0.49 s** — 17,344 under `node_modules/.pnpm`, 8,238 under `.venv/lib`, only 470 under `.chikory/`
(nested run workspaces are their own git repos, so it does not descend into them). Two snapshots per
check ⇒ ~2 s added to a 2-check batch. Trap A does not bite at real scale. 🟢

**Regression suite, measured by hand at this tree (F-342 — never transcribe):**
`pnpm --filter @chikory/sdk exec vitest run` → **188 files / 1,504 tests (1,481 passed | 23 skipped)
in 58.37 s**. Baseline at the dogfood-143 review was 188 / 1,499 (1,476 passed). **+5 tests, same file
count** — the coverage floor F-356 asked for did move. (The spec's premise comment said 1,499; it was
stale by the time the run launched.)

**Disposition of the delivery:** landed. It is a strict improvement (create-family isolation works,
nothing regressed, suite green and larger), the FAILED seal is *correct* about the residue, and the
residue is queued as WP-628. WP-625 is marked **PARTIAL**, not done.

## New friction

### F-359 🔴 — a design finding raised at the sealing pass buys **zero** repair attempts

**Defect.** `agent-loop.ts` grants one bounded design-fix retry when a completion review turns up a
finding (`packages/sdk-ts/src/workflow/agent-loop.ts:1301` → `buildCompletionReviewBrief`,
`packages/sdk-ts/src/workflow/completion-review.ts:130`). That path is guarded by `hasStanding`
(`packages/sdk-ts/src/workflow/agent-loop.ts:1284`): if any earlier pass — **including the sealing pass
itself** — recorded a failing rubric row or a concern, the review is "terminal-or-nothing" and seals
immediately. But every judge pass pushes its failing rubric rows into `standingFindings`
(`packages/sdk-ts/src/workflow/agent-loop.ts:1134`). At `judge.cadence: 1` on a step that converges,
the sealing pass **is** an earlier pass, so `hasStanding` is always true and the repair path at `:1301`
is unreachable by construction.

**Evidence.** This run. Judge pass #1 named the gap precisely and still returned PROCEED; pass #2 upheld
it; the run sealed FAILED having used 1 of `max_steps: 6` and **$0.0831 of $20** (99.6% unspent), with
`injections 0`. The executor was never told about the finding — not once. The fix the brief would have
asked for is ~15 lines.

**Why the current shape is over-corrected, not wrong-headed.** The comment at
`packages/sdk-ts/src/workflow/agent-loop.ts:446` cites dogfood-121, which lost a 5-node chain to a
converged step re-raising the same advisory concern forever. That risk is already bounded elsewhere:
`MAX_COMPLETION_REVIEWS = 2` (`packages/sdk-ts/src/workflow/completion-review.ts:16`) caps the loop at
*initial review + one re-review after one repair*. One attempt cannot oscillate. The guard removes an
attempt the cost bound already made safe.

→ **WP-627 (queued as the next headline).**

### F-360 🟡 — an AC verified in both directions is still only as good as the input families it names

**Defect.** AC-1 owned its oracle, was armed RED-on-HEAD and GREEN against a reference implementation,
drove both real entry points, and carried four traps — and it graded **create** only. The goal bullet
it was meant to pin says "byte for byte". Two of the three mutation families on the very same object
(modify, delete) went ungraded, and the delivery shipped blind in exactly those two. The LLM judge
caught what the hand-armed deterministic oracle missed.

**Compounding it:** the F-356 durability floor (`test -n "$(grep -rl gitignore test/judge/)"`) is
satisfiable by transcription. The landed `packages/sdk-ts/test/judge/check-isolation.test.ts:151` is a
near-verbatim copy of AC-1's generated test, so the repo test inherits AC-1's exact blind spot — and
the added planner unit case is literally the no-mutation case
(`packages/sdk-ts/test/judge/check-hermeticity.test.ts:107`). Coverage rose +5 tests and **zero** input
families. A floor that counts tests does not raise coverage.

→ **track-B note** (arming rule + DOGFOODING §8), and WP-628's AC carries a create/modify/delete matrix.

### Recurrences (no new F-n)

- **F-306 (executor summary is raw stdout).** The step summary opens with four lines of self-narration
  — "I have launched the check-isolation test and will wait for it to complete. / Waiting for test task
  to complete. / Waiting for judge test suite to complete. / Waiting for test suite to finish." — before
  any content. WP-606 still open.
- **Executor cost meter blind.** $0.0000 on 4,647 metered tokens, as on every recent run: the
  `gemini-cli` adapter is CLI/OAuth-billed and reports no price. Pricing rows exist
  (`gemini-3.7-flash`); this is the known CLI-auth condition, not a pricing-table gap. Judge share is
  100% for the same reason.

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-359 | 🔴 loop-integrity | a design finding raised by the sealing pass is condemned with zero repair attempts; `hasStanding` makes the bounded-repair path unreachable at cadence 1 | **→ WP-627 (queued)** — next headline, dogfood-145 |
| F-360 | 🟡 | an AC armed both ways still graded 1 of 3 mutation families; the durability floor was met by transcribing the AC into the repo | **track-B note** — DOGFOODING §8 + arming rule; family matrix folded into WP-628's AC |

## Verdict on the thesis

🟢 **The strongest judge result of the campaign so far.** A structurally different model family
(gpt-5.6-sol judging a gemini executor) read a delivery that passed **both** hand-armed deterministic
acceptance checks — one of which owned its oracle and was proven in both directions — and correctly
identified an unfulfilled requirement that neither check could see. It named the mechanism, not just
the symptom: "ignored entries are recorded only as paths with status `!!`, without hashes or saved
content, and the planner deliberately does nothing when such a pre-existing ignored path is deleted."
An independent probe confirms every clause. That is Agent-as-a-Judge earning its place in the inner
loop, and it is the answer to the standing caution that a green seal is not evidence the concerns were
wrong — here the concern was right and the seal was red.

🔴 **And self-correction did not happen.** The thesis is "long-running, *self-correcting* agents". This
run detected, condemned, and stopped — with 5 steps and 99.6% of the budget in hand and a repair brief
one function call away. Detection without remediation routing is half the product. F-359 is the gap
between what the judge knows and what the loop does with it, and it is now the headline.

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | 1 step / 5m 5s | 4 steps (dogfood-142) over the trailing 3 |
| kill → resume count | 0 | 0 over the trailing 3 |
| judge true-positives pre-land | **1** (probe-confirmed, both halves) | 3 over the trailing 3 (142: 2, 143: 0, 144: 1) |
| meta:product headline ratio | 0:1 (product) | **0:3** — cap ≤1 meta per 3 not approached |
| per-step reliability (runs ≥5 steps) | n/a (<5 steps) | 94.7% — 9 rollbacks / 170 steps, 21 runs ≥5 steps (target 99%+) |
| ladder rung vs exit gate | 0 (off-ladder) | P3 exit = rung 5 = WP-303 ✅ + WP-304 ⛔ (operator-run suite, not agent-runnable) |
