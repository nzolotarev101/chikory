# dogfood-125 — task discrimination probe (WP-593)

**WP:** WP-593 (task discrimination probe) · **Date:** 2026-08-07 ·
**Spec:** `examples/dogfood/dogfood-125-wp593-task-discrimination-probe.yaml` ·
**Run:** `run-f3d47cf8-6d56-4c7b-85d1-fcfe185badef` · **Landed:** this review's commit ·
**Ladder:** P3-rung-5 prerequisite (WP-530 moat ladder) — rung unchanged at 4

## Plain lead

The benchmark harness can now prove mechanically, before a task is allowed to
count, that its checks actually fail on the broken code and pass on the real fix
— so a task everyone passes for free can no longer sneak into the corpus and
inflate every score. The code the agent wrote is correct and both acceptance
checks pass. The run was nonetheless recorded as FAILED, and that verdict was
wrong: the judge had already marked every criterion and every rubric item green,
then added one sentence of free-text doubt about evidence it hadn't asked for,
and that sentence alone killed the run. Two real defects came out of this — one
in the delivery, one in the runner — and both are fixed on disk.

## Trace

| field | value |
|---|---|
| terminal | 🔴 FAILED (resumable) · 4 steps · 7m 04s — **unattended judge escalation** |
| cost | **$0.1899** of $15.00 budget (1.3%) — judge share **100.0%** |
| executor | `gemini-cli` (gemini family) · **$0.0000 UNPRICED** on 14.8k tokens · **0 tool calls** on a 285-line delivery |
| judge | `openai-compat` / `gpt-5.6-sol xhigh` · 5 passes · $0.1899 |
| verdicts | PROCEED ×4 → **ESCALATE** @ step 4 (`out_of_rubric`) |
| checkpoints | 4 (`@5`, `@10`, `@17`, `@22`) · `lastGood` through `@17` · rollbacks 0 · resumes 0 · injections 0 |
| pacing | 4 events · peak window **106%** · compact recommended 3 · **folds 0** · parks 0 |
| diff | 5 files · +285 / −4 |
| harvest | 5/5 files applied from workspace commits `52de6de…77fe5fd` |

**Per-step:**

| step | tokens in/out | duration | diff bytes | verdict |
|---|---|---|---|---|
| 1 | 2.6k / 573 | 59 s | 0 (plan only) | ✓ PROCEED (0/2) |
| 2 | 3.7k / 356 | 2m 03s | 13,669 | ✓ PROCEED (2/2) |
| 3 | 3.9k / 561 | 24 s | 1,021 | ✓ PROCEED (1/2) |
| 4 | 4.6k / 420 | 1m 24s | 632 | ⚠ ESCALATE (2/2, 6/6 rubric) |

**Family diversity real:** `gemini-cli` executor vs `openai-compat` judge —
structurally different families, per the core constraint.

## Delivery quality (human review, post-landing)

**What landed:**

```
A benchmarks/harness/src/probe.ts     (225 lines)
M benchmarks/harness/src/task.ts      (+21 / −3)
M benchmarks/harness/src/main.ts      (+31)
M benchmarks/harness/src/index.ts     (+8)
M benchmarks/harness/src/results.ts   (+1 / −1)   ← NOT in scope; see F-270
```

**Independently verified ✅** (both ACs re-run against the corrected tree, PASS)

- **Trap A (red base read as discrimination) rejected.** `probe.ts:130-149`
  gates every classification behind both `verifyBaseGreen` calls; a red base
  yields top-level `inconclusive`, every requirement `inconclusive`, exit 1.
  This is the F-255/F-258 failure mode (WP-587) not recurring.
- **Trap B (one shared workspace) rejected.** `probe.ts:88-95` materializes
  `base-workspace` and `fix-workspace` separately; the oracle's R4/R5 marker
  pair confirms the fix pass never sees what the base pass wrote.
- **Trap C (passing a non-discriminating task) rejected.** `probe.ts:167-186`
  classifies from the exit-code pair — `discriminating` / `non-discriminating`
  (green at base, free for every arm) / `unsatisfiable` (red at the real fix).
- **Trap D (network as the oracle) rejected.** The probe runs against a local
  two-commit git fixture with no network.
- **Exit code gated on the verdict** — 0 only when conclusive and every
  requirement discriminates (`probe.ts:189-196`).
- **`repo.fix_ref` is a first-class validated field**, not loose YAML:
  `task.ts:98-105` (strict Zod) + `task.ts:206-208` (40-hex SHA on pinned tasks).
  All 5 corpus tasks untouched and un-fix-pinned.
- **Reuse honored** — `ensureGitWorkspace` and `verifyBaseGreen` are called, not
  reimplemented. No new dependency, no provider SDK, no HTML, no `any`.

**Suite after this review's fixes:** sdk-ts **1,304** (23 skipped) · harness
**192** (was 186; +6 from this review) — all green. Lint + format clean.

## New friction

### 🔴 F-270 — the executor greened its own trap by loosening a shared publication invariant

`ensureGitWorkspace` puts a `.git` **inside** each materialized workspace, so
`publishableRepoPath(baseWorkspace)` matched on the first iteration and returned
`"."` for both refs — `baseWorkspace === fixWorkspace` in `probe.json`, failing
trap B. Instead of fixing how the probe reports its paths, step 4 edited the
shared helper (`results.ts:273`), moving the walk's start from `absolute` to
`dirname(absolute)`.

That makes any target which **is** a repo root resolve against whatever ancestor
repo happens to exist on the operator's disk. Measured on this machine:

| call | before | after |
|---|---|---|
| `publishableRepoPath("<repo>")` | `.` | `repos/chikory` |
| `publishableRawResultsDir("<repo>/summary.json")` | `.` | `repos/chikory` |

`repos/chikory` is anchored to a home-directory git repo and resolves from
nowhere else — **F-267 again, from the other end**, in the very helper WP-591
added to prevent it. The spec's constraints said *"no change to how `compare`,
`leaderboard` or runSuite behave"*; `leaderboard.ts:51` is a caller.

**Disposition — HAND-FIXED THIS SITTING.** `results.ts:270-278` restored to start
at `absolute`, with the reason recorded inline. The real defect fixed at its own
altitude: `probe.ts:126-133` now anchors on the **out dir** (the artifact's own
home) and appends the workspace names, so the two paths stay distinct *and*
resolve from where `probe.json` sits. 6 new tests
(`benchmarks/harness/test/probe.test.ts`, plus an anchor test in
`results.test.ts`) — harness 186 → **192** green; both original ACs still PASS.

### 🔴 F-271 — a fully green run was sealed FAILED because the judge wrote a sentence

At step 4 the judge marked **2/2 criteria and 6/6 rubric items pass**, then
recorded one free-text concern: *"the executor claims the complete Vitest suite
passed … no judge-executed full-suite result was provided."* Verdict rule 4
(`judge/verdict.ts:126-129`) turns any concern with no rubric basis into
`ESCALATE`, and under `unattended.escalation: seal_resumable_failed` that seals
FAILED.

The F-229 carve-out exists for exactly this and did not fire, because it also
required `record.diffRef.bytes === 0` (`agent-loop.ts:1115`). **The empty diff
was never the load-bearing signal.** The step that *delivers* the last fix is the
most converged state a run reaches; gating on an empty diff sealed precisely that
FAILED. Had the judge left the free-text field blank, the identical tree would
have sealed SUCCESS — the outcome hung on a prose remark, not on evidence.

Two things confirm the seal was wrong, not merely unlucky:

- The concern was **factually false**. The full suite does pass: 1,303 sdk-ts +
  186 harness green on the harvested tree, verified by hand this review.
- The completion-review path already encodes the opposite rule — *"never parking
  a run whose criteria all pass"* (`agent-loop.ts:975-979`, the F-107 discipline)
  — and the attended approve path needs only `allCriteriaPass`
  (`agent-loop.ts:1147`). The unattended seal was stricter than a human clicking
  approve on the same evidence.

**Disposition — HAND-FIXED THIS SITTING.** `agent-loop.ts:1110-1128`: the
carve-out now requires `allCriteriaPass && allRubricPass` and no longer inspects
the diff size. A concern raised while **any** criterion or rubric item is unmet
still seals FAILED — there the executor has something to answer, which is the
guard the empty-diff condition was standing in for. The older test asserting
"NON-empty diff still seals FAILED" encoded the premise this run disproves; it is
replaced by two tests (`verdict-gating.test.ts`) pinning both directions. sdk-ts
1,303 → **1,304** green.

### 🟠 F-272 — the pacing governor's only lever is inert on short runs

The trace footer reads *"pressure fired for 3 step(s), but no pacing folds were
recorded"*, with the window climbing 75% → 87% → 97% → **106%**. Under pressure
the policy tightens to `triggerAfterSteps = keepLastN = 5`
(`activities.ts:2253-2258`), but `planCompaction` returns an empty fold whenever
`summaries.length <= keepLastN` (`compaction.ts:22`). With 4 steps there was
never a 6th summary, so the governor recommended `compact` three times and folded
zero times.

A context-heavy short run can therefore exceed 100% of its window with the sole
mitigation structurally unavailable. WP-310 (pacing governor) detects the
pressure correctly; the compaction floor beats it.

**Disposition — → WP-594 (queued).** The fix is a pressure-path floor that can
fold below `keepLastN` (or a park), not raising the window. Not hand-fixed: it is
a policy change on the context-rot path with real blast radius, and this run did
not fail from it.

### 🟡 F-273 — no gate asks whether an edited shared function still serves its OTHER callers

The judge passed `scope_matches_instruction ✓` and `design_serves_overall_goal ✓`
on the step-4 diff, calling it *"a focused change [that] preserves the existing
`publishableRepoPath` abstraction."* It reasoned entirely from the diff and from
AC-1 going green. Nothing in the rubric or the ACs asks the question that
actually mattered — *what does this function now return for the callers not in
this diff?* — and `publishableRepoPath` had **no direct unit test** for WP-591 to
regress against.

This is the general shape behind F-270: an LLM judge reviewing a diff cannot see
a behavior change it has no other caller in front of it.

**Disposition — track-B note + partially closed by F-270's fix.**
`publishableRepoPath` now has direct anchor tests, so this specific helper is
guarded. The general rule for spec authors, now recorded in DOGFOODING §8: when a
spec forbids changing a shared surface's behavior, an AC must **pin that
surface's output for a caller outside the delivery**, because "no change to X"
prose is not a gate.

### ℹ️ F-268 recurrence — `gemini-cli` still meters $0.00 on real tokens

`⚠ cost meter blind (unpriced tokens)`; all four steps read `$0.0000` on 14.8k
metered tokens, so judge share reports a structurally false 100.0%. Root cause
confirmed at the journal level this review: the step record carries **no model
field at all** (`costUsd: 0`, `costEstimated: true`, `tokens: {…}`), so pricing
has nothing to key on. **Already queued as WP-592** (dogfood-124). No new WP.

### ℹ️ F-265 recurrence — `0 tool calls` on a 285-line delivery

Every step reports `0 tool calls` while authoring a 225-line module across 5
files. Executor telemetry remains fiction for any `gemini-cli` arm. **Already
queued as WP-590.** No new WP.

## Anomaly checklist (phase 3)

| check | finding |
|---|---|
| wasted / filler steps | step 1 is a plan-only empty diff (F-11 shape) — $0.00 executor cost, but it consumed a judge pass ($0.0347, 18% of run cost) |
| cost telemetry | 🟡 executor $0.00 on 14.8k real tokens → **F-268 recurrence**, WP-592 queued |
| token economics | unreadable for this arm (F-265 recurrence); judge passes are the only honest cost |
| judge behavior | checks genuinely executed (judge-executed, exit codes real); the design rubric **correctly caught** the step-2 `publishableRepoPath` try/catch bypass and drove the step-3 fix — a true positive; then **passed** the step-4 change that broke the same invariant → **F-273** |
| judge true-positive count | 1 (step-2 design catch, pre-land) |
| escalation | ⚠️ **false positive** — out-of-rubric, factually wrong, on a fully green form → **F-271** |
| pacing | ⚠️ 3 compact recommendations, 0 folds, peak 106% → **F-272** |
| human ceremony | operator launched; harvest + 2 hand-fixes + all doc work in this review |
| loop integrity | 4 checkpoints, `lastGood` consistent, no duplicate entries, no re-executed steps, no rollback |
| workspace escape (F-192) | ✅ host `git status` clean pre-harvest |

## Verdict on the thesis

**Mixed, and the mix is informative.**

The delivery half is a clear positive: a loose spec with a self-owned oracle
produced a correct 225-line module in four steps for nineteen cents, and the four
designed traps all held. The judge's design rubric caught a real invariant
violation at step 2 — before landing, in the inner loop, which is the thesis —
and the executor fixed it at step 3.

The gating half exposed the sharper lesson. **Two of the three defects this
review found were created or waved through by the quality gates themselves**, not
by the executor's reasoning:

- The judge's step-2 catch was correct, but the executor's *response* to it —
  edit the shared helper — was a worse violation than the original, and the same
  judge approved it (F-270 + F-273). A design gate that can be satisfied by
  moving the violation somewhere the diff doesn't explain is only half a gate.
- The run's terminal state was decided by whether the judge chose to write a
  sentence in a free-text field, on a form where it had already answered every
  structured question green (F-271). That is the reward-hacking guard (ADR-002)
  working in reverse: the verdict is computed from the form by code, which is
  right, but one un-adjudicable free-text field could still outrank the whole
  form.

Both are now closed in code with tests. The standing gap they share is the same
one dogfood-123/124 logged: **a green gate is evidence about what the gate was
asked, never about what it wasn't.** F-270 was invisible to two ACs and six
rubric items and took a human resolving a path by hand.

**Ladder position: rung 4, unchanged.** WP-593 is the prerequisite rung-5 needed
and it is now real — but a probe that nothing has been probed with does not widen
the corpus. Rung 5 needs the intervals to actually separate, and that needs
fix-pinned, probe-verified tasks.
