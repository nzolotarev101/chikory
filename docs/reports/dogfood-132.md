# dogfood-132 — a self-heal now keeps the work nobody said was wrong (WP-605)

**WP:** WP-605 (a heal must not throw away work the human never asked to throw away) · **Date:** 2026-08-11 ·
**Spec:** `examples/dogfood/dogfood-132-wp605-heal-preserves-work.yaml` ·
**Run:** `run-8e2c21c7-c495-491b-8a4a-0c9f141c7902` · **Landed:** this review's commit ·
**Ladder:** rung 0 (off-ladder by declaration) — P3 rung-5 (the phase exit gate) stays operator-gated

## Plain lead

When a run got corrected and tried again, it used to throw away the last thing it built — even
when nobody had said that work was wrong. It now decides instead of flinching: work the quality
gate condemned is undone, work it never condemned is kept, and the correction is applied on top.
One step, $0.044, 2/2 acceptance criteria, and the fix is the exact defect the previous run's own
delivery would have been the first victim of.

## Trace

| field | value |
|---|---|
| terminal | 🟢 SUCCESS · 1 step · 3m 36s |
| cost | **$0.044** of $20 budget (**0.2%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — keyless OAuth, so wire cost is $0 and the header prints `⚠ cost meter blind (unpriced tokens)` (ℹ️ F-299, known) |
| judge | `openai-compat` (`gpt-5.6-sol` xhigh) · 1 pass · $0.0440 · 37 s · 13,574 evidence bytes |
| verdicts | rollbacks 0 · escalations 0 · resumes 0 |
| checkpoints | 1 · injections 0 |
| acceptance | AC-1 PASS · AC-2 PASS (re-run in the working tree (brownfield — harvested delivery)) |
| harvest | 5/5 files byte-**IDENTICAL** to the run workspace |

**Per-step:**

| # | tokens in/out | cost | wall | verdict |
|---|---|---|---|---|
| 1 | 3.8k/1.7k | $0.0000 | 2m 55s | ✓ PROCEED (2/2 criteria) |

No empty-diff probe step — **F-11 (wasted probe step) did not recur**.

## Delivery quality (human review, post-landing)

**Landed files (5, all byte-identical to the run workspace):**

| file | what |
|---|---|
| `packages/sdk-ts/src/workflow/heal-rollback.ts` | new — the pure decision `decideHealRollback` + `HealRollbackInput`/`HealRollbackDecision` |
| `packages/sdk-ts/src/judge/verdict.ts:47-58` | new exported helper `hasDestructiveRubricFailure` |
| `packages/sdk-ts/src/index.ts:399-404` | public export of the decision and its two types |
| `packages/sdk-ts/src/workflow/agent-loop.ts:327-364` | `applyRemediation` calls the decision; restore + `rollbackTo` journaling are both conditional on it |
| `packages/sdk-ts/test/runner/heal-rollback.test.ts` | 7 unit tests beside `rejection.test.ts` / `remediation.test.ts` |

**The goal, line by line:**

- 🟢 **"The rollback is a decision, not a reflex."** `applyRemediation` (`agent-loop.ts:337-345`)
  computes `decideHealRollback(...)` first and derives `rollbackTo` from it; both the
  `recordRemediation` payload (`:352`) and the `restoreCheckpoint` call (`:355`) key on that one
  value. The old unconditional `lastGoodCheckpointId !== undefined` test is gone from both.
- 🟢 **"Condemned means the verdict said so."** `heal-rollback.ts:41` —
  `!criteriaAllPass || destructiveRubricFailed === true`. **WP-519's guarantee survives in
  practice, not just in principle:** the rule-3 HALT is *reached* through trailing criterion
  failures, so `allCriteriaPass(verdict)` is false there by construction and the HALT branch
  (`agent-loop.ts:1128-1132`) always rolls back. Verified independently against the pre-existing
  live test `test/runner/remediation-live.test.ts:141`, which still asserts
  `payload.rollbackTo === report.checkpoints[1].id` and is still green.
- 🟢 **"The trigger does not decide."** `decideHealRollback` reads `input.trigger` **not at all** —
  the field exists to document that it is inert. AC-1 loops both `"operator_reject"` and `"halt"`
  over every verdict shape and requires identical answers.
- 🟡 **"The journal tells the truth about which happened."** Half-met — see 🟡 F-307 below. A
  preserving heal correctly omits `rollbackTo`, but so does a heal that had no anchor to restore,
  and `chikory trace` renders both identically.
- 🟢 **"The correction survives either way."** `judgeFeedback = brief` and
  `lastRemediationBrief = brief` (`agent-loop.ts:363-364`) are outside the conditional; AC-2 pins
  a random per-scenario marker string reaching the journal in **both** branches.
- 🟢 **"One remediation helper."** `applyRemediation` is still the single heal body, called from
  exactly two sites (`:384` via `handleOperatorRejection`, `:1128` for HALT), and
  `handleOperatorRejection` still serves both the judge-escalate (`:1207-1210`) and loop-breaker
  (`:1254`) rejects. The dogfood-131 judge's `design_serves_overall_goal` finding was **not**
  regressed — no second helper was forked.

**Designed traps — all six rejected:**

| trap | plausible-but-wrong delivery | rejected by |
|---|---|---|
| A | never roll back at all (guts WP-519) | AC-1 (failing criterion → `rollback` under both triggers) + AC-2 scenario 2 (`step-2.txt` must be GONE) |
| B | key the decision on the TRIGGER not the VERDICT | AC-1 loops both triggers over identical verdict facts |
| C | keep the work but journal `rollbackTo` anyway | AC-2 scenario 1 asserts `rollbackTo` **absent** |
| D | preserve the diff, drop the operator's words | AC-2 asserts the marker in both scenarios |
| E | a pure function the loop never calls (F-274/F-277 shape) | AC-2 drives the real Temporal workflow, real approve/reject, real workspace, real journal |
| F | fork a second heal helper for the reject path | not AC-gated — verified by hand above; two call sites, one body |

**Independent verification beyond the ACs:**

- Full `sdk-ts` suite re-run on the harvested tree **before any review hand-fix**: **172 files /
  1,320 tests green, 23 skipped** — matching the executor's own claim, which was therefore not a
  fabrication. (**1,323** after this review's F-306 hand-fix adds 3.)
- `tsc --noEmit`, `tsc --noEmit -p tsconfig.test.json` and `eslint .` all exit 0 (the F-301
  test-project gate the previous review added stays clean).
- **The safe default is the old behaviour.** `applyRemediation`'s `verdictFacts` parameter is
  optional and defaults to `criteriaAllPass: false` (`agent-loop.ts:341`) — a future call site
  that forgets to pass verdict facts gets the pre-WP-605 unconditional rollback, not a silent
  keep. Correct direction for a safety-relevant default.
- **The loop-breaker reject path was checked for a stale-verdict hazard and is clean.** `verdict`
  is declared per-iteration (`agent-loop.ts:920`), so the value passed at `:1254` is this step's
  own verdict — `undefined` when the pass was off-cadence, which `allCriteriaPass` maps to
  `false` → rollback, i.e. behaviour unchanged where there is no verdict to consult.
- **`sinceCommit` stays coherent on the keep path.** It advances only on PROCEED, so after a
  preserved heal the next judge pass diffs from the same base and re-sees the preserved work plus
  the correction — which is what "the brief is applied on top of it" has to mean.

**Scope discipline:** 🟢 5 files, all named or trivially entailed by the goal. No dependency
change, no provider SDK, no test deleted, no existing expectation weakened. The AC-2 generated
test file was written and removed by the check itself — `git status` shows no leftover.

## New friction

### 🟠 F-306 — the gemini executor persists raw CLI stdout as the step summary, so the CLI's own telemetry and the model's private deliberation get carried into the next step

`parseAgyOutput` takes `stdout.trim()` verbatim as the summary
(`packages/sdk-ts/src/executors/gemini-cli.ts:56`). This run's summary is **6,729 bytes, of which
the first 1,088 (16.2%) are not the agent talking about the task**:

- **349 bytes** — an `agy` background-task envelope: `<notification><task_id>…</task_id>
  <task_summary>pnpm exec vitest run</task_summary><status>SUCCESS</status>
  <log_path>file:///Users/…/.gemini/antigravity-cli/brain/…/task-42.log</log_path>
  <exit_code>0</exit_code></notification>`.
- **737 bytes** — the model quoting its own communication-style system prompt back to itself
  (*"Nervously waiting? No, the system will notify us when `task-97` finishes. Wait, remember
  communication style rule: …DO NOTHING ELSE."*).

That string is not cosmetic. It is consumed three times:

| consumer | site | consequence |
|---|---|---|
| the **next step's prompt** | `agent-loop.ts:883` (`recentSummaries.push`) → `:769` (`recentSteps`) | context rot — the WP-203/204 pillar — fed 1 KB of foreign harness noise per step |
| the **pacing governor** | `agent-loop.ts:841` (`estimateTokensFromText(record.summary)`) | the next-step token estimate is inflated by noise the agent never wrote |
| the **`chikory trace` step title** | first line of the summary | this run's step is titled `<notification> <task_id>a97fda3b-83…` |

Single-step run, so nothing was actually rotted here — but every multi-step gemini run pays it.
Neighbour, not duplicate: ℹ️ F-176 is *"`parseAgyOutput` recovers no tool count and no outcome
summary"*; this is the sharper form — the summary it *does* record contains material the agent
did not author.

**Disposition — half hand-fixed, half queued.** The `<notification>` envelope is a precisely
delimited CLI artefact and is now stripped (`gemini-cli.ts:43-56`, +3 tests
`test/executors/gemini-cli.test.ts:62-89`, including the negative — output that is *nothing but*
an envelope must still FAIL as "no response"). The 737-byte deliberation has no reliable
delimiter, so the residue goes to **WP-606**: the step prompt already demands a terminal
`CHIKORY_TASK_COMPLETE` line (`executors/prompt.ts:71-76`); give it a matching opening delimiter
and have every CLI adapter extract the delimited span, falling back to full stdout.

### 🟡 F-307 — a heal that preserved the work is indistinguishable from a heal that had nothing to restore

The goal asked that *"a reviewer reading `chikory trace` can tell the two apart without
re-deriving the verdict."* Both ACs read the **journal**; neither reads the trace surface the
sentence names. In the landed shape the journal encodes "preserved" purely as the **absence** of
`rollbackTo` (`agent-loop.ts:346-353`), and `cli/trace.ts:796` renders the suffix
`(rolled back to X)` only when the key is present. So three different situations render
identically as a bare `🩹 remediation attempt N @ step M — <trigger>`:

1. the verdict condemned nothing and the work was deliberately kept (the new behaviour),
2. there was no last-good checkpoint to restore (`heal-rollback.ts:38`, pre-existing),
3. any pre-WP-605 run's heal in that same state.

A reviewer must re-derive the verdict to tell which — exactly what the goal bullet ruled out.
Not a correctness defect (the journal never *lies*; C was the trap and C is rejected), and no AC
failed. **track-B note** — the fix is a positive marker on the remediation entry rather than an
absence, which touches the journal entry schema (`docs/spec/journal-format.md` §3) and is not
work to slip into a review sitting ungated and unjudged.

### 🟡 F-308 — the campaign index silently lost dogfood-132's own row

`dogfood-docs.mjs index --row <file>` splices the file's contents into
`examples/dogfood/README.md` verbatim (`scripts/dogfood-docs.mjs:198`). The dogfood-131 review
passed a file holding only the **description cell**, so what landed as the last line of the index
was a bare `**WP-605 — A HEAL THAT EATS THE DELIVERY…**` paragraph with no leading
`| [`dogfood-132-…yaml`](…) |` cell and no trailing outcome/report columns. Consequences, both
silent: the campaign table has no dogfood-132 entry at all, and `--outcome` on the next review
dies with `no README row for dogfood-132` because its lookup keys on that exact prefix.

**HAND-FIXED THIS SITTING.** The row is repaired in place, and `--row` now refuses content that
does not begin with the `dogfood-<nnn>` link cell or does not carry 4 columns
(`scripts/dogfood-docs.mjs:182-197`). The guard was exercised for real by this review's own
dogfood-133 row insert.

### ℹ️ F-299 recurrence — `⚠ cost meter blind` on a keyless executor

`chikory trace` prints `⚠ cost meter blind (unpriced tokens)` (`cli/trace.ts:261`) because the
step metered 5,465 tokens at $0.0000. That is correct-by-design for `agy` (keyless Antigravity
OAuth, `costEstimated: true`), not a meter fault. Already track-B under F-299 (dogfood-130); the
sibling JD-7 cost-share warning was already suppressed for keyless executors by F-230
(`runner/activities.ts:1826-1836`), which is why judge share 100.0% > `max_cost_share: 0.5` did
**not** raise a false alarm this run. No new item.

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-306 | 🟠 | gemini step summary is raw stdout — 1,088 of 6,729 bytes (16.2%) is CLI telemetry + the model quoting its own system prompt, and it rides into the next step's prompt, the pacing estimate and the trace title | **HAND-FIXED THIS SITTING** (envelope half) — `src/executors/gemini-cli.ts:43-56`, 13 tests green in `test/executors/gemini-cli.test.ts` (3 new); residue → **WP-606 (queued)** |
| F-307 | 🟡 | a preserving heal and an anchorless heal are the same bare line in `chikory trace`; no AC read the trace surface the goal named | **track-B note** (DOGFOODING §8) — the fix is a journal-schema marker, not review-sitting work |
| F-308 | 🟡 | `dogfood-docs.mjs index --row` inserted a `--row` file verbatim without checking it was a table row, so dogfood-132's own campaign-index entry landed as a bare description with no link cell — invisible to the table and to the next review's `--outcome` lookup | **HAND-FIXED THIS SITTING** — row repaired in `examples/dogfood/README.md`; shape guard at `scripts/dogfood-docs.mjs:182-197` (refuses content not starting with the `dogfood-<nnn>` link cell, or carrying <4 columns), exercised by the dogfood-133 row insert in this same review |
| F-299 | ℹ️ | `⚠ cost meter blind` on the keyless executor (recurrence, not new) | track-B note — already recorded, no new item |

## Verdict on the thesis

**The loop closed on its own finding in one run.** F-302 was measured during the dogfood-131
review; WP-605 was specified against that measurement and delivered in a single 2m 55s step for
$0.044 with 2/2 criteria and all six designed traps rejected. That is the campaign's shortest
finding→fix cycle on a live correctness defect, and the defect was in code that had landed hours
earlier — WP-602's first real use would have destroyed the delivery it was healing.

**What the run does not prove.** Zero judge catches (one pass, straight PROCEED) and a one-step
horizon: this run says nothing about long-horizon behaviour or about the judge as a gate. The
proof here is the ACs' — specifically AC-2, which drives the real Temporal workflow through the
real approve/reject path and reads the real workspace, and so cannot be satisfied by a pure
function the loop never calls. That AC design (own the oracle, drive the real entry point) is now
carrying the run's entire evidential weight; the judge contributed a clean second opinion, not a
catch.

**Standing caution.** Two runs in a row (131, 132) have been off-ladder at rung 0 while the
`⚠ LADDER PACE` flag stands. Both were justified — a live correctness defect beats a rung — but
rung 5's blockers are unchanged operator work (the `brownfield-001` zod v3→v4 gold patch, and a
both-arm re-run so stored results carry `repoRef`), and no amount of product runs will clear
them. **The next off-ladder headline needs a stronger reason than the last two did.**

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | 1 step / 3m 36s | 6 steps (dogfood-129) over trailing 3; **max steps trailing-3 = 6 vs prior-3 = 1** |
| kill → resume count | 0 | 0 across trailing 3 |
| judge true-positives pre-land | 0 (single PROCEED pass) | 4 over trailing 3 (129: 3 · 130: 2 · 131: 1) |
| meta:product headline ratio | product (0 meta) | **0 harness-meta of 3** — cap ≤1/3 not busted |
| per-step reliability (runs ≥5 steps) | n/a (<5 steps) | **94.7%** — 9 rollbacks over 170 steps, 21 runs ≥5 steps (target 99%+) |
| ladder rung vs exit gate | **rung 0** (off-ladder by declaration) | rung 4 of 5 is the standing high-water mark; rung 5 = P3 exit gate, operator-gated |

## NEXT RUN

**Make it impossible for a written work order to be silently thrown away: a spec that states a
quality rule the judge must apply to this one run is either honoured on every pass or refused out
loud, and the field that only pretends to be that channel stops pretending.**

- **Spec:** `examples/dogfood/dogfood-133-wp604-rubric-channel.yaml`
- **WP:** WP-604 (a spec must be able to state a run-scoped judge rubric item, and losing one must
  be loud)
- **Why THIS and not the ladder rung:** §0 progression = ✅ PROGRESSING with ⚠️ LADDER PACE. The
  default candidate is P3-rung-5 (the phase exit gate); its two blockers were **re-measured this
  review, not re-litigated**, and both still stand — `find benchmarks -path '*brownfield-001*'`
  returns only the task YAML (no gold patch exists; 3–6 h of operator research, no upstream commit
  to name), and `grep -rl repoRef benchmarks/results/` returns **nothing** (both arms must be
  re-run; hours of quota, and dogfood-122 proved an LLM executor must not supervise a quota-bound
  multi-hour suite). Neither is product work an agent can do. WP-604 is the only open 🔴 and the
  **third instance of one defect class** — F-296 → WP-602 (reject text), F-298 → WP-603 (branch
  guidance), F-300 → WP-604 (rubric item): a channel accepts human intent and drops it without a
  word. It already cost the campaign a shipped-**ungated** trap two runs ago while preflight
  printed all 🟢.
- **The designed trap:** adding `judge.rubric_extra` to the schema, mapping it onto the spec, and
  never asking the judge — the F-300 defect wearing the fix as a costume. The delivery parses
  cleanly, `chikory trace` shows nothing new, and the rule gates nothing. AC-2 is the answer: it
  reads the **journaled verdict form** for the spec-authored id, which a stored-and-ignored field
  cannot produce. Five more are gated alongside: a spec typo declaring an item `destructive: true`
  and firing a workspace ROLLBACK; silently merging an id that collides with a standing rubric
  item (or a duplicate); leaving `judge.rubric_packs` inert one key to the left; scoring the item
  in the form but excluding it from `computeVerdict`'s rubric list; and parking a run on a
  spec-authored design finding.
- **Gate verdicts:**
  - **§0 progression** — ✅ PROGRESSING (⚠️ LADDER PACE); rung 5 blockers re-measured and unchanged,
    both operator-only. Spec carries `# Ladder-rung: 0` + `# Thesis-KPI:` and passes
    `dogfood-progression.sh --spec` as 🟢 LOOSE (headline-eligible).
  - **§1.1 failure surface** — ✅ a competent agent can plausibly fail this: cross-file
    (`taskspec.ts` + `schemas.ts` + `types.ts` + the judge threading), six named traps, and the
    obvious delivery (parse-and-drop) is exactly the one AC-2 rejects.
  - **§1.2 product progress** — ✅ the landed diff advances a real open `plan.md` §6 product WP on
    a thesis pillar (Agent-as-a-Judge gating). No scaffold, no throwaway utility; the mechanism is
    seeded into the judge's own rubric path.
  - **§1.3 mission-critical** — ✅ PROCEED. Not busy work and not scaffold-hosted: it is the only
    open 🔴 and the third repeat of a defect class that has already burned two runs.
  - **§1.5 friction budget** — ✅ `class=product`. Trailing-3 harness-meta headlines **0/3**; the
    cap (≤1 per 3) is not busted. The three frictions this review opened are hand-fixed or
    track-B, none headlines.
- **AC arming evidence** — the preflight classed **both** ACs as VERIFY-SUITE, so **neither
  dry-ran**. Both were hand-verified in **both** directions with `scripts/dogfood-arm.sh`
  (`.chikory/review/arm-dogfood-133-wp604-rubric-channel.json`):

  | AC | RED on HEAD | GREEN vs reference | % of 120 s cap |
  |---|---|---|---|
  | AC-1 | ✅ exit **1**, **3s** | ✅ exit 0, **3s** | 3 % |
  | AC-2 | ✅ exit **1**, **6s** | ✅ exit 0, **7s** | 6 % |

  Worst case **7 s = 6% of the 120 s judge cap**. The throwaway reference (schema + validation +
  judge threading across `taskspec.ts`, `schemas.ts`, `types.ts`, `runner/activities.ts`) was
  reverted **by name**, never with `--discard` — that flag is `git checkout -- .` over the whole
  tree and would have destroyed this review. `git status` confirms those four files are clean.
  The RED pass ran against a tree carrying the WP-605 delivery (the state the next run starts
  from), which the script correctly flagged as dirty. Launch preflight at $0: ✅ spec lint, env
  contract, window sizing, **all 6 agent class members answered live**, and the spec-pick glob
  resolved to `dogfood-133-wp604-rubric-channel.yaml`.

```sh
devbox run run-dogfood
```
