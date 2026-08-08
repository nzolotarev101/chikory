# dogfood-126 — probe-verified scoring gate (WP-595)

**WP:** WP-595 (probe-verified scoring gate) · **Date:** 2026-08-08 ·
**Spec:** `examples/dogfood/dogfood-126-wp595-discrimination-gates-the-score.yaml` ·
**Run:** `run-14291f34-7144-43b3-9a82-2ef776b4d008` · **Landed:** this review's commit ·
**Ladder:** P3-rung-5 prerequisite (WP-530 moat ladder) — rung unchanged at 4

## Plain lead

A benchmark score can no longer count a test that was never shown to
distinguish a working fix from broken code — and the proof has to have been
taken at the exact commit the task was scored at, or it does not count. One
agent step delivered the whole thing correctly in under four minutes, both
acceptance checks pass, and every already-published number re-computes
unchanged. Two gaps came out of the review, both fixed on disk: the gate had no
switch an operator could actually flip, and a damaged evidence file would have
been silently thrown away instead of refused.

## Trace

| field | value |
|---|---|
| terminal | 🟢 SUCCESS · 1 step · 3m 58s |
| cost | **$0.0469** of $15.00 budget (0.3%) — judge share **100.0%** |
| executor | `gemini-cli` (gemini family) · **$0.0000 UNPRICED** on 4,304 tokens · **0 tool calls** on a 6-file delivery |
| judge | `openai-compat` / `gpt-5.6-sol xhigh` · 1 pass · $0.0469 · 38 s · 12,351 evidence bytes |
| verdicts | ✓ PROCEED (2/2 criteria, 6/6 rubric) · rollbacks 0 · escalations 0 |
| checkpoints | 1 (`@5`, commit `b8983564c1e9`) · `lastGood` true · resumes 0 · injections 0 |
| pacing | 1 event · peak window **75%** · compact 0 · park 0 |
| diff | 6 files · +149 / −22 (12,140 bytes) |
| harvest | 6/6 files byte-**IDENTICAL** to the run workspace (`git show b898356`) |

**Per-step:**

| step | tokens in/out | duration | diff bytes | verdict |
|---|---|---|---|---|
| 1 | 2.7k / 1.6k | 3m 15s | 12,140 | ✓ PROCEED (2/2 criteria, 6/6 rubric) |

**Family diversity real:** `gemini-cli` executor vs `openai-compat` judge —
structurally different families, per the core constraint.

## Delivery quality (human review, post-landing)

**What landed (the run's own diff):**

```
M benchmarks/harness/src/results.ts       (+97 / −18)   ledger types, lookup, gate, summarize
M benchmarks/harness/src/probe.ts         (+38 / −1)    --record upsert
M benchmarks/harness/src/index.ts          (+5)         public exports
M benchmarks/harness/src/suite.ts          (+5 / −1)    repoRef + ledger passthrough
M benchmarks/harness/src/main.ts           (+3 / −2)    probe --record flag + usage
M benchmarks/harness/test/results.test.ts  (+1)         fixture field
```

**Independently verified ✅** — both ACs re-run against the working tree after
harvest: **AC-1 PASS**, **AC-2 PASS**; harness suite **192 green**; full repo
suite green.

All five designed traps rejected:

| trap | what a wrong delivery would do | what landed |
|---|---|---|
| **A** stale proof | match the ledger on task id alone | `results.ts` compares `entry.baseRef` against the result's `repoRef`; mismatch → excluded, reason names the ref |
| **B** unclean verdict | count `not-discriminating` / `inconclusive` as proof | only `verdict === "discriminating"` verifies; probe still **records** the unclean verdict |
| **C** silent drop | shorten the task list | `perTask` retains every task with `discriminationVerified`; exclusions named in `unverifiedTasks` |
| **D** ungated republication | recompute a denominator downstream | `buildArmDetail` still reads `summary.requirementsVerified*` (`results.ts:417-427`) — untouched |
| **E** breaking published artifacts | change no-ledger behavior | `isTaskDiscriminationVerified` returns `{verified:true}` when the ledger is absent; AC-2 asserts the summary is field-identical to today |

**Ref semantics are sound, not accidental.** `probe` derives `baseRef` from
`task.repo.ref` (`probe.ts:84`) and `runSuite` records `repoRef` from the same
field (`suite.ts:188`), so the two sides of the comparison come from one source.
A branch-name-vs-SHA mismatch — the obvious way this gate could produce a false
stale verdict — cannot arise.

**Scope discipline ✅** — six files, all named or trivially entailed by the goal.
No task file, no `benchmarks/results/`, no `benchmarks/publications/` artifact
touched. No new dependency. `publishableRepoPath` untouched (the F-270 constraint
the spec set, asserted by AC-2 rather than assumed).

## New friction

### 🔴 F-274 — the gate binds nothing: no operator path could supply a ledger

`runSuite` gained an optional `ledger` option and `summarize` an optional sixth
parameter — and **no caller sets either**. `chikory-bench run` (the `run`
command's only `runSuite` call) constructed `runSuite({...})` with no ledger, so the only way to arm the gate was
to import the harness as a library. The rung-5 corpus probe is an operator
command-line job; a gate it cannot reach is not a gate.

This is **F-180 verbatim** (WP-537: the judge detected and did not gate), and it
is the same shape as the defect WP-595 was written to close — WP-593's
`probe.json` was written and read by nobody. The spec is the author of this one:
its contract named `probe --record` explicitly but only said "the scoring path
must read it", and the executor satisfied exactly what was written.

**Disposition — HAND-FIXED THIS SITTING.** `run --discrimination-ledger <file>`
(`main.ts:59-62` usage, `main.ts:322-338` load + refuse, `main.ts:364` passthrough);
a missing or damaged file is refused at $0 **before any task runs**. +1 CLI test
proving the flag gates a real suite end-to-end (I-SR 1 → 0, task retained,
reason `never probed`) and that both refusal paths exit 1.

### 🟠 F-275 — a damaged discrimination ledger was silently discarded

`probe --record`'s reader wrapped `JSON.parse` in `try { … } catch { ledger = {} }`
and then wrote the file back. A truncated or hand-edited ledger — the file that
holds hours of operator probe evidence — would therefore be **replaced by a
single entry**, destroying every prior verdict with no error. Corruption is the
one case where "start fresh" is the worst possible default: the scoring gate then
reads a ledger that silently proves less than it should, which fails **open** for
every task that vanished.

**Disposition — HAND-FIXED THIS SITTING.** `parseDiscriminationLedger` /
`readDiscriminationLedger` (`results.ts:118-157`) accept both persisted shapes and
**throw**, naming the file, on invalid JSON, a non-object entry, a wrong top-level
shape, or an entry with no `taskId`; `probe.ts:241-245` and the new `run` flag both
route through it. +3 tests. Harness **192 → 196 green**.

### 🟡 F-276 — `fan-in-handoff` flakes under full-suite parallel load

`packages/sdk-ts/test/chain/fan-in-handoff.test.ts > materializes both parents
after their workspaces are removed` failed once in the first full `devbox run test`
of this review (node `N-3` sealed `FAILED`/`HALT`), then passed in isolation
(4.4 s) and passed again on the next full-suite run. Test wall-clock was 344 s of
work compressed into a 48 s run — the fan-in chain is contending for CPU with the
rest of the suite and its node timeout is not load-proof. A flaky chain test is
corrosive: it teaches the operator to re-run rather than read a red suite.

**Disposition — track-B note.** Not this delivery's code, reproduced only under
load; recorded in DOGFOODING §7 so the next red is recognized rather than retried.

### ℹ️ F-268 recurrence — the executor still meters $0.00

`⚠ cost meter blind (unpriced tokens)`; the step reads `$0.0000` on 4,304 metered
tokens. Root cause unchanged: `gemini-cli` records the model as the bare alias
`gemini`, which matches no row in `packages/sdk-ts/src/pricing.ts`. Already
**→ WP-592 (queued)**; judge share reads 100% only because the executor half is
unpriced.

### ℹ️ F-265 recurrence — `0 tool calls` on a 6-file, 149-line delivery

The gemini-cli adapter reports no tool calls for work that necessarily read and
wrote six files. Already **→ WP-590 (queued)**.

## Anomaly checklist

| check | result |
|---|---|
| wasted/filler steps | none — 1 step, 12,140 diff bytes, no empty-diff probe step (F-11 did not recur) |
| cost telemetry | 🔴 executor unpriced (F-268 → WP-592); judge priced correctly; budget gate effectively inert on the executor half |
| token economics | 2.7k in / 1.6k out for a 6-file delivery — the whole spec fits in one context; no rot pressure (peak window 75%) |
| judge behavior | checks genuinely executed (both exited 0 in-workspace, both re-verified here); rubric rationales specific and accurate, including the correct statement that `results.ts` removals only replace the previous summary construction |
| family diversity | real — `gemini-cli` executor vs `openai-compat` judge |
| human ceremony | spec authored + launched + harvested by hand; 2 hand-fixes this sitting |
| loop integrity | clean — 1 checkpoint, `lastGood` true, no duplicate journal entries, no resume, workspace escape check (F-192) clean: `git status` was empty before harvest |

## KPI table (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | 1 step / 3m 58s | 4 steps (dogfood-125) over trailing 3 |
| kill→resume count | 0 | 0 over trailing 3 |
| judge true-positives pre-land | 0 | 1 over trailing 3 (dogfood-125) |
| meta:product headline ratio | product | **0:3** — cap intact (≤1 meta per 3) |
| per-step reliability (runs ≥5 steps) | n/a (1 step) | 94.5% (9 rollbacks / 164 steps, 20 runs) — target 99%+ |
| ladder rung vs exit gate | **4** | P3 exit gate = rung 5 (published separating ranges + leaderboard) |

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-274 | 🔴 | the discrimination gate had no CLI path — `runSuite`'s ledger option had no caller | **HAND-FIXED THIS SITTING** — `main.ts:59-62,322-338,364`, +1 CLI test (196 green) |
| F-275 | 🟠 | a damaged ledger was silently reset to `{}` and overwritten, destroying prior verdicts | **HAND-FIXED THIS SITTING** — `results.ts:118-157`, `probe.ts:241-245`, +3 tests (196 green) |
| F-276 | 🟡 | `fan-in-handoff` chain test flakes under full-suite parallel load | **track-B note** (DOGFOODING §7) |
| F-268 | ℹ️ | executor meters $0.00 — `gemini` is an unversioned alias absent from `pricing.ts` | recurrence → **WP-592 (queued)** |
| F-265 | ℹ️ | `0 tool calls` reported for a 6-file delivery | recurrence → **WP-590 (queued)** |

## Verdict on the thesis

The judge did its job on a delivery that was genuinely correct, and the run cost
5 cents to produce code that closes a measurement hole worth more than every
number published so far: **an unproven requirement can no longer inflate a
published interval.** That is the honest half.

The dishonest half is what the review found and the run could not: a gate with no
switch. Both WP-593 and WP-595 shipped mechanisms that were, at the moment of
sealing, unreachable — the probe wrote evidence nobody read, then the gate read
evidence nobody could supply. Two consecutive runs, the same defect class, each
sealed green because the acceptance criteria tested the mechanism in-process and
never asked *who calls this*. That is the transferable lesson: **an AC that
exercises a function through an import proves the function works and says nothing
about whether the product can reach it.** The next spec's oracle drives the real
CLI, not the module.
