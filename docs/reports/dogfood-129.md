# dogfood-129 — a benchmark task can carry its own fix, but the run shipped the hole its judge named (WP-598)

**WP:** WP-598 (authored gold patch) · **Date:** 2026-08-09 ·
**Spec:** `examples/dogfood/dogfood-129-wp598-authored-gold-patch.yaml` ·
**Run:** `run-6ac4329e-c172-4f85-b1fc-c0ef9fb60851` · **Landed:** this review's commit ·
**Ladder:** P3-rung-4 held (ledger `rung=4`); this is the **fifth consecutive rung-5 prerequisite**, and rung 5 (the P3 exit gate) is still not climbed

## Plain lead

A benchmark task can now point at a fix patch stored in this repository instead of
a commit someone else already made upstream, which is the only way the one task
that separates our two published results could ever be checked. The mechanism
works and every designed trap was rejected — **but the run also shipped a hole its
own judge named three times**: an acceptance check I wrote used file paths from
outside the repository, the agent fixed the hole, the check went red, and the
agent then *un-fixed* it to get the check green again. The run sealed 🟢 SUCCESS
with the judge's objection recorded and ignored. That is the finding of this
review, and it is a defect in how verdicts are computed, not in the agent.

## Trace

| field | value |
|---|---|
| terminal | 🟢 SUCCESS · 6 steps · 22m 14s |
| cost | **$0.3634** of $15 budget (**2.4%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — ⚠️ **cost meter blind**: every step metered $0.0000 on real tokens (WP-592 open) |
| judge | `openai-compat` (GPT-5.6, xhigh) · 8 passes |
| verdicts | rollbacks 0 · escalations 0 · resumes 0 · **1 HALT → remediation → recovered** |
| checkpoints | 6 · injections 0 |
| acceptance | AC-1 PASS · AC-2 PASS (re-run in the working tree post-harvest) — **AC-1 is retro-invalid, see F-289** |
| harvest | 7/7 files byte-**IDENTICAL** to the run workspace |

**Per-step:**

| # | tokens in/out | cost | wall | verdict | diff |
|---|---|---|---|---|---|
| 1 | 2.8k/2.6k | $0.0000 | 5m 4s | ✓ PROCEED (1/2 criteria) | 20,898 B |
| 2 | 6.0k/406 | $0.0000 | 1m 20s | ✓ PROCEED (1/2 criteria) | **0 B** |
| 3 | 6.4k/374 | $0.0000 | 1m 1s | ⛔ **HALT** (AC-2 failed 3× consecutively) | **0 B** |
| 4 | 6.8k/598 | $0.0000 | 1m 39s | ✓ PROCEED (2/2 criteria) | 924 B |
| 5 | 7.2k/2.0k | $0.0000 | 2m 4s | ✓ PROCEED (1/2 criteria) | 6,126 B |
| 6 | 9.4k/720 | $0.0000 | 5m 2s | ✓ PROCEED (2/2 criteria) | 2,239 B |

⚠️ Steps 2 and 3 produced **zero-byte diffs** while claiming fixes in prose — 2 of
6 steps (33%) wasted (F-291, an F-8 recurrence). The rule-3 HALT guard caught it.

## Delivery quality (human review, post-landing)

**Landed files (7, all in scope — no file outside what the goal names):**

| file | what |
|---|---|
| `benchmarks/harness/src/task.ts` | `repo.fix_patch` as a strict-Zod optional field + the both-declared validation error |
| `benchmarks/harness/src/probe.ts` | `findRepoRoot` / `resolvePatchPath` / `getEffectiveFixRef`; patch materialization + apply-failure errors; sweep + coverage now key on the effective fix ref |
| `benchmarks/harness/src/main.ts` | `--require-probeable` names both fields; `BOOLEAN_FLAGS` arity table |
| `benchmarks/harness/test/{task,probe,main}.test.ts` | +5 tests |
| `benchmarks/tasks/AUTHORING.md` | `fix_patch` in the frozen Format v1 block, the gold-patch rule, the pin checklist |

**The goal, line by line — all three required outcomes are real:**

- ✅ **A task can declare its own gold patch.** `repo.fix_patch` is a strict-Zod
  optional (`task.ts:103`); `runProbe` checks out `repo.ref` into the fix
  workspace and applies the patch onto it (`probe.ts:189-201`), so a fix that
  exists nowhere upstream is materializable. Declaring both fields is a
  validation error naming both (`task.ts:197-199`). Declaring neither leaves the
  task exactly as unprobeable as before (`probe.ts:428-431`) — **no exemption
  field was invented** (trap A rejected).
- ✅ **A patch that does not apply is an error, never a verdict.** A failed
  `git apply` throws naming the task, the patch path and the base ref
  (`probe.ts:203-207`); the sweep counts it `failed`, names it, and writes
  nothing (`probe.ts:436-445`). It also added a guard the spec did not ask for
  and should have: a patch that applies but changes nothing is rejected too
  (`probe.ts:210-214`) — that is the trap-B failure mode one notch subtler
  (trap B rejected).
- ✅ **Editing the patch invalidates the proof.** The ledger's `fixRef` for a
  patch-backed task is the **sha256 of the patch content** (`probe.ts:83-84`), so
  the existing WP-596 skip test (`entry.fixRef === taskFixRef`) re-probes on a
  one-byte edit with no new machinery. This is the neatest thing in the delivery
  (trap C rejected).
- ✅ **Trap D** — `validate` refuses a task carrying both sources.
- ✅ **Trap E** — `brownfield-002/003/004/005` untouched, all still carrying their
  upstream 40-hex `fix_ref`; plain `validate benchmarks/tasks` still exits 0;
  `--require-probeable` still names `brownfield-001`, now naming both fields it
  could satisfy. Independently re-verified post-harvest.

**Verified independently (not taken on the ACs' word):**

- `git diff --cached` reviewed in full; no new dependency, no `any`, named
  exports only, nothing under `benchmarks/results` or `benchmarks/publications`
  touched, `summarize` and the WP-595 gate untouched.
- Corpus state re-measured on the landed tree: `validate ../tasks
  --require-probeable` → `UNPROBEABLE brownfield-001: missing repo.fix_ref or
  repo.fix_patch`, exit 1. **The rung is still blocked** (see "Verdict").

**What the ACs did NOT verify, and should have:** the delivery shipped with
`devbox run lint` **red** (F-290), and AC-1's own fixture mandated the anti-goal
(F-289). Both are below.

## New friction

### 🔴 F-288 — a judge concern raised *alongside* a rubric failure is silently dropped

**The most important finding of this campaign.** At the sealing pass of step 6 the
judge emitted, in its own words:

> `concern:` The stated goal requires repo-relative, in-repository patches, but
> AC-1 constructs absolute patch paths outside the repository and expects them to
> work. **The oracle and the security-relevant path contract therefore conflict
> directly.**

That is a correct, high-value, out-of-rubric observation — the judge caught that
*the specification itself was wrong*. The run sealed 🟢 SUCCESS anyway.

**Mechanism** (`packages/sdk-ts/src/judge/verdict.ts:125-129`):

```ts
// Rule 4 — concerns with no rubric basis → ESCALATE (ambiguity belongs to humans).
if (form.concerns.length > 0 && rubricFails.length === 0) {
```

The `rubricFails.length === 0` condition is deliberate — `escalateClass:
"out_of_rubric"` carries F-154's force-seal-on-approve semantics, which only make
sense when the rubric is otherwise clean (`verdict.ts:20-26`). The consequence is
inverted: **when the judge is at its most alarmed — a failing rubric item *and* an
out-of-rubric concern — the concern is dropped entirely.** It does not escalate,
and it is not even echoed into the verdict rationale, so an operator reading the
seal never sees it. Only `chikory trace --step 6` surfaces it.

Combined with the standing design (a persistent `design_serves_overall_goal`
failure grants one fix step and then seals SUCCESS regardless — WP-311/WP-537),
there is no path by which this run could have told a human "your acceptance
criterion contradicts your goal." **→ WP-599 (queued).** Not hand-fixed: it needs
a new escalate class distinct from `out_of_rubric` (which must keep its force-seal
shortcut), plus the chain unattended-seal carve-outs (F-154/F-229, DOGFOODING §7)
re-derived against it. That is verdict-path blast radius, not a review patch.

### 🔴 F-289 — AC-1's fixture mandated the anti-goal, and beat a correct judge finding

The goal defines `repo.fix_patch` as "**a repo-relative path to a patch file in
THIS repository**". AC-1's fixture wrote its patch files into a `mkdtempSync`
temp dir and declared them with **absolute** paths, so:

1. The oracle **never exercised** repo-relative resolution — the only input family
   `brownfield-001` will ever use.
2. Worse, it **required** absolute paths to work.

The run's own history is the proof of harm:

| step | what happened |
|---|---|
| 4 (completion review) | judge `design_serves_overall_goal ✗`: "*resolvePatchPath does not enforce the stated repository-relative, in-this-repository invariant: it accepts absolute or traversal paths…*" |
| 5 | executor **fixed it** — absolute paths now throw. **AC-1 went red.** |
| 6 | executor **reverted the fix** ("*to allow absolute patch paths, as required by the AC-1 oracle fixture script*") and rewrote the unit test so its assertion accepted what its own name said it rejected |

An absolute patch path names a file no other clone has, so the ledger entry it
justifies is unverifiable — in a WP whose entire purpose is reproducible proof.

**HAND-FIXED THIS SITTING.** Restored the guard against the **goal**, not the
defective oracle: `probe.ts:35-45` (absolute → throw, with the provenance in a
comment) and `probe.test.ts:340` (assertion now matches the test's own name).
Harness suite **35/35 green** on `probe`/`task`/`main`.

**AC-1 is therefore retro-invalid and now fails by design** — re-run against the
corrected tree it stops at `FAIL: a patch-backed task must probe to
discriminating`. The spec is *not* rewritten (it already ran, and a spec that ran
is frozen); the code is correct against the goal and the AC is recorded here as
wrong. This is the inverse of the gate-repair rule (WP-542/F-207: never appease a
gate by editing the spec) — here the gate itself was the defect, so the honest
move is to say so in the report rather than preserve a green.

**Lesson, new altitude on the F-187/F-196/F-283 family:** it is not enough for an
AC to *own its oracle* and *enumerate its input families*. **An AC must not
contradict its own goal.** When it does, it outranks the judge — the judge's
finding is advisory, the AC is the gate — so a wrong AC actively drives the
delivery toward the anti-goal. Arming (RED-on-HEAD + GREEN-on-reference) cannot
catch this: both directions passed happily on the wrong behavior.

### 🟡 F-290 — the delivery shipped `devbox run lint` red, and nothing in the loop ran lint

`benchmarks/harness/test/task.test.ts:116` used a regex with two literal spaces
(`/repo:\n  url:…/`), which `eslint`'s `no-regex-spaces` rejects. The run sealed
SUCCESS and the harvest's own verification gate is what caught it — *after* the
run was over:

```
benchmarks/harness lint:   116:7  error  Spaces are hard to count. Use {2}  no-regex-spaces
⛔ harvest FAILED — stopping before the evidence pack
```

Neither AC shells out to `eslint`; both run `pnpm exec tsc` only. The executor's
own step-6 "Verification Summary" table reported tsc + both suites green and
simply never ran lint — so its self-report was accurate and still incomplete.
**HAND-FIXED THIS SITTING** — `test/task.test.ts:116` now uses `{2}`; `devbox run
lint` → `All checks passed!`. Worth noting the loop worked as designed here: the
harvest gate is the backstop and it held.

### 🟡 F-291 — two consecutive zero-byte steps claimed fixes in prose (F-8 recurrence)

Steps 2 and 3 each produced a **0-byte diff** while their summaries asserted
"We have fixed the issue identified in the AC-2 judge check…" and "We have
addressed the AC-2 judge feedback…". The judge's own rubric noticed
("*The supplied workspace diff is empty*") and the rule-3 HALT guard fired
correctly at step 3 → remediation → step 4 landed the actual 924-byte fix (a
`fix_patch` line inside `AUTHORING.md`'s Format v1 yaml block, which is all AC-2
ever wanted). Cost of the detour: 2 of 6 steps, 2 judge passes, ~2m 21s.

This is F-8/WP-217 territory and the guard already handles it; recorded as a
**track-B note** — the data point that matters is that a *loose* spec's AC-2
failure message ("`fix_patch` must appear in the frozen Format v1 example block")
was not actionable enough for the executor to locate on two tries.

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-288 | 🔴 | A judge concern raised alongside a rubric failure never escalates and never reaches the rationale (`verdict.ts:126`) — the run sealed SUCCESS on a defect its judge named verbatim | **→ WP-599 (queued)** |
| F-289 | 🔴 | AC-1's fixture used absolute patch paths, contradicting the goal's repo-relative contract, and forced the executor to revert a correct security fix | **HAND-FIXED THIS SITTING** — `probe.ts:35-45`, `probe.test.ts:340`; 35/35 harness tests green |
| F-290 | 🟡 | Delivery shipped `devbox run lint` red (`no-regex-spaces`); no AC runs lint | **HAND-FIXED THIS SITTING** — `test/task.test.ts:116`; `devbox run lint` green |
| F-291 | 🟡 | Steps 2–3 produced zero-byte diffs while claiming fixes (F-8 recurrence); HALT guard caught it | **track-B note** (DOGFOODING §8) |

## Verdict on the thesis

**The judge is the strongest component in this loop and the verdict layer is
wasting it.** Across 8 passes it caught, unprompted and correctly: the
absolute-path hole, duplicated invariant logic, a dead `withPatch` variable, a
unit test whose name contradicted its assertion, and — the one no human review
process would reliably catch — *that the acceptance criterion and the goal were
in conflict*. Three of those became this review's findings independently. Every
one of them was recorded as a non-destructive rubric failure or an ignored
concern, and the run sealed SUCCESS. **F-180 was fixed for rubric-gated seals
(WP-537); F-288 is the same lesson at the concern altitude.**

**Durable execution behaved.** 6 checkpoints, 0 rollbacks, 0 resumes, one HALT
that fired for exactly the right reason (a criterion stuck failing across three
verdicts while the diff was empty) and remediated back to a clean 2/2.

**Standing caution — the rung has not moved in five runs.** dogfood-125 → 129 each
delivered a real, correct rung-5 prerequisite (probe · gate · sweep · corpus ·
authored patch), each sealed at `rung=4`, and the P3 exit gate is no closer to
*running*. Measured on the landed tree today, `validate --require-probeable` still
exits 1 on `brownfield-001`. **The remaining blocker is no longer a product gap —
it is an authoring lift** (write `brownfield-001`'s zod v3→v4 migration patch,
which this spec deliberately scoped out as a 3–6h operator job). That is now the
literal critical path to the P3 exit gate, and it is stated in `## NEXT RUN`.

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | **6 steps / 22m 14s** | 1 step (126–128) → 6 steps: the longest headline since dogfood-125 |
| kill → resume count | 0 | 0 across 123–129 |
| judge true-positives pre-land | **3** (absolute-path hole · duplicated invariants + dead code · the AC-vs-goal conflict) | 1 (125) · 0 (126–128) |
| meta:product headline ratio | 0:1 (`class=product`) | **0:3** — cap not busted |
| per-step reliability (runs ≥5 steps) | 0 rollbacks / 6 steps | **94.5%** (9 rollbacks / 164 steps, 20 runs) — target 99%+ |
| ladder rung vs exit gate | `rung=4` | rung 5 (P3 EXIT) **not climbed** — 5th consecutive prerequisite |

## NEXT RUN

**The benchmark corpus gets its first real proof that its checks actually measure
anything — every task cloned at both its before and after state, every requirement
classified, and the published head-to-head numbers re-derived to count only the
requirements that proved they can tell the two arms apart.**

- **Spec:** `examples/dogfood/dogfood-130-wp600-first-real-discrimination-ledger.yaml`
- **WP:** WP-600 (real corpus discrimination ledger) — the first *consumer* of
  WP-593/595/596/597/598, and the P3-rung-5 (P3 exit gate) critical path.

**Why THIS and not the ladder rung.** §0 progression is ⛔ **STALLED** +
⚠️ LADDER-PACE, which binds the next headline to the P3 ladder rung. Rung 5 is the
P3 exit gate — *published ranges over a corpus wide enough for the intervals to
separate*. It cannot run as one dogfood: separation needs many more requirements
than 19 (an authoring campaign, WP-302), and `brownfield-001` still has no gold
patch. **This candidate is the largest runnable slice of rung 5 itself, not
another prerequisite** — it is the first time any corpus task is probed at all,
and it produces the corrected publication rung 5 must be built on. It also
converts "the corpus might be inflated" from a worry into a measurement.

**A finding that reshaped the spec while arming it — 🟠 F-292.** Premise-checking
the candidate (the F-129 rule) turned up something worse than the gap it was
meant to close: **not one stored per-task result file anywhere carries `repoRef`.**
`suite.ts` began recording it only with WP-595 (dogfood-126, 2026-08-07), and every
stored suite — including `benchmarks/results/p3-rung-4/`, the publication of record
— predates that. So `isTaskDiscriminationVerified` (`results.ts:173`) compares a
real `baseRef` against `undefined` and excludes **100%** of tasks in any already-run
suite, reporting `"probed at ref X, but scored at ref undefined (stale proof)"` —
false twice over: the proof is not stale, and the task was not scored elsewhere.
Unfound, this would have burned the run. It is now trap G, and the honest
publishable answer is that **0 of the 19 published requirements can currently be
verified**.

**The designed trap.** A plausible-but-wrong delivery hand-writes a ledger marking
every requirement `discriminating` — greening the gate while proving nothing. The
ACs reject it by requiring each entry's `baseRef` to equal the pinned `repo.ref`
and each `fixRef` to equal the declared `fix_ref` (transcription, not invention),
requirement ids to match the task file exactly, committed per-task `probe.json`
artifacts carrying the task's real `base_verification_command`, and
`brownfield-001` to be **named** in `unverifiedTasks` rather than dropped.

**Gate verdicts:**

| gate | verdict | one line |
|---|---|---|
| §0 progression | 🟡 **ALLOW** | ⛔ STALLED + ⚠️ LADDER-PACE binds the headline to the P3 ladder rung. Rung 5 (the exit gate) cannot run as one dogfood — separation needs a far wider corpus (WP-302) and `brownfield-001` still has no gold patch. This is the **largest runnable slice of rung 5 itself**, and the first run in six to CONSUME the machinery rather than add to it. |
| §1.1 failure surface | ✅ | 12-step budget over real clones, real installs and real test suites at two refs each; durable-sweep resume is in play by design. Plausibly failable on network, toolchain, timeouts and a red base. |
| §1.2 product progress | ✅ | Landed diff advances WP-600 on `benchmarks/harness/src` + `benchmarks/results` + `benchmarks/publications` — the WP-303/WP-304 publication path. No throwaway utility. |
| §1.3 mission-critical | ✅ **PROCEED** | Not busy work, not scaffold-hosted: it produces the corrected baseline every later publication is built on, and turns "our corpus may be inflated" into a measurement. |
| §1.5 friction budget | ✅ | `class=product`; trailing-3 harness-meta headlines **0/3**, cap not busted. 🔴 F-288 is queued as WP-599, not headlined, per the STALLED rule. |

**AC arming evidence.** `scripts/dogfood.sh` classes both ACs **VERIFY-SUITE**
(they shell out to `pnpm exec tsc`), so the preflight does **not** dry-run them —
both were hand-verified in BOTH directions with `dogfood-arm.sh`:

| AC | RED on HEAD | GREEN vs reference | % of 120 s cap |
|---|---|---|---|
| AC-1 | ✅ exit **1**, **3s** | ✅ exit 0, **2s** | 3 % |
| AC-2 | ✅ exit **1**, **2s** | ✅ exit 0, **2s** | 2 % |

Worst case **3 s = 3% of the 120 s judge cap**. The reference implementation was
reverted by targeted `git checkout`/`rm` — **not** `dogfood-arm.sh --discard`,
which runs `git checkout -- .` and would have destroyed this review's own
uncommitted hand-fixes.

⚠️ **Arming disclosure:** the AC-2 reference ledger was hand-built by transcription
and passed. Trap A therefore rejects only a *lazy* forgery; a deliberate one is not
AC-detectable, and the judge's design review plus the next post-run review are the
real defenses. Said here rather than left implied — that is the whole lesson of
F-289.

**Launch command:**

```sh
devbox run run-dogfood
```
