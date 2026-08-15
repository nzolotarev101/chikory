# dogfood-143 — a grading check can no longer be failed by the check running next to it (WP-623)

**WP:** WP-623 (a judge-executed acceptance check must be isolated from its siblings) · **Date:** 2026-08-15 ·
**Spec:** `examples/dogfood/dogfood-143-wp623-check-isolation.yaml` ·
**Run:** `run-2a418823-1489-451f-a292-09ed8fcaa710` · **Landed:** this review's commit ·
**Ladder:** rung 0 (off-ladder — P3 rung-5's remaining half, WP-304, is operator-by-hand)

## Plain lead

The grader used to run all of a task's checks at the same time in one folder, so a check
that dropped a scratch file could fail the check compiling that same folder — that is what
killed the previous run's correct work. Checks now run one at a time and each one's mess is
swept before the next starts, delivered in a single 2m 45s step for 8.5 cents. The catch:
the fix shipped **no test**, so the very next refactor could have quietly put the bug back —
this review wrote that test and proved it fails on the old code.

## Trace

| field | value |
|---|---|
| terminal | 🟢 SUCCESS · 1 step · 5m 19s |
| cost | **$0.0851** of $20 budget (**0.4%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — keyless Antigravity OAuth, $0 wire cost **by design**; tokens are ESTIMATED from prompt/summary length, so `⚠ cost meter blind` here is expected, not F-9 |
| judge | `openai-compat/gpt-5.6-sol xhigh` · 2 passes — #1 $0.0533 / 5,934 evidence bytes / 1m 15s · #2 $0.0318 / 35,427 evidence bytes / 1m 16s |
| verdicts | rollbacks 0 · escalations 0 · resumes 0 |
| checkpoints | 1 (`run-2a418823…@5` · commit `a860876fe200` · lastGood true) · injections 0 |
| acceptance | AC-1 PASS · AC-2 PASS (re-run in the working tree — brownfield, harvested delivery) |
| harvest | 1/1 files byte-**IDENTICAL** to the run workspace |

**Per-step:**

| # | tokens in/out | cost | wall | verdict |
|---|---|---|---|---|
| 1 | 2.6k/1.6k (estimated) | $0.0000 | 2m 45s | ✓ PROCEED (2/2 criteria) |

No empty-diff probe step — **F-11 (wasted probe step) did not recur**.

## Delivery quality (human review, post-landing)

**Landed scope — one file, exactly the one the goal named:**

| file | change |
|---|---|
| `packages/sdk-ts/src/judge/evidence.ts` | 3,501 bytes · both concurrent call sites serialized, cleanup lifted into a shared closure and run after **every** check |

Both `Promise.all` batches are gone. `runCriteriaChecks` (`packages/sdk-ts/src/judge/evidence.ts:222`)
and `collectEvidence` (`:288`) now each build a `cleanup` closure (`:244`, `:333`) over the
pre-batch snapshot and drive their checks through a `for…of` (`:255`, `:345`), awaiting
`cleanup()` after each one and again in `finally`. `runCheck` itself — the per-check
`runBounded` cap, the `infraFailed` flag, the exit-code passthrough — is **untouched**, which
is what keeps honest failure honest.

**The goal, line by line:**

| goal bullet | verdict | evidence |
|---|---|---|
| a check's result does not depend on its siblings | 🟡 **partly** | true for every path git reports; **false for a gitignored path** — measured this review, see F-357 |
| honest failure preserved, own `exitCode` | 🟢 | `runCheck` unchanged; `exit 3` still reports 3 at both call sites |
| cap stays per-check, batch stays bounded | 🟢 | two 30 s checks under a 2 s cap both `infraFailed`, batch returned in 4.2 s |
| workspace left as found | 🟢 | `git status --porcelain` empty after the batch, no scratch file survives |
| said which mechanism and what it costs | 🟢 | step summary names serial + per-check cleanup and states the cost as Σtᵢ vs max(tᵢ) |
| no contract/dependency/tsconfig/spec edits | 🟢 | `CheckRun` and `AcceptanceCriterion` untouched; no `package.json`, `tsconfig`, or spec change in the diff |

**Designed traps — all five rejected:**

| trap | the wrong delivery | rejected because |
|---|---|---|
| A · appease the symptom | exclude `*.generated.*` from tsconfig, or read a "broken-looking" exit code as skip | no tsconfig change; exit codes still pass through `runCheck` verbatim |
| B · fix one call site | patch only `collectEvidence` | both `:255` and `:345` serialized |
| C · order instead of isolate | sort so the writer runs last | no sort anywhere; order-independence now pinned in both declaration orders |
| D · unbound the cap | give each check the whole batch budget, or stop killing | `checkTimeoutMs` still per-check, `infraFailed` still set |
| E · isolate then leak | a per-check copy that never syncs back, or leaves the tree dirty | cleanup after every check **and** in `finally`; tree byte-clean |

**Independent verification (not taken on the run's word):**

- Declared regression suite re-measured at the launch commit per F-342 (a spec's premise must
  be measured, not transcribed): **187 files / 1495 tests (1472 passed | 23 skipped) in 56.31 s**
  — matching the spec's stated premise exactly.
- **The suite did not grow.** 1495 tests before the run, 1495 after. The delivery changed
  judge-critical control flow and pinned none of it — F-356 below.
- The residual isolation hole was measured by hand with a two-check probe against the real
  `runCriteriaChecks`, not inferred from reading — F-357 below.

**Scope discipline:** 🟢 one file, named by the goal, byte-identical between the run workspace
and the working tree.

## New friction

Continuing the global sequence from **F-355** (dogfood-142).

### F-356 🔴 — the fix to the grading path shipped with no test

The delivery rewrote the control flow of both judge check-execution entry points and added
**zero** regression coverage. Measured, not asserted: the declared suite stood at 187 files /
1495 tests before the run and at 187 files / 1495 tests after it. The only thing that ever
proved the new behaviour was AC-1's generated test file — which AC-1 writes, runs, and then
`rmSync`s, so nothing survives in the repo. A refactor back to `Promise.all` would have landed
green, re-opening F-349 (the defect that sealed dogfood-142 FAILED), and this is the third
consecutive review in which the loop's own gate is the thing at risk.

This is the sharp edge of the "AC owns its oracle" pattern every recent headline uses: a
generate-run-delete AC proves the behaviour **at grade time and leaves no residue**. The three
runs before this one each grew the suite (140 → 1478, 141 → 1488, 142 → 1495); this one did not.

**HAND-FIXED THIS SITTING:** `packages/sdk-ts/test/judge/check-isolation.test.ts` — AC-1's
oracle ported to a permanent test, 4 cases: both call sites in both declaration orders
(`:70`, `:83`), the per-check cap and bounded batch (`:103`), and a byte-clean workspace
(`:120`). Proven in **both** directions, which is the whole point: **GREEN** on the delivery
(4/4, 10.8 s) and **RED** on `HEAD`'s pre-fix concurrent code (2/4 fail — exactly the two
isolation cases; the cap and cleanup cases correctly stay green). Suite now **188 files /
1499 tests (1476 passed | 23 skipped) in 57.19 s** — +4 tests for +0.9 s. Typecheck and
eslint clean.

### F-357 🟠 — isolation only covers what `git status` can see

The chosen mechanism snapshots the workspace with `git status --porcelain`
(`packages/sdk-ts/src/judge/hermeticity.ts:168`), which by default does not list ignored
files. A check that writes to a gitignored path is therefore **neither isolated from its
siblings nor cleaned up**. Measured this review, driving the real `runCriteriaChecks` against
a temp git repo whose `.gitignore` carries `dist/`:

```
writer   check: mkdir -p dist; printf x > dist/leak.js
observer check: test ! -e dist/leak.js
→ PROBE observer exitCode=1        (the sibling's artifact was visible)
→ PROBE leftover-on-disk=true      (and it survived the batch)
```

The goal bullet reads "one writing a transient file into the workspace, one asserting that
file is absent — must BOTH pass"; a gitignored path is in the workspace, so the goal is met
for tracked paths only. AC-1 enumerated exactly one input family — git-visible paths — which
is the F-187/F-196/F-198 lesson recurring: owning the oracle is not enough if the oracle
probes one family.

Blast radius is narrower than F-349 but real and on the same path: any AC that builds
(`dist/`), caches (`node_modules/.vite`, `.tsbuildinfo`), or writes anywhere ignored can still
condemn its sibling. The obvious fix is a trap in itself — `git status --porcelain --ignored`
would enumerate and **sha256 every file in `node_modules`** on every check
(`hermeticity.ts:166` reads and hashes the full content of each dirty entry), which is why
this wants a run and not a five-minute patch. **→ WP-625 (queued — headlines dogfood-144).**

### F-358 🟠 — the loop reasons about a telemetry field that is structurally always zero

`chikory trace` reported this step as **`0 tool calls`** while it delivered a 3,501-byte diff.
That is not a stall: the Antigravity CLI's print mode enumerates nothing, and the adapter says
so and hardcodes `toolCalls: 0` (`packages/sdk-ts/src/executors/gemini-cli.ts:79`). The
adapter is honest; its **consumers** are not aware. Checked across the last four runs — every
step of every run reports `toolCalls: 0`, including a 34,167-byte diff on
`run-5ab10621-fd38-420d-aff2-176486cf9f9a`.

Two consequences:

- `isBlindMeteredStep` requires `facts.toolCalls > 0` (`packages/sdk-ts/src/runner/killed-step-usage.ts:45`)
  and `estimateKilledStepUsage` bails on `killedToolCalls <= 0` (`:59`) and needs a basis step
  with `toolCalls > 0` (`:61`). Under the executor Chikory actually dogfoods and benchmarks
  with, **neither can ever fire** — the WP-544 blind-metered-step compensation is live only for
  adapters we never run in the loop (`claude-code.ts:98`, `codex.ts:60` do count).
- F-355 (dogfood-142) cited `toolCalls: 0` as corroborating evidence of an executor stall.
  That conjunct carries no information here, and a stall classifier written as "no diff **and**
  no tool call" would silently degrade to "no diff". **Correcting the record now, before the
  fix is built on it.**

**→ WP-626 (queued, track-B):** either derive a tool-call count the adapter can honestly
report, or make the unobservable case explicit (`toolCalls: null`) so a consumer must handle
"unknown" rather than reading it as "none".

### Recurrences (no new F-number)

- **F-306 🟡 (WP-606, open) — executor summary is raw stdout.** Recurred: the step summary
  opens with four lines of narration before any content — *"I have launched the AC-1 validation
  check in the background… Standing by for completion. / The task is running its vitest suite.
  Waiting for completion notification. / Waiting for task completion. / Waiting for AC-1 test
  execution to complete."* — and that text rides into the pacing estimate and the next step's
  prompt. Same defect, unchanged.
- **F-355 🟠 (WP-608 track-B) — executor passivity, "launched it and waiting".** The textual
  pattern recurred verbatim in this run's summary, but harmlessly: the step delivered its diff
  and sealed in 2m 45s. Evidence that the pattern alone is not the signal — see F-358 for why
  the `toolCalls` half of the proposed test is inert.

### Plan correction — WP-624's premise was largely consumed by this run

**WP-624** (arming must rehearse an AC the way the judge will run it — concurrently, and
compiled; F-350/F-351) was queued on the premise that *"arming runs each check in turn; the
judge does not."* As of this delivery the judge runs them **serially, with cleanup between**,
which is exactly how `scripts/dogfood-arm.sh` already rehearses them. The concurrency half of
F-350 is closed by WP-623, not by WP-624. What survives is F-351 alone (nothing typechecks the
TypeScript an AC generates) — now narrower still, since a generated file can no longer break a
sibling, only its own check. Re-measured before spending a run on it, per the standing rule.
**WP-624 re-scoped in `plan.md`, not headlined.**

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-356 | 🔴 | the grading-path fix shipped with no test; suite 1495 → 1495, proof lived only in a deleted generated file | **HAND-FIXED THIS SITTING** — `packages/sdk-ts/test/judge/check-isolation.test.ts:70`, 4 tests, GREEN on the delivery / RED (2/4) on pre-fix HEAD; suite 188 files / 1499 tests green |
| F-357 | 🟠 | isolation is scoped to `git status --porcelain`, so a gitignored write still leaks to a sibling and survives cleanup | **→ WP-625 (queued)** — headlines dogfood-144 |
| F-358 | 🟠 | `toolCalls` is hardcoded 0 for the production executor, so the blind-metered-step compensation can never fire and F-355's evidence half is inert | **→ WP-626 (queued, track-B)** |

## Verdict on the thesis

🟢 **The judge-gate repair worked, and the loop paid 8.5 cents to learn it.** WP-623 was
written at the previous review as a direct consequence of that run's death; one step, one
file, all five designed traps rejected, harvest byte-identical, both ACs green on independent
re-run. That is the self-correcting loop doing exactly what it claims — a defect measured in
run *n* is specified, delivered and verified in run *n+1*.

🟡 **The standing caution is unchanged and now has a third data point: a green seal is not
evidence the work is complete.** The judge passed a delivery that (a) added no regression test
for the control flow it rewrote, and (b) satisfied its ACs while meeting its goal only for one
input family. Neither is a judge malfunction — the rubric had nothing to check against,
because the *spec* asked for behaviour and not for its guard. Two lessons for every spec
written from here:

- An AC that generates and deletes its own test proves the behaviour **at grade time only**.
  When the WP changes durable behaviour, the spec must also require a durable test — otherwise
  the review has to write it, as this one did.
- Enumerate the input families in the AC, including the one the mechanism will not see. F-357
  was one `.gitignore` line away from being caught before the run.

Cost discipline stays excellent: 0.4% of budget, no rollback, no resume, no wasted probe step.

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | 1 step / 5m 19s | 4 steps (dogfood-142) over trailing 3 |
| kill → resume count | 0 | 0 over trailing 3 |
| judge true-positives pre-land | 0 (nothing to catch — the delivery was clean at grade time) | 2 (142) · 0 (141) · 1 (140) |
| meta:product headline ratio | product | **0:3** harness-meta over trailing 3 — cap (≤1 per 3) 🟢 not busted |
| per-step reliability (runs ≥5 steps) | n/a (<5 steps) | **94.7%** — 9 rollbacks over 170 steps, 21 runs ≥5 steps (target 99%+) |
| ladder rung vs exit gate | rung 0 (off-ladder) | P3 exit gate = rung 5 (WP-303 ✅ + WP-304 operator-by-hand); highest reached = rung 4 |

## NEXT RUN

**Make a grading check safe from the mess a sibling check leaves in places version control
does not track — without the fix costing a full hash of every dependency on disk.**

- **Spec:** `examples/dogfood/dogfood-144-wp625-ignored-path-isolation.yaml`
- **WP:** WP-625 (check isolation must cover writes git does not track — F-357)
- **Why this and not the ladder rung:** §0 reads ✅ PROGRESSING, so the default candidate is
  the next P3 ladder rung (WP-530 moat ladder, `plan.md` §7). Rung 5 is the exit gate =
  WP-303 + WP-304; WP-303 closed in dogfood-139 and **WP-304 cannot headline a dogfood run** —
  it needs the OpenHands arm plus a quota-bound multi-hour corpus suite the operator drives by
  hand (unchanged since dogfood-140). Among runnable candidates WP-625 wins: it completes the
  goal the run just reviewed only half-met, on the judge path that has now condemned correct
  work in two of the last four runs.
- **The designed trap:** `git status --porcelain --ignored`. It is the one-line change that
  makes the observer pass — and it enumerates and sha256-hashes every file under
  `node_modules`, blowing the per-check cap on any real repo. Its evil twin is `git clean -xfd`
  between checks, which "isolates" by deleting the dependency tree. The ACs pin a wall-clock
  bound on a batch in a workspace with a large ignored tree, and assert that a **pre-existing**
  ignored file survives the batch untouched.
- **Gate verdicts:** §0 ✅ PROGRESSING (rung not runnable — reason recorded above) · §1.1 ✅
  plausibly failable, two named wrong fixes both pass the naive check · §1.2 ✅ lands in
  `packages/sdk-ts/src/judge/` on the Agent-as-a-Judge pillar, no scaffolding · §1.3 ✅ PROCEED,
  neither busy work nor scaffold-hosted · §1.5 ✅ `class=product`, trailing-3 harness-meta 0/3.
- **AC arming evidence** — both ACs are VERIFY-SUITE (they shell `pnpm exec vitest` / `tsc`), so
  the launch preflight does **not** dry-run either; `dogfood-arm.sh` ran both, in both
  directions, timed against the 120 s judge cap:

  | AC | RED on HEAD | GREEN vs reference | % of 120 s cap |
  |---|---|---|---|
  | AC-1 | ✅ exit **1**, **9s** | ✅ exit 0, **9s** | 8 % |
  | AC-2 | ✅ exit **1**, **7s** | ✅ exit 0, **20s** | 17 % |

  Worst case **20 s = 17% of the cap**. Both REDs were read, not just counted. AC-1: 3 of its 4
  cases fail on `expected 1 to be +0` — the observer's own exit code — while the WP-623 regression
  case correctly passes, so the check judges rather than dies. AC-2: typecheck passes and eslint
  is clean, then it stops at the **durable-coverage floor** — no committed judge test constructs a
  `.gitignore` today, which is F-356 turned into a gate so the next delivery cannot repeat it.

  The throwaway reference also measured trap A for real: `git status --porcelain --ignored` **and**
  `--ignored=matching` both collapse an ignored directory to a single `!! dist/` entry, so neither
  can even see the leaked file — a naive fix does not merely cost too much, it does not work. Only
  `git ls-files --others --ignored --exclude-standard` enumerates per file, and that is the call
  whose cost the AC bounds. Reference reverted by name from a pre-edit copy (never `--discard`).

```sh
devbox run -- bash -c 'CHIKORY_PREFLIGHT_ONLY=1 bash scripts/dogfood.sh --run'   # $0 preflight first
devbox run run-dogfood
```
