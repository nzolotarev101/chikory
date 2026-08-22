# dogfood-166 — the benchmark's score stopped being zero-over-zero (WP-651)

**WP:** WP-651 (a requirement that cannot discriminate must be required, not scored) · **Date:** 2026-08-22 ·
**Spec:** `examples/dogfood/dogfood-166-wp651-guards-do-not-score.yaml` ·
**Run:** `run-89bbcd8d-8ddd-4600-a450-ad1720174bbc` · **Landed:** this review's commit ·
**Ladder:** P3-rung-5 (the phase EXIT gate — published DevAI-extended ranges + a live leaderboard) — **still NOT climbed**; this run finished the *scoring-rule* half, the published bundle is unchanged. Ledger `rung=4`.

## Plain lead

The benchmark used to throw away every task before scoring it, so the published
number was literally "0 satisfied out of 0". This run taught it the difference
between a check that guards the build ("do the dependencies install?") and a
check that actually separates a good delivery from a bad one — guards still have
to pass, but they no longer count toward the score. The rate now computes over
**5 real requirements across 4 tasks** instead of nothing.

The run's own acceptance checks went green on a delivery that had quietly deleted
an unrelated CLI safety check; **the judge caught it, rolled the whole step back,
and the executor rebuilt the work correctly**. Three holes remain in the new rule,
and all three are on the direct path of the next thing anyone will do to this
corpus — add requirements to it.

## Trace

| field | value |
|---|---|
| terminal | 🟢 SUCCESS · 4 steps · 35m 26s |
| cost | **$0.3227** of $20 budget (**1.6%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — ⚠️ **cost meter blind**: 23.3k metered tokens priced at $0.00 (standing F-9/F-167) |
| judge | `openai-compat` (`gpt-5.6-sol` xhigh) · 6 passes · $0.3227 |
| verdicts | rollbacks **1** (a true positive) · escalations 0 · resumes 0 |
| checkpoints | 4 · injections 0 |
| acceptance | AC-1 PASS · AC-2 PASS · AC-3 PASS (re-run in the working tree, harvested delivery) |
| harvest | 13/13 files byte-**IDENTICAL** to the run workspace |

**Per-step:**

| # | tokens in/out | cost | wall | verdict |
|---|---|---|---|---|
| 1 | 4.5k/0 | $0.0000 | 12m 4s | 🔴 step **FAILED** — `step exceeded maxSeconds=600; killed after 723.7s (1.21× cap)`; 0-byte diff; judge ✓ PROCEED (0/3 criteria) |
| 2 | 4.9k/2.0k | $0.0000 | 7m 36s | ⟲ **ROLLBACK → @base** — 3/3 ACs green, `no_unrelated_deletions` + `scope_matches_instruction` ✗ |
| 3 | 6.3k/1.3k | $0.0000 | 8m 32s | ✓ PROCEED (3/3 criteria) — the delivery that landed |
| 4 | 7.6k/1.5k | $0.0000 | 2m 2s | ✓ PROCEED (3/3 criteria) — 0-byte adjudication step |

⚠️ Empty-diff probe step 4 — $0 (F-11 recurrence). Step 1 is a *second* 0-byte
step: 12m 4s = **34.1%** of the run's wall clock and $0.0442 = **13.7%** of run
cost for zero output tokens.

## Delivery quality (human review, post-landing)

**Landed scope — 13 files, +616/−21, all byte-IDENTICAL to the run workspace.**

| file | what |
|---|---|
| `benchmarks/harness/src/task.ts` | `RequirementKind = "guard" \| "discriminator" \| "scored"` (`:23`); optional `kind` on the authored YAML schema; an all-guard task is an authoring *issue* (`:229`) |
| `benchmarks/harness/src/grade.ts` | `kind` rides on every `RequirementGrade`; `dependencySatisfiedIds` exported (`:103`) |
| `benchmarks/harness/src/results.ts` | per-requirement ledger agreement replaces the task-level verdict; guards excluded from both I-SR terms; a failed guard zeroes the task's scored satisfaction |
| `benchmarks/harness/src/main.ts` | `validate --discrimination-ledger` + `MISLABEL` refusal (`:252`); `resummarize` loads task definitions to attach kinds (`:846`) |
| `benchmarks/harness/src/suite.ts` | live suite passes `opts.tasks` into `summarize` (`:210`) |
| `benchmarks/tasks/*.yaml` (4) | `kind:` added to 16 requirements — **11 guard, 5 discriminator**, exactly matching the committed probe ledger |
| `benchmarks/tasks/AUTHORING.md` | the `kind` field, the default, the mandatory-but-unscored rule, the ledger-agreement rule |
| `benchmarks/harness/test/*.ts` (3) | **+11 tests**, suite 221 → **232** |

**The goal, line by line — verified independently, not taken from the run's summary.**

| goal clause | independently measured | 🟢/🔴 |
|---|---|---|
| 1. explicit kind, default unchanged | `kind` optional in the zod schema; omitted → `"discriminator"` (`task.ts:229`+). Re-ran `resummarize` on an untouched arm: old behaviour preserved | 🟢 |
| 2. a guard is REQUIRED but NOT SCORED | denominator over the labelled corpus = **5**, guards absent from it; flipping `brownfield-004` R1 to failed zeroes that task's scored satisfaction | 🟢 |
| 3. label must agree with the evidence | **half true.** The scored→`non-discriminating` direction refuses (`main.ts:250`). The other two directions do not — see F-441, F-442 | 🟡 |
| 4. a task with nothing to score is refused | `validate` refuses (`task.ts:230`) *and* the scorer excludes it by name (`results.ts:200`) — both halves, as asked | 🟢 |
| 5. denominator exactly 5 over 4 tasks, `brownfield-001` named | **re-measured by hand**: `4/5 verified tasks, 5/5 verified requirements satisfied (I-SR 100.0%)`, `unverifiedTasks: [{"taskId":"brownfield-001","reason":"Task brownfield-001 was never probed"}]` | 🟢 |
| trap 1 — corpus must not get smaller | all **19** requirement `id`/`description`/`check` fields byte-unchanged across 5 task files | 🟢 |
| trap 2 — stored evidence read-only | `git diff` clean on `benchmarks/results/`, `publications/p3-rung-4/`, `publications/leaderboard/` | 🟢 |
| trap 3 — unscored is not optional | `guardGrades.every(g => g.satisfied)` gates the scored count; demoting a *failing* discriminator to `guard` makes the arm score **worse**, not better — the gate genuinely defends | 🟢 |
| tests in the repo, ≥1 case the ACs do not name | 11 committed tests; `validate: positive control over benchmarks/tasks exits 0` and `resummarize: refuses when no results are found in the directory` are both un-named by the ACs | 🟢 |
| strict ESM, no `any` | no `any` in the diff (the one grep hit is prose in AUTHORING.md); `pnpm run typecheck` + `eslint src/` green | 🟢 |

**Measured, on the committed evidence, in this working tree:**

```
re-summarized suite benchmarks/tasks: 4/5 verified tasks,
  5/5 verified requirements satisfied (I-SR 100.0%)
iSrRange [56.6%, 100.0%]   (was: 0/0, I-SR 0.0%, interval [0.0%, 0.0%])
```

**The judge earned its keep — probe-confirmed.** Step 2 shipped the whole feature
with **3/3 acceptance checks green** and the judge rolled it back for a deletion
no AC looked at. The claim is true, not a hallucination: the step-2 diff artifact
`161bb5222686`, lines 144–145, is

```
-    if (taskResults.length === 0) {
-      io.err(`chikory-bench resummarize: no stored task results found in ${resolvedResults}`);
```

Step 3 rebuilt the same work *and* kept the refusal, and step 4's judge pass #6
adjudicated the standing concern against the cumulative diff rather than
re-asserting it. The refusal is now pinned by a committed test
(`benchmarks/harness/test/main.test.ts`, `resummarize: refuses when no results are
found in the directory`). **judge true-positives pre-land: 1.**

**What the rung did NOT get.** The published bundle is unchanged:
`benchmarks/publications/p3-rung-4-corrected/chikory-summary.json` still reads
`tasksVerified 0, requirementsVerifiedTotal 0, iSr 0`. The stored `p3-rung-4`
arms predate `repoRef`, so WP-600 trap G refuses them for a second, independent
reason — correctly, and the spec scoped re-running them out (that is WP-304,
operator work). **The non-zero denominator exists only for a ref-carrying arm.**
Per dogfood-124's own precedent — "a rung is satisfied only when its proof is
whole" — the ledger records `rung=4`, and P3-rung-5 stays unclimbed.

## New friction

Highest prior friction id = **F-440** (dogfood-165). This review opens **F-441…F-445**.

### F-441 🔴 — adding a scored requirement silently deletes its whole task from the published number, and `validate` says OK

The rung's stated need is **more** scored requirements. Adding one today removes
a task instead.

`isTaskDiscriminationVerified` refuses a task whose scored requirement is absent
from the probe ledger (`benchmarks/harness/src/results.ts:216`,
`Requirement ${req.id} was not probed in ledger`) — correct, and the same
stale-proof spirit as WP-595. But `validate`'s mislabel loop only inspects
requirements that are **already in** the ledger
(`benchmarks/harness/src/main.ts:250`: `ledgerReq && ledgerReq.classification === "non-discriminating"`),
so a brand-new requirement is invisible to it.

**Measured** — one unprobed `kind: discriminator` R5 appended to a copy of
`brownfield-004`:

```
$ chikory-bench validate <corpus+R5>
<corpus+R5>: 5 valid, 0 invalid          exit 0

$ chikory-bench resummarize --results <ref-stamped arm> --tasks <corpus+R5>
re-summarized suite benchmarks/tasks: 3/5 verified tasks,
  4/4 verified requirements satisfied (I-SR 100.0%)
unverified: [... {"taskId":"brownfield-004","reason":"Requirement R5 was not probed in ledger"}]
```

Denominator **5 → 4**, verified tasks **4 → 3**, and the author's only signal is a
row inside `unverifiedTasks` in a JSON file. The goal named `validate` as "where
an author finds out". It is not. → **WP-652**.

### F-442 🟠 — the label-vs-evidence check runs in one direction only

`validate` refuses a requirement declared **scored** that the ledger calls
`non-discriminating`. It is silent on the inverse: a requirement the ledger calls
**`discriminating`**, declared `kind: guard`. That is a one-line way to shrink the
denominator the whole WP exists to restore.

**Measured** — `brownfield-003` R2 (ledger: `discriminating`) relabelled `kind: guard`:

```
$ chikory-bench validate <corpus, R2 demoted>
<corpus>: 5 valid, 0 invalid             exit 0

$ chikory-bench resummarize --tasks <corpus, R2 demoted>
re-summarized suite benchmarks/tasks: 4/5 verified tasks,
  4/4 verified requirements satisfied (I-SR 100.0%)
```

I-SR is unchanged at 100.0% and the *interval floor drops* **56.6% → 51.0%** —
evidence destroyed, no warning. (The rate itself is not gameable this way: demoting
a *failing* discriminator trips the guard gate and zeroes the whole task, which is
the design working. The loss is measurement power, not honesty.) → **WP-652**.

### F-443 🟠 — the published number depends on a tasks directory it discovers silently and never records

`resummarize` now needs task definitions to attach kinds, and finds them by
guessing: `resolve("benchmarks/tasks")` **relative to the current working
directory**, else `resolve(import.meta.dirname, "../../tasks")`
(`benchmarks/harness/src/main.ts:846`–`:851`). Nothing is printed, nothing lands
in `summary.json`, and the `--tasks` escape hatch is absent from `USAGE`
(`benchmarks/harness/src/main.ts:97`).

**Measured** — same arm, same ledger, `--tasks` pointed at an empty directory:

```
re-summarized suite benchmarks/tasks: 0/5 verified tasks,
  0/0 verified requirements satisfied (I-SR 0.0%)
```

That output is byte-indistinguishable from the genuine pre-WP-651 result. A
publication pipeline must not produce two different answers from one command and
one set of evidence without naming which inputs it used.

Latent sub-part: when a task is not found, `summarize` sets
`taskScoredDepSatisfied = taskScoredSatisfied`
(`benchmarks/harness/src/results.ts:299`), discarding the `dependencySatisfied`
count recorded at grade time — D-SR silently collapses onto I-SR. Unreachable
today (a task missing from the map also fails the ledger check and is excluded
outright, as the probe above shows), but it is a guess standing in for recorded
evidence. → **WP-652**.

### F-444 🟡 — the step-time cap overran by 21%, and the verbatim prohibition failed for the 4th consecutive run

Step 1: `step exceeded maxSeconds=600; killed after 723.7s (1.21× cap)` — **123.7 s
past a cap that is supposed to bound the step**, up from `606.7s (1.01× cap)` in
dogfood-163. Zero output tokens, 0-byte diff.

The spec's goal quoted the prior failure *by id and by number* — "do NOT background
a full suite and wait for it — dogfood-163's step 1 did exactly that and was killed
at 606.7s of its 600s cap … (F-421/F-345/F-428)". It did not bind. Step 3's summary
still opens with eight consecutive `I have started X and will wait for it to
complete.` lines; it survived only because the waits happened to fit.

Cost of the failure this run: **34.1% of wall clock, 13.7% of run spend**, for
nothing. Four recurrences with an escalating prohibition is enough evidence that
the prompt channel is not the fix. → **track-B note** (folded into F-421/F-428,
recorded in `docs/DOGFOODING.md` §8); it cannot headline while the progression gate
binds the headline to the ladder rung.

### F-445 ℹ️ — the judge reports a check that DIED as a plain criterion FAIL

On step 1 all three acceptance checks exited 1 from
`code: 'ERR_MODULE_NOT_FOUND', url: '…/workspace/benchmarks/harness/node_modules/@chikory/sdk/dist/index.js'`
— the workspace SDK was not built yet. The judge rendered them as
``✗ AC-1 — judge-executed check `AC-1` exited 1`` with no distinction from a real
RED. `scripts/dogfood-arm.sh` gained exactly this died-before-judging detector
after dogfood-133; the judge path never did.

Fails safe here (a dead check reads as unsatisfied), but the operator reading a
trace cannot tell a genuine RED from a broken check. → **track-B note**.

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-441 | 🔴 | one unprobed `kind: discriminator` requirement deletes its whole task from the published denominator (5 → 4, tasks 4 → 3) while `chikory-bench validate` exits 0 "5 valid, 0 invalid" | **→ WP-652 (queued, next headline)** — measured on a corpus copy, both commands driven for real |
| F-442 | 🟠 | the ledger-agreement check runs only scored→`non-discriminating`; a ledger-`discriminating` requirement declared `guard` passes validate and drops the interval floor 56.6% → 51.0% | **→ WP-652 (queued)** — same check, the other direction |
| F-443 | 🟠 | `resummarize` guesses its tasks directory from cwd, records nothing, and returns I-SR 0.0% vs 100.0% on identical evidence; `--tasks` undocumented; D-SR fallback discards the recorded `dependencySatisfied` | **→ WP-652 (queued)** — the published number must name every input it used |
| F-444 | 🟡 | step killed 123.7 s past its 600 s cap (1.21×, up from 1.01×) with 0 output tokens; a verbatim, id-citing goal prohibition failed for the 4th run running — 34.1% of wall clock, 13.7% of spend | **track-B note** — folded into F-421/F-428, recorded in `docs/DOGFOODING.md` §8; the ⛔ STALLED gate bars it from headlining |
| F-445 | ℹ️ | a check that died (`ERR_MODULE_NOT_FOUND`) is rendered identically to a genuine RED in the judge's criteria list; `dogfood-arm.sh` has the detector, the judge does not | **track-B note** — recorded in `docs/DOGFOODING.md` §8 |

## Verdict on the thesis

**The inner-loop judge did the thing the thesis claims it does.** A structurally
different model family (`openai-compat/gpt-5.6-sol` against a `gemini-cli`
executor) read a 38,964-byte diff that had passed **3/3 acceptance checks written
specifically to be hard**, found a four-line deletion none of them covered, and
rolled the step back. The executor rebuilt the work correctly, kept the deleted
guard, pinned it with a test, and the next judge pass adjudicated the standing
concern against real evidence rather than repeating it. Total cost of that
correction: one 7m 36s step and roughly $0.08.

**Two standing cautions, both sharpened by this run.**

1. **Acceptance criteria measure the thing you aimed at; the judge is what covers
   the rest.** The ACs here were unusually good — they drove the real CLI, pinned
   the denominator at exactly 5, injected a guard failure, and re-proved the
   stale-proof guard. They still missed a deletion in the same file they were
   exercising, and they missed all three of F-441/F-442/F-443. A run that had only
   its ACs would have shipped a scoring rule with three ways to silently shrink the
   number it exists to produce.
2. **A rung is not climbed by the rule, only by the artifact.** WP-651 makes the
   right number computable. Nothing published moved: the corrected bundle still
   reads 0.0%. The remaining rung-5 work is an operator-run arm (WP-304) — and it
   should not run until adding requirements to the corpus is safe, which is exactly
   WP-652.

The 0-byte cap-killed step 1 also confirms **WP-632 holding**: the empty diff scored
its model-judged rubric rows explicitly as "not failed merely because the required
work is absent", spent **one** judge pass ($0.0442), and bought **no** repair grant —
the F-369 failure mode did not recur.

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | 4 steps / 35m 26s | trailing-3 (164/165/166): max **4** steps, up from 2 |
| kill → resume count | 0 resumes (1 step cap-kill, not a run kill) | 0 across trailing-3 |
| judge true-positives pre-land | **1** (probe-confirmed: deleted `resummarize` empty-results refusal) | 2 across trailing-3 (164: 1 · 165: 0 · 166: 1) |
| meta:product headline ratio | `class=product` | **0/3** harness-meta over trailing-3 — cap ≤1/3 intact |
| per-step reliability (runs ≥5 steps) | n/a (<5 steps) | 94.9% — 9 rollbacks over 176 steps, 22 runs ≥5 (target 99%+) |
| ladder rung vs exit gate | **rung 4** (P3-rung-5 = EXIT, still unclimbed) | rung 0 for 164/165; this run is the first on-ladder run since dogfood-124 |

## NEXT RUN

**Make it impossible to shrink the benchmark's published score by accident — adding
a requirement, mislabelling one, or pointing the scorer at the wrong task files must
each fail loudly and by name, and the published summary must say which task
definitions it was scored against.**

- **Spec:** `examples/dogfood/dogfood-167-wp652-score-names-its-inputs.yaml`
- **WP:** WP-652 (the published score must refuse every input that would silently shrink it) — the corpus half of P3-rung-5, continued.
- **Why THIS and not the ladder rung:** it **is** the ladder rung. P3-rung-5 (the phase exit gate — published DevAI-extended ranges + a live leaderboard) has two halves left: a re-run arm that records `repoRef` (**WP-304**, operator work — an LLM executor may not supervise a multi-hour quota-bound suite, dogfood-122) and a corpus that can grow without deleting itself. This is the second, and it **blocks** the first: re-running arms against a scorer where one added requirement silently removes a task would publish a number nobody can reproduce.
- **The designed trap:** the plausible-but-wrong delivery adds the *symmetric* label check — a ledger-`discriminating` requirement declared `guard` is refused (F-442, a one-line condition next to code that already exists) — and stops. It leaves F-441 untouched, because that half requires reasoning about requirements **absent** from the ledger, which the current loop never looks at. AC-1(a) drives an unprobed `kind: discriminator` R5 through the real `validate` and requires a non-zero exit naming both `brownfield-004` and `R5`; AC-1(d) keeps the real corpus validating clean so the refusals cannot be bought by refusing everything; AC-2 pins the denominator at exactly **5** so "solving" F-441 by auto-demoting the unprobed requirement to a guard fails as the same silent shrink.

**Gate verdicts**

| gate | verdict | one line |
|---|---|---|
| §0 progression | ✅ **PROGRESSING** (re-read after appending this run's ledger row — it flipped from ⛔ STALLED on the `rung 4 vs 0` axis) | default candidate = the next ladder rung, and WP-652 is exactly that rung's remaining agent-runnable work |
| §1.1 failure surface | ✅ | cross-file (`main.ts` + `results.ts` + the probe ledger), 2–6 steps, and a competent agent plausibly ships only the easy half — dogfood-166 shipped the easy half of this same contract |
| §1.2 product progress | ✅ | the landed diff is `benchmarks/harness/src/` — real product code on the benchmark pillar, hosting a new real `plan.md` §6 WP row; no scaffolding, no carve-out needed |
| §1.3 mission-critical | ✅ **PROCEED** | not busy work and not scaffold-hosted: it is the standing blocker on the P3 exit gate, and it gates operator spend on WP-304 |
| §1.5 friction budget | ✅ | `class=product` (the DevAI benchmark harness, not the dogfood harness); trailing-3 harness-meta headlines **0/3**, cap ≤1/3 intact |

**AC arming evidence** — every check re-run by `scripts/dogfood-arm.sh`, which runs
VERIFY-SUITE checks the launch preflight will not dry-run:

ARMING_TABLE_PLACEHOLDER

```sh
devbox run -- bash scripts/dogfood.sh --run
```
