# bench suite `20260725-130418-chikory` — first directive-arm scored suite; WP-535 live-proven, P3-rung-4 still not climbed

- **Date:** 2026-07-25
- **Launcher:** `devbox run bench-run` (new `scripts/bench-run.sh`, uncommitted)
- **Arm:** executor `gemini-cli` (`agy`, family `gemini`) · judge/plan/review `openai-compat` → codex proxy (GPT-5) — the standing directive, verified in the capability journal
- **Suite:** `benchmarks/results/20260725-130418-chikory` · 2 evaluated + 1 blocked · **7/7 requirements, I-SR 100.0%, D-SR 100.0%** · 36m 56s wall
- **Runs:** `run-7f576f26-4ee2-482d-b79a-32dbd59c8873` (brownfield-001) · `run-c6216ebb-c5db-4abb-ab3c-3d530002d533` (brownfield-003)
- **Code under test:** HEAD `e62e8a6` (WP-535 hermetic judge checks + WP-536 family preflight both in)

## Plain lead (vibe check)

Both benchmark tasks passed every requirement, and the fixes we landed last
session held up in the wild: the judge no longer contaminates the code it
grades, and the run used the right models. But the headline 100% hides an
expensive mess — one task spent two thirds of its 33 minutes fighting itself,
because a CLI flag we never set was silently cutting each work step off at 5
minutes, and because that task's own install check uses the wrong package
manager for the repo it targets. Both are fixed in this sitting. The benchmark
ladder did **not** advance: this is still a 2-task suite with no baseline to
compare against, so it re-proves rung 3, not rung 4.

## Glossary (IDs used here)

- **WP-n** — work package in `plan.md`. **WP-535** (hermetic judge checks), **WP-536** (bench launch family preflight), **WP-534** (per-target node provisioning), **WP-304** (baseline runs), **WP-302** (brownfield task authoring).
- **F-n** — global sequential friction id. This report adds **F-172…F-177** and records **F-166 / F-167 recurrences**.
- **P3-rung-N** — rung on the WP-530 P3 moat ladder (`plan.md` §7). rung-4 = ≥5-task benchmark slice scored against a baseline.
- **I-SR / D-SR** — Initial Success Rate / Dependency-adjusted Success Rate (fraction of requirements satisfied; D-SR only counts a requirement whose prerequisites also passed).
- **R1…R4** — a benchmark task's check-graded requirements.
- **probe check** — a grading `check` that WRITES its own test file into the workspace (`brownfield-003` R4). The F-164 contamination source WP-535 closed.
- **`agy`** — the Antigravity Gemini CLI binary the `gemini-cli` executor drives in `--print` mode.

## Suite result

| Task | Run id | Outcome | Reqs | Steps | Wall | Rollbacks |
|---|---|---|---|---|---|---|
| brownfield-001 (zodios zod 3→4 major upgrade) | `run-7f576f26-4ee2-482d-b79a-32dbd59c8873` | 🟢 SUCCESS | 3/3 | 11 (0–10) | 33m 09s | **3** |
| brownfield-002 (gitify cross-cutting refactor) | — | ⚪ SKIPPED | — | — | — | — |
| brownfield-003 (zod `.default()` Map/Set sharing) | `run-c6216ebb-c5db-4abb-ab3c-3d530002d533` | 🟢 SUCCESS | 4/4 | 2 (0–1) | 3m 13s | 0 |

brownfield-002 is `status: blocked` by design (F-163: target pins
`engines.node >=24`, devbox provides node 22). The skip is correct behavior,
not a failure — but it is why the runnable corpus is **2, not 5**.

## Trace excerpt (journal = ground truth)

**brownfield-001** — 61 journal entries, 11 steps, 11 judge passes, 3 compactions:

| step | wall | tok in/out | diff bytes | commit | judge verdict |
|---|---|---|---|---|---|
| 0 | 24s | 666 / 336 | 0 | `a72cc3f` | PROCEED (R1 ✗) |
| 1 | **5m 06s** | 1,079 / **21** | 510,536 | — | (no pass) |
| 2 | 3m 01s | 1,142 / 128 | 3,021 | — | **ROLLBACK** (R1–R3 ✓, scope ✗) |
| 3 | 3m 41s | 1,294 / 568 | 362,905 | — | (no pass) |
| 4 | 3m 02s | 1,881 / 1,862 | 6,562 | `120f539` | **ROLLBACK** (R1–R3 ✓, deletions/scope ✗) |
| 5 | 27s | 3,869 / 586 | 0 | `fb47848` | PROCEED (R1 ✗, R2 DID-NOT-COMPLETE) |
| 6 | 11s | 4,095 / 338 | 0 | `465a598` | PROCEED (R1 ✗) |
| 7 | 15s | 4,287 / 313 | 0 | — | **HALT** → remediation brief |
| 8 | **5m 04s** | 4,552 / 1,193 | 511,995 | `159d90a` | PROCEED (R1–R3 ✓) + completion review |
| 9 | 1m 10s | 5,439 / 532 | 0 | `9aa7e8b` | **ROLLBACK** (deletions/scope ✗) |
| 10 | 27s | 3,873 / 406 | 0 | `19298c9` | PROCEED (R1–R3 ✓) → SUCCESS |

- **Totals:** 377,215 in / 19,232 out · **$0.0000** (see F-167 recurrence) · terminal SUCCESS at `run-7f576f26-…@56`.
- **Judge share:** 282,510 of 377,215 input tokens = **74.9%**.
- **Compaction fired 3×** — 21,133→411, 20,409→599, 20,986→676 tokens (`stepIndex` 8/9/10). Context-rot mitigation working live over an 11-step horizon.
- **Remediation fired once** at step 7: `criterion R1 failed 3+ consecutive verdicts → HALT (goal drift / budget-waste guard)`; step 8 recovered to R1/R2/R3 all green.

**brownfield-003** — 10 entries, 2 steps, 1 judge pass:

| step | wall | tok in/out | diff bytes | commit | judge verdict |
|---|---|---|---|---|---|
| 0 | 1m 14s | 556 / 663 | 1,592 | `5ca79a5` (2 files, +22) | (no pass) |
| 1 | 52s | 1,223 / 879 | **0** | `57f001a` (**empty**) | PROCEED (R1–R4 ✓, 6/6 rubric ✓) → SUCCESS |

Totals: 29,190 in / 2,251 out · **$0.0000**.

## Delivery quality (human review, post-landing)

### brownfield-003 — 🟢 correct, root-cause, matches upstream

Landed diff vs pinned ref `b6b1288`:

```
packages/zod/src/v4/core/util.ts                  | +2
packages/zod/src/v4/classic/tests/default.test.ts | +20
```

```ts
export function shallowClone(o: any): any {
  if (isPlainObject(o)) return { ...o };
  if (Array.isArray(o)) return [...o];
+ if (o instanceof Map) return new Map(o);
+ if (o instanceof Set) return new Set(o);
  return o;
}
```

This is the upstream fix (PR #5855) — same function, same two branches. Both
regression tests (Map **and** Set) were written by the agent, in the
established `default.test.ts`, before the probe ever ran. R4's discriminator
was earned, not gamed. Scope is exact: no dependency changes, no drive-by
edits. **Best delivery the corpus has produced.**

### brownfield-001 — 🟢 requirements met, 🟡 one silent widening

Landed source diff vs pinned ref `6e6f3b3` (excluding `.yarn/`):

| file | change | assessment |
|---|---|---|
| `package.json` | `zod` 3.22.4→**4.4.3**, peer `^3.x`→`^4.0.0`, `typescript` 5.2.2→**5.5.4**, `@types/node` 20.8.9→20.14.9 | ✅ exactly the documented three-way break |
| `src/api.ts` (×2) | `as z.Schema<…>` → `as unknown as z.Schema<…>` | ✅ the documented v4 narrowing fix |
| `src/zodios.test.ts`, `src/plugins/zod-validation.plugin.test.ts` | error-shape oracles updated to real v4 text (`"Invalid input: expected string, received undefined"`), field order `expected` before `code` | ✅ updated, not deleted — R2's 117-test invariant held |
| `src/utils.types.ts` | `NarrowNotZod<T> = Try<T, ZodType, …>` → `Try<T, { safeParse: any }, …>` | 🟡 **a type-strictness widening no requirement can see** (F-177) |

The last row is the one a human should care about: a nominal `ZodType` guard
was replaced with a structural `{ safeParse: any }` duck-type. It compiles, all
117 tests pass, and the judge explicitly reviewed and accepted it
("type adjustment … plausibly related to the major upgrade"). It is defensible
— zod v4 rebuilt its internals — but it is exactly the class of change the
task's own preamble warns about (*"type-green ≠ behavior-preserved"*), and
**no requirement in the task can detect it**.

Residue in the graded workspace: `package-lock.json` untracked, `yarn.lock`
rewritten (3,822→5,369 lines), hundreds of `.yarn/cache/*.zip` added. See
F-173 — this is the harness's and the task's doing, not the agent's.

## New friction

### 🔴 F-172 — `agy --print-timeout` defaults to 5m; the executor never passed it, so every step >5 min was silently truncated (HAND-FIXED)

- **Evidence.** `agy --help`: `--print-timeout  Timeout for print mode wait (default 5m0s)`. The bench step contract is `max_seconds: 840` (14m, `benchmarks/harness/src/adapter.ts:168`). Two brownfield-001 steps stopped at almost exactly 5 minutes: **step 1** 13:05:19→13:10:25 (**5m 06s**, 21 output tokens, 510KB uncommitted diff, summary `"No tool calls are needed; waiting for the background test runner task to complete."`) and **step 8** 13:27:25→13:32:29 (**5m 04s**, 512KB diff). Both are install-heavy steps cut off mid-work.
- **Why it is 🔴.** `agy` returns the partial answer with **exit 0**, so `runCliStep` sees a clean step, not a timeout — the truncation is invisible to the journal, the judge, and the operator. **64% of every granted step horizon was being discarded**, on the executor arm the durable-execution thesis is measured on. The empty-diff steps 5/6/7 and the resulting HALT are downstream of this.
- **Fix (this sitting).** `packages/sdk-ts/src/executors/gemini-cli.ts` now passes `--print-timeout ${input.limits.maxSeconds}s`; `runCliStep`'s SIGTERM at `maxSeconds` remains the real cap. Regression test `packages/sdk-ts/test/executors/gemini-cli.test.ts` ("passes --print-timeout equal to the step's maxSeconds") via a new opt-in `FAKE_ECHO_ARGV=1` mode on the shared fake CLI. 979 sdk-ts tests green.
- **WP:** none — hand-fixed. Re-measure step horizons on the next suite.

### 🟡 F-166 RECURRENCE — benchmark copy-back absolutizes the target repo's own symlinks (HAND-FIXED, root cause found)

- **Evidence.** brownfield-003's graded workspace shows 3 phantom ` M` files. `.cursorrules`, `CLAUDE.md` (`→ AGENTS.md`) and `README.md` (`→ packages/zod/README.md`) now point at `/Users/…/brownfield-003/.chikory/runs/run-c6216ebb-…/workspace/…`. mtime 09:40:48 — between the judge (09:40:29) and the grader (09:41), i.e. the copy-back.
- **Root cause (new).** `benchmarks/harness/src/adapter.ts:236` — `cpSync(finalWs, ctx.workspaceDir, {recursive, force})`. Node resolves a **relative** symlink against the **source** dir and writes it back absolute. Any target repo using symlinks gets a non-self-contained artifact whose links break the moment the run dir is pruned, plus 3 spurious dirty files polluting every scope rubric.
- **Fix (this sitting).** `verbatimSymlinks: true` added. 47 harness tests + tsc green.
- **WP:** none — hand-fixed (was already track-B).

### 🟠 F-173 — brownfield-001's R1 check runs `npm install` inside a Yarn Berry zero-install repo, and the judge then punishes the churn it caused

- **Evidence.** R1's check is `npm install --legacy-peer-deps --no-audit --no-fund`. zodios is Yarn Berry with a **committed** `.yarn/cache`. Running npm there writes `package-lock.json`, rewrites `yarn.lock` 3,822→5,369 lines, and churns hundreds of `.yarn/cache/*.zip`. The judge — correctly, by its own rubric — rolled that back **three times**: step 2 (`scope_matches_instruction` ✗: *"adds a very large collection of unrelated .yarn/cache archives"*), step 4 (`no_unrelated_deletions` ✗: *"wholesale replaces the Yarn v1 lockfile"*), step 9 (*"deletes a very large collection of tracked .yarn/cache/*.zip"* after the agent tried to clean up).
- **Cost.** ~23 of 33 minutes and 3 of 11 steps were spent oscillating on package-manager artifacts, not on the zod upgrade. The HALT at step 7 is a direct consequence.
- **Why it matters beyond one task.** We are about to publish these numbers (WP-303/304). A task whose grading check picks a fight with its own target repo does not measure agent capability.
- **WP:** track-B under **WP-302** (task authoring) — either switch R1 to `yarn install --immutable` / `corepack`, or exclude lockfile+cache paths from the diff evidence the judge scopes over. Codify in `benchmarks/tasks/AUTHORING.md`: *a task's install check MUST use the target repo's own package manager.*

### 🟡 F-174 — the judge gave opposite verdicts on the same artifact class within one run

- **Evidence.** `.yarn/cache/*.zip` additions: **FAIL** `scope_matches_instruction` at step 2, **FAIL** `no_unrelated_deletions` at step 4, **FAIL** both at step 9 — but **PASS** at step 8 (*"visible dependency-cache changes are consistent with reinstalling dependencies for the upgrade"*) and **PASS** at step 10's completion review (*"consistently represent dependency-management artifacts"*), with the artifacts still present. The run terminated SUCCESS with the cache additions the judge had twice rolled back.
- **Why it matters.** The rollback signal is not reproducible over identical evidence, so "judge true-positive" is not a countable KPI on this arm. Partly downstream of F-173 (the evidence really is ambiguous), partly a prompt-stability problem.
- **WP:** track-B note. Revisit after F-173 removes the ambiguous evidence; if it persists on clean evidence, it becomes a real judge-consistency WP.

### ℹ️ F-175 — the harness grader has no hermeticity cleanup, so the probe survives into the archived artifact

- **Evidence.** `packages/zod/src/v4/classic/tests/__root-cause-check.test.ts` is present and **untracked** in the archived brownfield-003 workspace, mtime **09:41:10** — the grader phase (13:41 UTC), *after* the judge phase ended 13:40:29. The judge-phase copy was correctly removed (WP-535 works, see below).
- **Impact.** Does not affect this run's grades — R4 runs last, and the grader's R2 output lists only `default.test.ts`. It does mean the archived workspace is not re-gradable: a re-run of R2 would find the leftover probe via `git add -A -N .` and could satisfy `test -n "$NEW"` with the judge's own file.
- **WP:** track-B residue on **WP-535** — wrap `benchmarks/harness/src/grade.ts`'s `runCheck` loop in the same `planCheckSideEffectCleanup` snapshot/restore that `judge/evidence.ts` already uses.

### ℹ️ F-176 — `parseAgyOutput` recovers no tool count and no outcome summary

- **Evidence.** `toolCalls: 0` on **all 13 steps across both runs**, while real edits landed. Every step summary is future-tense plan text — *"I will run `git status` to see the current state…"*, *"Please review this plan:"* — not what the step did.
- **Impact.** The F-11/WP-221 wasted-step metric is blind on the directive arm (an empty-diff step and a productive one both report 0 tool calls), and `chikory trace` is unreadable for a human on gemini runs. `agy --print` emits plain text with no event stream, so this needs either a structured output flag or a summary-extraction pass.
- **WP:** track-B note under WP-221. No WP yet — needs an `agy` capability check first.

### ℹ️ F-177 — brownfield-001 has no type-strictness or lint requirement, so an `any` widening grades clean

- **Evidence.** `src/utils.types.ts`: `Try<T, ZodType, …>` → `Try<T, { safeParse: any }, …>`. R1 (install), R2 (117 jest tests), R3 (`tsc --noEmit -p tsconfig.build.json`) are all green with it, and the judge accepted it.
- **Impact.** The task's stated thesis is *"type-green ≠ behavior-preserved"* — but the grading cannot see a deliberate weakening of the type surface. On a corpus we intend to publish, that is a credibility gap.
- **WP:** track-B under **WP-302** — add an eslint/`no-explicit-any`-delta or a `tsd`-style type-level requirement to `brownfield-001`. Not retro-editable on an already-run spec's `goal`, but a new requirement is additive.

### Recurrences (no new number)

- **ℹ️ F-167 → now whole-suite.** Total metered cost **$0.0000** across **406,405 input + 21,483 output tokens**, both arms: the `gemini-cli` executor is subscription-metered (`costEstimated: true`, `subscriptionCost: included-in-plan-or-zero-wire-cost`) and the codex judge proxy is `pricing: "static-price-table-or-zero"` with `model: "default"`. F-167 was written as a judge-only problem; on the directive arm **there is no priced stage at all**. `judge.max_cost_share` and the budget gate are fully inert, and WP-303/304's "cost per success" cannot be computed for the arm we actually publish. Escalate from ℹ️ to 🟡 when WP-304 starts.
- **✅ F-165 did NOT recur.** The capability journal confirms code stage `adapter: "gemini-cli"`, `family: "gemini"`, binary `agy`; plan/judge/review all `openai-compat` via `http://127.0.0.1:8787`. WP-536's preflight plus `scripts/bench-run.sh` fixing `BACKEND=codex` held.

## Anomaly hunt (checklist)

- **Wasted/filler steps:** 🔴 **6 of 13** steps produced a zero-byte diff (bf-001 steps 5, 6, 7, 9, 10; bf-003 step 1 — an *empty commit* `57f001a`). Root causes: F-172 truncation (steps 1, 8 did work but got cut) and F-173 oscillation (steps 5–7, 9–10 were rollback recovery). bf-003's step 1 is a plain "already done" step.
- **Cost telemetry:** 🔴 inert — see F-167 recurrence above.
- **Token economics:** bf-001 executor input climbed 666 → 5,439 over 11 steps (compaction pinned it under ~5.5K). Judge input is flat ~19–34K per pass and dominates at **74.9%** of all input tokens. bf-003: 29,190 in over 2 steps, judge = 27,411 (93.9%).
- **Judge behavior:** ✅ checks genuinely executed — every justification carries `judge-executed check \`…\` exited 0/1`. 11 passes, 3 ROLLBACK, 1 HALT, 7 PROCEED. Rollbacks were real scope catches, but 🟡 not self-consistent (F-174). One `DID-NOT-COMPLETE (infra, killed at the per-check cap)` on R2 at step 5 — correctly classed as infra, no false red (F-141 family). Family diversity real: gemini executor vs GPT-5 judge.
- **Loop integrity:** ✅ no duplicate journal entries, no re-executed steps, checkpoint chain unbroken (`@5 → @8 → @13 → @16 → @21 → @26 → @31 → @36 → @42 → @50 → @56`), terminal cites `@56`. Rollbacks verifiably reverted the tree (step 5's commit records the reverted state; the step-2 and step-3 commits are absent from history).
- **Human ceremony:** ✅ **lowest yet** — one `devbox run bench-run` and nothing else. No relaunch, no mid-run hand-holding, no env fiddling. The new `scripts/bench-run.sh` (Temporal + codex proxy + directive arm in one process) is why.
- **Harvest integrity:** 🟡 F-166 recurrence (3 symlinks), ℹ️ F-175 (probe leak). The 2.4 GB result dir is `node_modules`-heavy but `benchmarks/results/` is git-ignored by design.

## What this run PROVES

1. **✅ WP-535 (hermetic judge checks) is live-proven — F-164 closes.** dogfood-112 landed it against pre-fix code and left it ⏳ *"NOT yet proven in the wild."* Now proven on the real contamination path:
   - `git ls-tree -r HEAD | grep -c __root-cause-check` = **0** — the probe is in **no** checkpoint commit.
   - The graded commit `5ca79a5` contains exactly the agent's 2 files.
   - The probe's only on-disk copy has a **grader-phase** mtime (09:41:10 > judge end 09:40:29) — the judge-phase copy was cleaned.
   - The grader's R2 detail lists only `default.test.ts` — R2 was satisfied by the agent's test, not the judge's.
2. **✅ Self-heal fired on real third-party code for the first time.** bf-001 step 7: 3 consecutive R1 failures → HALT + remediation brief → step 8 recovered R1/R2/R3 to green → SUCCESS. Every prior self-heal proof was a chain seam (dogfood-104/105/106); this one is an unseeded failure on someone else's repo.
3. **✅ Compaction under horizon.** 3 compactions, ~20K→~600 tokens each, on an 11-step 33-minute run — with no loss of task grip (the post-compaction steps are the ones that recovered).
4. **✅ Directive arm end-to-end.** Gemini executed, Codex judged, zero Claude, zero API keys, one command.

## What this run does NOT prove

- **P3-rung-4 is NOT climbed.** rung-4 = *≥5-task benchmark slice vs a baseline, score RANGE*. This suite is **2 runnable tasks** (bf-002 blocked on F-163/WP-534; brownfield-004/005 do not exist) and **no baseline arm** has ever run (WP-304 🔴, never started). Ledger `rung=3` — a **repeat** of rung 3, on a better arm.
- **100% is not a capability claim.** Two tasks, n=1 each, no baseline. Per `benchmarks/README.md`'s own publication rule (ranges not points, n≥3 per cell), this number is not publishable.

## KPI table (DOGFOODING §1.4)

| KPI | This suite | Trailing-3 | Target / phase gate |
|---|---|---|---|
| Max horizon survived (steps) | **11** (bf-001) | trailing-3 max 11 vs prior-3 max 3 | ≥10 sustained |
| Max horizon survived (wall) | **33m 09s** | 16m → 33m | 1h+ then 24h |
| Kill→resume count | 0 | 0 | resume proven (rungs 1–2 ✅) |
| Judge true-positives pre-land | 3 ROLLBACK (scope) — 🟡 not self-consistent, F-174 | 0, 0, 3 | rising |
| Trailing-3 meta:product headline ratio | **0/3 harness-meta** | 0/3 | ≤1 per 3 (§1.5) ✅ |
| Per-step reliability (runs ≥5 steps) | 93.8% (8 rollbacks / 128 steps, 17 runs) — **down** from 95.7% | 95.7% → 93.8% | **99%+** |
| Current-phase ladder rung | **3** (repeat) | 3, 3, 3 | rung-5 = P3 exit gate |
| Metered cost | **$0.0000** / 427,888 tokens | — | 🔴 unmeasurable (F-167) |

## Verdict on the thesis

- **The moat mechanisms all fired, unprompted, on third-party code.** Durable
  checkpointing, judge-driven rollback, HALT→remediation self-heal, and
  compaction each did real work inside one 33-minute run on a repo nobody on
  this project has touched. That is the strongest single piece of evidence the
  loop has produced for "durable execution + in-loop judge beats a bare agent."
- **The judge is the expensive half and the unstable half.** It is 74.9% of
  token spend and it contradicted itself on identical evidence (F-174). Both
  numbers need to come down before publication.
- **The benchmark is the bottleneck now, not the substrate.** Nothing in the
  runtime blocked rung-4 this session — the corpus (2 runnable of 5) and the
  missing baseline arm did. Two of the three requirements-level problems found
  here (F-173, F-177) are *task-authoring* defects that would embarrass a
  published leaderboard.
- **Progression gate: ⛔ STALLED before this suite's rows, ✅ PROGRESSING after
  them.** The pre-append verdict was STALLED (rung 3→3→3). Appending
  `bench-20260725`'s two rows flips it to **✅ PROGRESSING** on the horizon axis
  — trailing-3 max steps **11 vs prior-3 max 3** — with a standing
  ⚠️ **LADDER PACE** warning that the rung has not advanced. Under ✅ the default
  candidate is the next ladder rung; **rung-4 cannot be run at a 2-task corpus**,
  so the headline is its single named unblock: **WP-534** (per-target node
  provisioning → bf-002 runnable → corpus 2→3). Per-step reliability moved the
  wrong way: **95.7% → 93.8%** (8 rollbacks / 128 steps), all 3 new rollbacks
  from the F-173 package-manager churn.
