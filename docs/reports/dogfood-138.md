# dogfood-138 — a gate that could not finish now says so, but a gate that never ran still does not (WP-615)

**WP:** WP-615 (an unfinished check must say it did not finish) · **Date:** 2026-08-13 ·
**Spec:** `examples/dogfood/dogfood-138-wp615-inconclusive-outcome.yaml` ·
**Run:** `run-3ca8f79a-ab47-44bf-a90b-14ff26b09215` · **Landed:** this review's commit ·
**Ladder:** rung 0 (off-ladder — P3 rung-5, the phase exit gate, stays operator-blocked; re-measured below)

## Plain lead

Before this run, a run whose test command was killed by the clock reported plain success and
said a *design note* had been recorded — the same words a cosmetic architecture nit gets.
Now it says the check did not complete, names the check, and carries that fact as a field a
script can read instead of a sentence a human must parse. The delivery is clean and the whole
1,376-test suite is green.

The catch is bigger than the fix: **this run's own test command never ran.** The judge raised
an advisory concern, the run converged, and the seal path that fires on a converged concern
exits before the place where a declared test suite is executed. So the run that was meant to
prove the test gate for the third time proved instead that the gate is skippable — and nothing
in the outcome said so.

## Trace

| field | value |
|---|---|
| terminal | 🟢 SUCCESS · 1 step · 6m 36s |
| cost | **$0.0814** of $20 budget (**0.4%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — unpriced (subscription); `chikory trace` prints `⚠ cost meter blind (unpriced tokens)`, so the $0.0814 is the judge alone |
| judge | `openai-compat` (`gpt-5.6-sol`, xhigh) · 1 pass · 18,177 evidence bytes |
| verdicts | rollbacks 0 · escalations 1 · resumes 0 |
| checkpoints | 1 · injections 0 |
| acceptance | AC-1 PASS · AC-2 PASS (re-run in the working tree (brownfield — harvested delivery)) |
| harvest | 7/7 files byte-**IDENTICAL** to the run workspace |

**Per-step:**

| # | tokens in/out | cost | wall | verdict |
|---|---|---|---|---|
| 1 | 3.9k/1.1k | $0.0000 | 4m 45s | ⚠ ESCALATE |

No empty-diff probe step — **F-11 (wasted probe step) did not recur**.

## Delivery quality (human review, post-landing)

### Landed files

| file | change | verdict |
|---|---|---|
| `packages/sdk-ts/src/types.ts:679-680` | `inconclusiveCheck?: string` added to `RunStatusReport`; `TerminalStatus` untouched | 🟢 |
| `packages/sdk-ts/src/schemas.ts:578` | `inconclusiveCheck: z.string().min(1).optional()` on `RunStatusReportSchema` (still `.strict()`) | 🟢 |
| `packages/sdk-ts/src/journal/journal.ts:272,311-321` | field on `TerminalPayload`; `reportFromJournal` populates it for the offline path | 🟢 |
| `packages/sdk-ts/src/runner/activities.ts:2850-2851,2882` | field on `SealRunInput`, spread onto the `terminal` payload alongside `resumable`/`remediation` | 🟢 |
| `packages/sdk-ts/src/cli/trace.ts:57,437-438,809` | rendered as `inconclusive check: …` in the trace footer and `(inconclusive: …)` on the terminal line | 🟢 |
| `packages/sdk-ts/src/workflow/agent-loop.ts:1123-1131,1151-1159` | new third branch on **both** completion-review seal paths: infra-killed rows → `SUCCESS` + `{ inconclusiveCheck }` + `"check did not complete — <id>"` | 🟢 |
| `packages/sdk-ts/test/runner/regression-suite-repair-live.test.ts` | scenarios 1–3 extended (not weakened), scenario 4 added | 🟢 |

Total: **7 files, +104 / −10**. No new dependency, no `any`, no layer violation, no cap moved.

### The goal, line by line

| goal clause | delivered | evidence |
|---|---|---|
| seal reason says the check DID NOT COMPLETE and names it | 🟢 | `agent-loop.ts:1128,1156` → `completion review: check did not complete — pre_existing_suite_still_green` |
| machine-readable marker on the terminal record | 🟢 | `activities.ts:2882` optional spread, exactly the `resumable`/`remediation` shape the goal pointed at |
| marker reaches `RunStatusReport` | 🟢 | live query path `agent-loop.ts:291`; offline path `journal.ts:319-321` — both, not one |
| `TerminalStatus` does not grow a third member | 🟢 | `types.ts` declaration unchanged; AC-1 §1 pins the set to `{SUCCESS, FAILED}` |
| a genuine red still seals FAILED with no marker | 🟢 | `agent-loop.ts:1112-1122` runs first; scenario 2 asserts `inconclusiveCheck` undefined |
| a green suite still seals SUCCESS with no marker | 🟢 | scenario 3 |
| an ordinary design finding keeps today's wording exactly | 🟢 | scenario 4 asserts the full string equality, not a substring |
| existing pinned tests updated, never deleted or weakened | 🟢 | the diff is +56/−4 on the test file; the 4 deletions are type-annotation widenings on the same `expect` |

### Independent verification (what the ACs took on trust)

Both acceptance checks re-ran green against the harvested tree. Beyond that, run by hand at
this review, since dogfood-134 proved `tests_pass` ≠ suite green:

| command | result |
|---|---|
| `pnpm --filter @chikory/sdk exec vitest run` | **175 passed \| 2 skipped (177 files) · 1353 passed \| 23 skipped (1376 tests)**, 51.66 s |
| `pnpm --filter @chikory/sdk run lint` | exit 0 (`eslint .`) |
| `pnpm --filter @chikory/sdk run typecheck` | exit 0 (`tsc --noEmit && tsc --noEmit -p tsconfig.test.json`) |

The executor's summary claimed `175 passed | 2 skipped (177)` / `1353 passed | 23 skipped (1376)`.
**Those numbers are exact.** The judge escalated because it could not see them itself — the
concern was well-founded as *evidence hygiene* and false as *fact*.

### Designed traps — all seven rejected

| trap | the wrong delivery | rejected by |
|---|---|---|
| A | seal FAILED again (undoing WP-612) | scenario 1 asserts `SUCCESS`, no ROLLBACK, workspace file survives |
| B | better prose, nothing machine-readable | scenario 1 deletes the `reason` key and still requires the id in what remains |
| C | mark everything inconclusive | scenarios 2/3/4 — the inverse squeeze on red, green and design |
| D | fix it at the row, not the outcome | AC-2 reads the **terminal** entry, not the rubric row |
| D2 | leave the marker in the journal only | AC-1 §1b requires `RunStatusReport` to grow; scenario 1 reads the real report |
| E | invent a third `TerminalStatus` | AC-1 §1 pins the declared union |
| F | raise a cap to make room | AC-1 §2 pins `DEFAULT_CHECK_TIMEOUT_MS === 120000` and the 2000-char brief by behavior |
| G | prove it with executor-authored tests | AC-1 drives `dist/`; AC-2 drives four **real** Temporal runs |

### Scope discipline

🟢 Every changed file is named by the goal or trivially entailed by it. No refactor, no
drive-by. `git status --short` shows exactly the 7 files; the harvest byte-diff is
IDENTICAL 7/7.

## New friction

Continuing the global sequence from **F-330**.

### 🔴 F-331 — a converged advisory concern seals SUCCESS without ever running the declared test suite

**What happened.** The spec declared `regression_suite: pnpm --filter @chikory/sdk exec vitest
run test/judge test/workflow` and `check_timeout_ms: 180000`, and its Thesis-KPI was the third
live proof of the WP-609 (regression-suite gate) mechanism. **The command never executed.**

**Evidence, from the run's own journal** (7 entries, read directly out of
`.chikory/runs/run-3ca8f79a-.../journal.db`):

| idx | kind | what it shows |
|---|---|---|
| 3 | `judge` | judgeIndex 0, atStep 0, `completionReview` **undefined** — a per-step pass |
| 3 | `judge` | rubric ids = `tests_pass, no_unrelated_deletions, no_secrets_introduced, no_architecture_violations, scope_matches_instruction, design_serves_overall_goal` — **no `pre_existing_suite_still_green` row** |
| 4 | `verdict` | `ESCALATE`, `escalateClass: out_of_rubric` |
| 6 | `terminal` | `SUCCESS` · `"converged out-of-rubric escalation, all criteria and rubric pass — … (F-229/F-271)"` |

There is **no second judge pass**. The suite command string appears exactly once in the whole
journal, and it is inside AC-1's own check text — never as an executed check.

**Root cause.** The regression suite runs only inside the completion review, which is reachable
only from the `PROCEED` arm (`packages/sdk-ts/src/workflow/agent-loop.ts:1058`, review dispatched
at `:1074` with `hasRegressionSuite: Boolean(spec.regressionSuite)` at `:1072`). An `ESCALATE`
verdict takes the branch at `:1207`, and **two** of its exits seal SUCCESS directly:

- `:1249` — the unattended converged seal (F-229/F-271). Fired here.
- `:1283` — the attended approved seal (F-107). Same hole, operator-side.

Both `return seal("SUCCESS", …)` before any completion review. A spec's declared deterministic
gate is therefore **advisory**: any judge remark in free text on a converged step skips it.

**Why this is 🔴 and not 🟠.** This is the WP-542/F-207 rule ("no LLM-verdict gate may exit")
at a new altitude. WP-609 exists so a delivery cannot claim SUCCESS while the project's own
tests are red; a run can now reach SUCCESS with the suite unrun **and no marker saying so** —
the precise dishonesty WP-615 was built to end, one layer up. It is also self-defeating in the
sharpest possible way: the judge's concern was *"the judge evidence does not independently show
the build, lint, or full 1,376-test suite commands and totals"* — the evidence the suite gate
produces. The escalation raised for want of that evidence is what prevented it being produced.

**HAND-FIXED THIS SITTING.** The progression gate read ⛔ STALLED once this run's ledger row
landed (trailing-3 max steps 1 vs 4), and STALLED is binding: new 🔴 friction is hand-fixed, not
headlined. Two changes in `packages/sdk-ts/src/workflow/agent-loop.ts`:

- `sealFromRubricFails` (`packages/sdk-ts/src/workflow/agent-loop.ts:352`) — the outcome ladder
  (deterministic red → FAILED · killed → SUCCESS + `inconclusiveCheck` · else the caller's
  wording) extracted into the ONE place it belongs, and now called from both completion-review
  sites (`:1197`, `:1207`). It was duplicated verbatim at those two and absent at the two escalate
  sites, which is precisely how the gate came to be skippable.
- `regressionGateBeforeSuccess` (`packages/sdk-ts/src/workflow/agent-loop.ts:397`) — called from
  both escalate SUCCESS seals (`:1301` unattended, `:1339` operator-approved). A declared suite
  runs once, then the ladder decides. Terminal-or-nothing by construction: it never re-enters the
  loop, because re-judging a converged step re-raises the same advisory concern forever — the
  dogfood-121 chain kill these seals exist to prevent.

**Proven RED-then-GREEN against the pre-fix tree**, not merely observed green
(`packages/sdk-ts/test/runner/regression-suite-repair-live.test.ts`, three new scenarios):

| scenario | pre-fix | post-fix |
|---|---|---|
| 5 — converged escalate, suite `exit 1` | `expected 'SUCCESS' to be 'FAILED'` — shipped a red suite | FAILED, `deterministic rubric failure — pre_existing_suite_still_green`, marker text in the row |
| 6 — converged escalate, suite `exit 0` | `expected +0 to be 1` — `reviewHits` 0, gate never ran | SUCCESS, gate ran **exactly once**, F-229/F-271 wording and the concern intact |
| 7 — converged escalate, **no** suite declared | passes | passes — opt-in: no extra judge pass, no cost, wording unchanged |

sdk-ts suite **1376 → 1379 tests, 175 files green**; lint and typecheck exit 0. WP-617 is
therefore closed on arrival and not queued.

### 🟠 F-332 — the inconclusive marker stops at the run boundary; a chain drops it

`readNodeResult` (`packages/sdk-ts/src/chain/activities.ts:236-259`) reads the terminal payload
and copies `handoff` (`:249`), `reason` (`:251`) and `resumable` (`:254`) onto `NodeResult`. It
does **not** copy `inconclusiveCheck`. A chain node whose suite was cap-killed therefore folds
in as an ordinary `SUCCESS` outcome; the dependent node runs on it, `node_sealed` records
nothing, and the only trace is the prose inside `reason` — which is exactly the "regex a
sentence" state WP-615 removed at run level and left standing at chain level.

Same shape as F-283 (a pipeline no task feeds) and F-330 (`checkTimeoutMs` unforwarded one call
site later): **an additive field is only real where its consumer reads it.** Not a defect the
spec's goal named — the goal said `RunStatusReport`, and `RunStatusReport` got it — so this is
new work, not a miss.

→ **WP-618 (a node's inconclusive outcome survives the fan-in)**, second WP of dogfood-139.

### ℹ️ F-306 recurrence — in-progress narration is still the trace index line

The step summary opens with `` `pnpm run test` has been launched in the background. I will wait
for it to complete and read its final output before summarizing the verification results. `` —
148 chars of stale mid-work narration at the top of a 4,562-char transcript (3.2%). Because
`chikory trace` uses the summary's first line as the step's index row, the run's one-line
headline reads as if the work were unfinished. Fourth recurrence. WP-606 unchanged; no new WP.

### ℹ️ F-333 — `check_timeout_ms` was declared for the first time and had no observable effect

The spec's Thesis-KPI billed this as the first live use of the `check_timeout_ms:` field WP-612
built. It parsed and plumbed (preflight would have rejected it otherwise), but the whole judge
pass took **1m 47s** and both checks passed, so nothing came near either the declared 180 s cap
or the 120 s default. The field is proven *wired*, not proven *load-bearing*, on a live run. No
WP — AC-2 of dogfood-137 already proved the cap live against a declared 3000 ms.

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-331 | 🔴 | a converged out-of-rubric ESCALATE sealed SUCCESS without entering the completion review, so a declared `regression_suite` never ran and nothing said so | **HAND-FIXED THIS SITTING** — `packages/sdk-ts/src/workflow/agent-loop.ts:352,397,1301,1339`; 3 new live scenarios, each verified RED on the pre-fix tree; sdk suite 1376 → **1379** green |
| F-332 | 🟠 | `readNodeResult` (`chain/activities.ts:236-259`) drops `inconclusiveCheck`, so a chain cannot tell a node's gate never ran | → **WP-618** (queued, dogfood-139) |
| F-306 | ℹ️ | executor summary still opens with stale in-progress narration, and that line is the trace index row (4th recurrence) | track-B note (WP-606 unchanged) |
| F-333 | ℹ️ | `check_timeout_ms` first live declaration exercised no timeout path (judge pass 1m 47s ≪ 120 s default) | track-B note (no WP — dogfood-137 AC-2 proved the cap live) |

## Verdict on the thesis

**Durable execution:** unexercised at this horizon — 1 step, 6m 36s, 1 checkpoint, 0 resumes.

**Real-time judging:** the judge produced one out-of-rubric concern that was *correct about the
evidence and wrong about the world* — the suite really was green at 1,376 tests. Zero
true-positives, zero false condemnations. The interesting result is structural: the run's
convergence logic (F-229/F-271, itself a fix for chains killed by exactly this kind of advisory
remark) now has a second-order cost — it can retire a run before its deterministic gate runs.
**A gate that any advisory remark can skip is not a gate.** WP-615 made the *inconclusive*
outcome honest; the *absent* outcome was still silent, and it was closed by hand in this sitting
rather than queued — the STALLED verdict below required exactly that.

**The progression gate flipped to ⛔ STALLED** once this row landed (trailing-3 max steps 1 vs 4;
no thesis axis moved). That is binding and it changed this review's output twice: F-331 was
hand-fixed rather than queued as a headline, and the next headline is the ladder rung.

**And the rung turned out to be half-unblocked.** The two rung-5 blockers were RE-MEASURED here
and both still stand — `find benchmarks/tasks -name '*brownfield-001*'` → one file, `status:
pinned` at `benchmarks/tasks/brownfield-001-dependency-major-upgrade.yaml:24`, no `fix_ref`;
`grep -rl repoRef benchmarks/results/ | wc -l` → **0**. But both gate **WP-304 only**. `plan.md`
records WP-303's data half DONE and names its residue exactly: *"Still open: the static site +
methodology prose."* That residue reads `benchmarks/publications/leaderboard/leaderboard.json`,
which is already on disk with the published intervals — no gold patch, no `repoRef`, no quota, no
new benchmark run. **Eight reviews inherited "rung 5 is blocked" and none checked whether ALL of
it was blocked.** That is the F-203 discipline (re-measure, never re-litigate) failing against our
own reasoning rather than against the code. The blocker was real; its scope was assumed.

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | 1 step / 6m 36s | 4 steps (dogfood-135); 25h 54m / 11 steps (dogfood-096, standing) |
| kill → resume count | 0 | 0 over the trailing 3 |
| judge true-positives pre-land | **0** (one concern — correct on evidence, false on fact) | 1 over the trailing 3 (135) |
| meta:product headline ratio | product | **0:3** harness-meta over 136–138 — cap (≤1:3) intact |
| per-step reliability (runs ≥5 steps) | n/a (<5 steps) | **94.7%** (9 rollbacks / 170 steps, 21 runs ≥5 steps) — target 99%+ |
| ladder rung vs exit gate | rung 0 (off-ladder, 9th consecutive) | rungs 1–4 climbed; **rung 5 = the exit gate — its WP-303 half is unblocked and is dogfood-139**, its WP-304 half still operator-gated |
| progression verdict | ⛔ **STALLED** (trailing-3 max steps 1 vs 4) | binding: 🔴 friction hand-fixed, next headline IS the rung |
