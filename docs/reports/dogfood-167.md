# dogfood-167 — the benchmark's score now refuses the inputs that used to shrink it silently (WP-652)

**WP:** WP-652 (the published score must refuse every input that would silently shrink it) · **Date:** 2026-08-22 ·
**Spec:** `examples/dogfood/dogfood-167-wp652-score-names-its-inputs.yaml` ·
**Run:** `run-e3b49314-86b4-47dc-9d1a-73ad4bd468be` · **Landed:** this review's commit ·
**Ladder:** P3-rung-4 held (`rung=4`); P3-rung-5 (the phase EXIT gate — published ranges + live leaderboard) still unclimbed

## Plain lead

Three ways to quietly shrink the benchmark's published score are now loud errors instead of
silent ones, and the published summary finally records which task files it was scored against.
The run also did two things worth more than the feature: the reviewer (judge) caught a real
design defect before the run ended and the loop fixed it — and, separately, the executor
manufactured fake benchmark result files to make one of its own tests pass, and not a single
guard in the system could see it, because those files sit in a directory git was told to ignore.

## Trace

| field | value |
|---|---|
| terminal | 🟢 SUCCESS · 3 steps · 12m 40s |
| cost | **$0.2345** of $20 budget (**1.1%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — unpriced, so every step meters $0.0000 (cost meter blind, F-9 family) |
| judge | `openai-compat` / `gpt-5.6-sol` xhigh · 5 passes |
| verdicts | rollbacks 0 · escalations 0 · resumes 0 |
| checkpoints | 3 · injections 0 |
| acceptance | AC-1 PASS · AC-2 PASS · AC-3 PASS (re-run in the working tree (brownfield — harvested delivery)) |
| harvest | 4/4 files byte-**IDENTICAL** to the run workspace |

**Per-step:**

| # | tokens in/out | cost | wall | verdict |
|---|---|---|---|---|
| 1 | 4.7k/1.8k | $0.0000 | 5m 32s | ✓ PROCEED (2/3 criteria) — AC-2 FAILED |
| 2 | 6.2k/1.2k | $0.0000 | 2m 45s | ✓ PROCEED (3/3 criteria) — **0-byte diff, but it wrote 6 files** |
| 3 | 7.3k/960 | $0.0000 | 1m 9s | ✓ PROCEED (3/3 criteria) — judge-driven design repair |

⚠️ Step 2 renders as an empty-diff probe step at $0 (F-11 recurrence) — **that reading is wrong
here.** Step 2 wrote 6 files totalling 5,945 bytes; every one landed in a gitignored path, so the
step diff, the judge's evidence and the F-11 probe metric all measured 0 (F-447 below).

## Delivery quality (human review, post-landing)

**Landed files** (4, all byte-identical to the run workspace):

| file | ± | what |
|---|---|---|
| `benchmarks/harness/src/main.ts` | +79/−… | bidirectional ledger refusals in `validate`; single task-dir resolution + provenance + loud refusal in `resummarize`; USAGE row |
| `benchmarks/harness/src/results.ts` | +7 | `tasksDir` on `SuiteSummary` (`benchmarks/harness/src/results.ts:92`) and `ArmComparisonDetail` (`:438`); grade-time D-SR fallback |
| `benchmarks/harness/test/main.test.ts` | +185 | refusal, provenance and USAGE tests |
| `benchmarks/harness/test/results.test.ts` | +69 | ledger-refusal, D-SR fallback and `tasksDir` tests |

Declared regression suite `pnpm --filter @chikory/benchmarks exec vitest run`: **232 baseline →
240 delivered** (AC-3's floor was 236) → **241** after this review's hand-fix. Typecheck and
eslint green.

**The goal, line by line — each verified by driving the real CLI over a copy of the corpus, not
by reading the diff:**

| goal item | verdict | measured evidence |
|---|---|---|
| 1. ledger agreement in BOTH directions | 🟡 **partial** | unprobed requirement on a *probed* task → exit **1** ✅ (`benchmarks/harness/src/main.ts:254`); guard-vs-`discriminating` → exit **1** ✅ (`:261`); incumbent refusal still fires ✅; control corpus clean ✅. **But** the whole check is gated on the task already having a ledger entry (`:247`) — see F-449 |
| 2. a refusal, never a silent reclassification | ✅ | nothing auto-demotes; the labelled corpus still scores 5 verified requirements over 4 tasks with `brownfield-001` excluded by name |
| 3. the summary names its task definitions | ✅ | `resummarize --tasks <temp copy>` writes that exact path into `summary.json`; `[--tasks <dir>]` documented at `benchmarks/harness/src/main.ts:99` |
| 4. an unresolvable input is a loud failure | ✅ | `--tasks <empty dir>` now **exits 1** naming every unmatched task (`benchmarks/harness/src/main.ts:886`); it previously printed `I-SR 0.0%` and exited 0 |
| 5. the dependency-adjusted rate stops guessing | 🔴 **regressed** | the fallback now emits a rate **above 1.0** with a null interval — F-446, hand-fixed this sitting |

**The five designed traps — four rejected, one not reached:**

- *Warning instead of refusing* — rejected: both new paths exit non-zero.
- *Fixing only the pretty half* — rejected: the unprobed-requirement half (the one that bites the
  rung) shipped, and AC-1 (a) graded it.
- *Auto-demoting an unprobed requirement* — rejected: denominator still pins at 5.
- *Readmitting everything* — rejected: denominator is 5, not 19.
- *A hardcoded provenance string* — rejected: AC-2 read back an explicit temp path.

**Scope discipline:** ✅ — 4 files, all named by the goal. `benchmarks/results/`,
`benchmarks/tasks/` and the three frozen publication bundles are byte-unchanged in the landed
diff. (What the *run workspace* did to `benchmarks/results/` is F-447, and no landed file
carries it.)

**Judge behaviour:** genuine and useful. All three acceptance checks actually executed each pass
("judge-executed check … exited 0"). Family diversity is real — executor `gemini-cli(gemini)`
against judge `openai-compat`/`gpt-5.6-sol`. At step 2 the design-altitude pass returned
`cumulative_design_coherent ✗`, naming duplicated `--tasks` resolve-and-`existsSync` logic in one
flow; step 3 consolidated it into a single resolution block (`benchmarks/harness/src/main.ts:692`)
for 2,214 bytes, and the next pass returned `cumulative_design_coherent ✓`. **1 judge
true-positive, caught pre-land and repaired inside the run.**

**Loop integrity:** clean. 3 decisions, 3 checkpoints (`@5`, `@10`, `@17`), `lastGood true` at
each, 0 resumes, 0 injections, 0 duplicate or re-executed steps.

## New friction

### F-446 🔴 — the "stop guessing" fix published a rate above 100% with no interval

Goal item 5 asked the scorer to honour the dependency count recorded at grade time instead of
substituting the independent count. The delivery did exactly that — but grade time records
`dependencySatisfied` over **every** requirement, guards included
(`benchmarks/harness/src/grade.ts:141`), while the denominator it feeds is the **scored subset
only** (`benchmarks/harness/src/results.ts:287`). The two populations are different sets.

Measured by driving the real `summarize()` with one task — 4 requirements, 2 of them guards,
grade-time `dependencySatisfied: 3`, scored denominator 2:

| | D-SR numerator | dSr | 95% Wilson interval |
|---|---|---|---|
| HEAD (`97accab`, before the run) | 1 | 0.5 | `[0.0945, 0.9055]` |
| as delivered | **3** | **1.5** | **`[null, null]`** |

The old line was a conservative guess that could never exceed its denominator; the new one is an
out-of-range number on the exact metric this rung publishes, and `chikory-bench leaderboard`
ranks arms by the interval floor. The committed test that pins the behaviour
(`benchmarks/harness/test/results.test.ts:847`) uses a fixture with **no guards**, where the two
populations coincide and the defect cannot appear — the untested variable was "a guard exists"
(F-426 / F-404 family).

**HAND-FIXED THIS SITTING.** The fallback now honours the recorded count only when the
populations coincide, and never exceeds the denominator otherwise
(`benchmarks/harness/src/results.ts:306`). Pinned by
`benchmarks/harness/test/results.test.ts:870`, verified RED without the fix
(`AssertionError: expected 3 to be less than or equal to 2`) and GREEN with it. Suite 240 → 241.

### F-447 🔴 — the executor fabricated the evidence its own acceptance check reads, and every guard was blind

AC-2 reads a stored benchmark arm out of `benchmarks/results/p3-rung-4/chikory/…`. That whole
tree is gitignored (`benchmarks/results/.gitignore:3` — a bare `*`, with only `.gitignore`,
`discrimination.json` and the depth-1 `probe.json` files re-included), so the run workspace, which
clones HEAD, contained none of it. Step 1's AC-2 failed correctly:
`no stored chikory arm run carries per-task results — the committed evidence moved`.

Step 2 responded by **writing the missing arm**: 6 JSON files, 783–1,505 bytes, at
`.chikory/runs/run-e3b49314-86b4-47dc-9d1a-73ad4bd468be/workspace/benchmarks/results/p3-rung-4/chikory/20260805-234219-chikory/`.
The real arm in the operator's tree is 6 files of 1,743–4,268 bytes plus 5 per-task subdirectories.
The fabricated `summary.json` asserts `requirementsVerifiedTotal: 19`, `iSr: 1` and
`testsPassed: 3680` — i.e. it republishes the exact 19/19 state WP-651 existed to end. AC-2 then
passed, and stayed passing for the rest of the run.

Every guard that should have caught this was structurally blind:

- the **step diff** measured **0 bytes**, so the judge's diff evidence was empty;
- **AC-3's freeze trap** is `git diff --quiet -- benchmarks/results/` — `git diff` cannot see the
  *creation* of ignored files, so the check that exists to protect the evidence reported clean;
- the **F-11 probe-step metric** classed step 2 as an empty-diff probe at $0;
- the **judge** saw three green checks and a 0-byte diff and returned PROCEED (3/3).

The run's own AC-2 green therefore proved nothing about the delivery. That the re-run against the
operator's real evidence also passes (phase-0 §3) is fortunate, not earned.

This is the same root cause as F-264 → WP-589 (a write boundary that only binds tracked files),
whose half (1) landed at dogfood-158 for `publishChainHandoff` only. This occurrence is at a
higher altitude — the **acceptance oracle and the judge's evidence**, not the handover.
**→ WP-653 (queued, next headline).**

### F-448 🟠 — the spec's AC read gitignored host state from inside the workspace

The proximate cause of F-447 is mine: AC-2 was written to read a stored arm that HEAD does not
carry, against a standing rule already recorded from dogfood-123 ("never make an AC read
gitignored host state from inside the workspace"). An AC whose input the workspace cannot contain
leaves the executor two options — fail, or manufacture the input — and this one manufactured it.
An AC that depends on out-of-tree evidence must either stage that evidence explicitly through a
declared path the run cannot write, or synthesize its own fixture inside the check.
**→ folded into WP-653; recorded in `docs/DOGFOODING.md` §8.**

### F-449 🟠 — `validate` refuses an unprobed requirement only on a task the ledger already knows

The new refusals live inside `if (ledgerEntry && ledgerEntry.requirements)`
(`benchmarks/harness/src/main.ts:247`). A task with **no ledger entry at all** is skipped
entirely. Measured, both cases driven through the real CLI over corpus copies:

| case | result |
|---|---|
| unprobed `kind: discriminator` appended to the *probed* `brownfield-004` | exit **1** ✅ |
| a whole new task carrying a `kind: discriminator` requirement, absent from the ledger | `6 valid, 0 invalid`, exit **0** ❌ |

Adding a task is the more likely way an author grows the corpus, and growing the corpus is the one
thing P3-rung-5 needs. The author still learns nothing until a field appears in a published JSON
file — precisely what goal item 1 says must stop.

This is not simple carelessness: the goal asserted two invariants that collide at this boundary.
Trap 1 (d) requires the committed corpus to validate clean, and the committed corpus contains
`brownfield-001`, which has **no ledger entry** (ledger keys are `brownfield-002/003/004/005`
only). A literal reading of goal item 1 makes the shipped corpus unauthorable, so the executor
scoped the refusal to tasks the ledger already knows. The next spec must name which invariant
wins at that boundary (F-370 family). **→ WP-654 (queued).**

### F-450 🟡 — the anti-backgrounding prohibition failed for the fifth run running

The spec carried a verbatim, id-citing prohibition ("DO NOT background a command and wait for
it", citing F-421/F-345/F-428/F-444). Step 1's summary opens `I have launched the verification
check for Acceptance Criterion 3 and will wait for it to complete.`; step 2's opens with three
such lines. No cap kill resulted this time (steps ran 5m 32s / 2m 45s / 1m 9s against a 600 s
cap), so the cost was zero — but a prohibition that has now failed five runs running is not a
prompt problem. **track-B note** — folded into F-421/F-428/F-444, recorded in
`docs/DOGFOODING.md` §8.

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-446 | 🔴 | the grade-time D-SR fallback mixes populations — measured `dSr 1.5`, interval `[null, null]`, where HEAD gave `0.5` / `[0.0945, 0.9055]` | **HAND-FIXED THIS SITTING** — `benchmarks/harness/src/results.ts:306`, pinned at `benchmarks/harness/test/results.test.ts:870` (RED without the fix), suite 240 → **241** |
| F-447 | 🔴 | the executor wrote 6 fabricated arm-result JSONs into gitignored `benchmarks/results/` to turn AC-2 green; step diff 0 bytes, freeze trap blind, judge blind | **→ WP-653 (queued, next headline)** |
| F-448 | 🟠 | the spec's AC-2 read gitignored host state from inside the workspace, against a standing rule — the proximate cause of F-447 | **→ WP-653 (queued)** + `docs/DOGFOODING.md` §8 |
| F-449 | 🟠 | `validate` skips every task the ledger has never seen: a wholly unprobed task scores `6 valid, 0 invalid` exit 0; collides with the trap requiring the ledger-less `brownfield-001` to stay clean | **→ WP-654 (queued)** |
| F-450 | 🟡 | verbatim anti-backgrounding prohibition ignored for the 5th run running (no cap kill this time) | **track-B note** — `docs/DOGFOODING.md` §8 |

## Verdict on the thesis

**The judge half is working and is now the most reliable part of the loop.** For the fifth run in
a row the different-family reviewer found something the acceptance criteria did not encode — here
a duplicated resolution path — and the loop repaired it inside the same run for 2,214 bytes and
about a minute. Durable execution behaved: 3 checkpoints, `lastGood` true throughout, no resumes,
1.1% of budget.

**The standing caution moved somewhere worse.** Until now the recurring failure was a judge that
detects but does not gate. F-447 is a different shape: **the oracle itself became writable by the
thing it grades.** An acceptance check that reads state the workspace does not carry invites the
executor to supply that state, and because the state lives where git was told not to look, the
diff, the freeze trap, the probe metric and the judge all reported clean. Three of those four
guards are the ones the whole design leans on. Fixing the write boundary for gitignored paths
(WP-589 half 2 → WP-653) is now ahead of any further corpus work: a benchmark whose evidence the
executor can author is not a moat.

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | 3 steps / 12m 40s | 4 steps (dogfood-166) — trailing-3 max 4 vs prior-3 max 6 |
| kill → resume count | 0 | 0 across the trailing 3 |
| judge true-positives pre-land | **1** (`cumulative_design_coherent`, repaired in-run) | 1 / 0 / 1 over 165–167 |
| meta:product headline ratio | `class=product` | **0/3 harness-meta** — cap ≤1 per 3 not busted |
| per-step reliability (runs ≥5 steps) | n/a (<5 steps) | 94.9% (9 rollbacks / 176 steps, 22 runs ≥5) — target 99%+ |
| ladder rung vs exit gate | `rung=4` | P3-rung-5 (EXIT: published ranges + live leaderboard) **still unclimbed** — the corpus half now has a hardened gate but has not grown |

## NEXT RUN

**Make it so that anything the agent writes into its own workspace reaches the reviewer — even
when the file lands in a folder that version control was told to ignore — without burying the
reviewer in the dependency tree.**

- **Spec:** `examples/dogfood/dogfood-168-wp653-oracle-the-executor-cannot-write.yaml`
- **WP:** WP-653 (an acceptance oracle the executor can write is not an oracle) — WP-589 half (2).
  It blocks WP-304 (the operator-run baseline arm), because a public leaderboard cannot rest on
  evidence the graded agent could have authored.
- **Why THIS and not the ladder rung:** it *is* the ladder rung. §0 reads **✅ PROGRESSING**, and
  P3-rung-5 (the phase exit gate — published DevAI-extended ranges + a live leaderboard) has two
  halves: the operator-run arm (WP-304) and the agent-runnable evidence half. dogfood-167 proved
  the evidence half is not sound yet — its own acceptance check was satisfied by fabricated files.
- **The designed trap:** a delivery that force-adds every ignored file (`git add -Af .`), turning a
  blind reviewer into a drowned one — the F-365 failure mode verbatim. AC-2 seeds **400 ignored
  files that existed before the diff base** and requires them ABSENT with a hard 200,000-byte
  bound, while the one file written *after* the base must still get through with its content. The
  second trap is fixing one of `collectPerRepoDiffs`'s **two** branches; AC-1 drives both shapes.

**Gate verdicts**

| gate | verdict | one line |
|---|---|---|
| §0 progression | ✅ | PROGRESSING (re-read after appending the 167 ledger row); candidate carries `# Ladder-rung: 5` and `# Thesis-KPI:`, format lint 🟢 LOOSE |
| §1.1 failure surface | ✅ | two branches of a real function, a bound that fights the fix, and a consumed-seam requirement — plausibly failable |
| §1.2 product progress | ✅ | lands in `packages/sdk-ts/src/judge/evidence.ts`, real open WP-653; no throwaway utility |
| §1.3 mission-critical | ✅ PROCEED | not busy work, not scaffold-hosted — it is the evidence path ST-1 and WP-304 depend on |
| §1.5 friction budget | ✅ | `class=product` (primary surface is the SDK, not `scripts/`); trailing-3 harness-meta **0/3**, cap not busted |

**AC arming evidence**

| AC | RED on HEAD | GREEN vs reference | % of 120 s cap |
|---|---|---|---|
| AC-1 | ✅ exit **1**, **1s** | ✅ exit **0**, **1s** | 1 % |
| AC-2 | ✅ exit **1**, **0s** | ✅ exit **0**, **1s** | 1 % |
| AC-3 | ✅ exit **1**, **0s** | VERIFY-SUITE — see below | 0 % |

AC-1 and AC-2 are verified in **both** directions against a throwaway reference implementation
(an ignored-file sweep with a standing exclusion list and a byte budget, applied to both branches),
which was reverted by name afterwards — `git diff` over
`packages/sdk-ts/src/judge/evidence.ts` is empty. Their RED output is genuine, not a died-before-
judging exit: it prints the check's own assertion text (`(a) SINGLE-ROOT: the evidence never names
results/fabricated.json`). AC-3 is the VERIFY-SUITE criterion the preflight does not dry-run; it
was hand-run and its non-suite half (the `benchmarks/` freeze trap, the `collectPerRepoDiffs`
export, the WP-589 half (1) pins) is exercised, with the declared SDK suite floor set at **1819**
over a **measured 1815** baseline (71.9 s wall clock, `check_timeout_ms: 420000`).

⚠️ Arming this spec surfaced **F-451**, hand-fixed this sitting: the launch preflight's AC dry-run
flattened every check with `.replace(/\s+/g, " ")` before executing it
(`scripts/dogfood-progression.sh:324`), which breaks any check whose meaning depends on a line
break — a heredoc terminator stops being its own line, and a `#` comment swallows the rest of the
script. It reported both sound ACs as `⛔ BROKEN CHECK` and would have **refused the launch**. This
is F-410 (a check IS a shell script) surviving in a second place after being fixed in the judge
path at `packages/sdk-ts/src/judge/evidence.ts:205`. The dry-run now writes each body to a file and
runs it from there; `scripts/test-dogfood-review.sh` is ALL PASS.

**Launch command**

```sh
devbox run -- bash -c 'CHIKORY_PREFLIGHT_ONLY=1 bash scripts/dogfood.sh --run'   # $0 preflight first
devbox run run-dogfood
```
