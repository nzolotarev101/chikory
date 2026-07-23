# Benchmark review — brownfield suite `20260723-222341` (WP-533 live proof)

- **Kind:** benchmark-suite review (not a `dogfood-NNN` (numbered dogfood campaign) headline) · **Date:** 2026-07-23
- **Suite output:** `benchmarks/results/20260723-222341-chikory/` (gitignored)
- **Runs:** `run-8712271f-2d30-4f9e-9630-b33cc8d702e9` (`brownfield-001`) · `run-58b48706-2a64-4eff-969a-9c7c7c1d1e5a` (`brownfield-003`)
- **HEAD at launch:** `32764c4` (the gemini-cli default flip `20a2094`/`921b79d` landed 7 min AFTER launch — see F-165)
- **Ladder:** P3 moat ladder (`WP-530` — graduated proofs from chain self-heal to published benchmark numbers); **rung-3 repeated, rung-4 NOT climbed**
- **Verdict:** 🟢 **WP-533 (judge-driven step success) LIVE-PROVEN** · 🔴 **not a valid rung-4 baseline** — wrong executor family (F-165) + a grading-integrity contamination (F-164)

## Plain lead (vibe check)

The two hard real-world tasks that both ended in FAILED three days ago now both
end in **SUCCESS with a perfect score** — and we checked the work by hand, not
just the scoreboard: the zod bug fix is byte-for-byte the same root-cause fix
the real maintainers shipped, and the zodios dependency upgrade updated its
broken test assertions honestly instead of deleting them. That is the fix from
last session (`WP-533`) working in the wild.

Two things stop this from counting as a real benchmark result. First, the run
used **Claude as the coding agent**, not Gemini — the config change that flips
that default was committed *seven minutes after* the suite launched, so the run
loaded the old default and spent $2.71 of real Anthropic budget it shouldn't
have. Second, and more serious: **the judge's own test-probe file gets swept
into the graded commit**, which means one of the benchmark's requirements can
be satisfied by a file the judge itself wrote. Nothing went wrong here (the
agent did write a genuine regression test), but a benchmark we intend to
publish cannot ship with a requirement that can grade itself.

## Glossary (IDs used here)

- **WP-n** — work package (`plan.md` §6/§7 backlog row).
- **F-n** — global sequential friction id (this review adds F-164…F-167).
- **I-SR / D-SR** — Instance / Dependency Success Rate (share of grading requirements satisfied; D-SR only counts requirements whose prerequisites also passed).
- **R1–R4** — a benchmark task's grading `check`s (install / tests / typecheck / anti-gaming discriminator).
- **P3-rung-N** — rung on the P3 moat ladder (`plan.md` §7, WP-530). rung-3 = one task scored end-to-end; rung-4 = ≥5 tasks vs a baseline.
- **probe / discriminator check** — a grading `check` that WRITES its own test file into the workspace so it can't be gamed by the agent's test layout (`brownfield-003` R4, `brownfield-002` R4).
- **judge cadence / completion milestone** — the judge runs every `judge.cadence` steps OR when the executor claims done (`agent-loop.ts:743-757`).

## Suite summary

| Metric | `brownfield-001` (zodios) | `brownfield-003` (zod) | Suite |
|---|---|---|---|
| Chikory run-id | `run-8712271f-…` | `run-58b48706-…` | — |
| Terminal state | 🟢 SUCCESS | 🟢 SUCCESS | — |
| Grade (I-SR / D-SR) | 🟢 3/3 = 100% / 100% | 🟢 4/4 = 100% / 100% | **7/7 = 100% / 100%** |
| Steps | 2 | 1 | 3 |
| Cost | $1.8520 / $25.00 | $0.8555 / $25.00 | **$2.7075** |
| Wall clock | 10m 19s (619,365 ms) | 5m 01s (301,828 ms) | 16m 04s |
| Executor (journal) | 🔴 `claude-code` / `anthropic` | 🔴 `claude-code` / `anthropic` | 🔴 directive says Gemini |
| Judge (journal) | 🟢 `openai-compat` (codex proxy) | 🟢 `openai-compat` (codex proxy) | family-diverse ✅ |
| Judge passes | 1 (at step 1, completion milestone) | 1 (at step 0, completion milestone) | 2 |
| Verdicts | PROCEED (3/3 criteria, 6/6 rubric, 0 concerns) | PROCEED (4/4 criteria, 6/6 rubric, 0 concerns) | 0 ROLLBACK, 0 ESCALATE |
| Judge true-positive catches | 0 | 0 | 0 (both deliveries were correct) |
| `brownfield-002` | — | — | 🟡 SKIPPED (`status: blocked`, F-163 node-engine wall) |

### Per-step economics (journal = ground truth)

| Task | step | tokens in | tokens out | cost | commit | note |
|---|---|---|---|---|---|---|
| bf-001 | 0 | 2,617,539 | 9,710 | $1.4982 | `dab58ef` | whole zod v4 upgrade + lockfiles |
| bf-001 | 1 | 504,733 | 3,224 | $0.3538 | `13b1bff` | last stale test oracle (`src/zodios.test.ts`) |
| bf-001 | judge | 28,312 | 901 | **$0.00** | — | 29,231 ms; evidence diff 450,058 B |
| bf-003 | 0 | 1,430,526 | 8,389 | $0.8555 | `c6a99d74` | fix + both regression tests, one shot |
| bf-003 | judge | 26,173 | 581 | **$0.00** | — | 42,127 ms; evidence diff 1,729 B |

- Input tokens are the CLI's **cumulative per-turn** count (context re-sent each turn), not a single prompt — 2.6M on one step is normal for a ~25-turn agentic step, not a context-rot signal.
- Judge cost is structurally $0 (keyless CLI proxy, `judgeModel {provider:"openai-compat", model:"default"}`) → **judge cost share is unmeasurable**, see F-167.

## Delivery quality (human review, post-landing)

Both deliveries were re-verified **independently against the copied-back workspaces**, not trusted from the grader's green.

**`brownfield-003` (zod `.default()` shares mutable Map/Set) — 🟢 genuine, root-cause.**

- Fix (`packages/zod/src/v4/core/util.ts:399-405`) adds exactly two branches to `shallowClone`:
  ```
  +  if (o instanceof Map) return new Map(o);
  +  if (o instanceof Set) return new Set(o);
  ```
  This is the same root cause and the same shape as the real upstream fix (PR #5855) — a generic clone-utility gap, not a `.default()`-site special case. It therefore also fixes `.prefault()` and the mini build, which the agent's own summary calls out correctly.
- Regression tests (`packages/zod/src/v4/classic/tests/default.test.ts:335-356`) cover **both** Map and Set, each asserting identity (`not.toBe`) *and* non-leakage (`result1.set/add` → `result2.has(...) === false`). Not a narrow patch; R4's Set discriminator was already satisfied by the agent's own work.
- Independently re-run by this review: `vitest run --project zod packages/zod/src/v4/classic/tests/default.test.ts` → **18 tests × 2 projects = 36 passed, no type errors, 1.63 s**.
- Executor step diff artifact is **1,729 bytes across exactly 2 files** — zero scope creep.

**`brownfield-001` (zodios: zod 3.22.4 → 4.x) — 🟢 genuine, all three stacked failure classes handled.**

| Failure class the task stacks | What the agent did | Verdict |
|---|---|---|
| Type-level break in app code | `src/api.ts:285,322` — `schema.partial() as z.Schema<…>` → `as unknown as z.Schema<…>` (×2) | 🟢 exactly the documented v4 remedy |
| Transitive toolchain floor | `typescript` 5.2.2 → 5.9.3, `@types/node` 20.8.9 → 20.19.43 | 🟢 clears the `NoInfer` ≥5.4 floor |
| Stale test oracles | `zod-validation.plugin.test.ts:254-262` + `zodios.test.ts:791-799` — reordered `expected`/`code` and rewrote messages to v4's `"Invalid input: expected string, received undefined"` | 🟢 **updated, not weakened or deleted** |

- Independently re-run by this review: `npx jest --coverage=false` → **total 117 · failed 0 · passed 117** (the task's anti-gaming count invariant holds), and `npx tsc --noEmit -p tsconfig.build.json` → **exit 0**.
- ℹ️ Scope noise (not a defect, no F): the agent used `npm install` in a `yarn.lock` repo, so a 6,487-line `package-lock.json` landed in the step-0 commit alongside a rewritten `yarn.lock`. The task's own R1 check runs `npm install`, so this is task-induced; worth a note in `AUTHORING.md` if more npm/yarn hybrids get pinned.

## Anomaly hunt

- **Wasted / filler steps:** none. 3 steps, 3 non-empty diffs, no "already done" step, no empty-diff probe step.
- **Loop integrity:** clean. No duplicate journal entries, no orphaned-workflow retries (the F-158 guard in `scripts/bench.sh` held), no resumes, checkpoint chain intact (`lastGood` set on both PROCEED checkpoints).
- **Judge behavior:** all 7 checks genuinely executed (`judge-executed check … exited 0` on each), rubric justifications reference actual diff content (not boilerplate), family diversity real (executor `anthropic` ≠ judge `openai-compat`/codex). 0 catches — correct, because both deliveries were correct.
- **Judge cadence:** one pass per run, both fired as `completionMilestone`, not cadence. On 1–2-step tasks "in-loop judging" and "end-of-run judging" coincide; that is by design (`agent-loop.ts:748-757`), not a regression, but it means these runs carry **no evidence about mid-flight judge intervention**.
- **Human ceremony:** launch + a monitoring cron + this review. No mid-run hand-holding, no relaunch. Down sharply from dogfood-108's 6 launch attempts.
- **Cost telemetry:** executor side priced correctly; judge side structurally $0 (F-167).

## New friction

### 🔴 F-164 — the judge's own probe file lands in the graded commit, and can self-satisfy a requirement

- **Evidence (three independent facts):**
  1. The executor's step-0 diff artifact (`…/artifacts/f39686ee…`, 1,729 B) contains **exactly two `diff --git` headers**: `default.test.ts` and `util.ts`. The judge's evidence diff is the same 1,729 B.
  2. The checkpoint commit `c6a99d74 "chikory: step 0"` contains **three** files — those two **plus `packages/zod/src/v4/classic/tests/__root-cause-check.test.ts`**, which is byte-identical to the heredoc inside `brownfield-003`'s R4 `check`.
  3. `agent-loop.ts:743-793` runs `activities.judgeStep` **before** `activities.writeCheckpoint`, so any file a judge-executed `check` writes is swept into that step's commit.
- **Why it matters:** `brownfield-003`'s R2 is `NEW=$(git diff --name-only <base> -- '*.test.ts'); test -n "$NEW"; for f in $NEW; do vitest run "$f"; done`. The judge's R4 probe **is** a new passing `*.test.ts`. An agent that fixes the bug and writes **no test at all** would still pass R2 on the judge's own file — a false green on the one requirement that certifies "the agent reproduced the bug". Same mechanism pollutes `brownfield-002` R4 (`src/renderer/__probe__/legacy-gone.probe.ts`).
- **Second-order harm:** the probe also enters the *next* step's judge evidence diff and the published artifact tree, so a delivered diff we might publish contains judge scaffolding.
- **WP it spawns:** **WP-535 — hermetic judge checks.** Judge-executed `check`s run against a scratch overlay (or their side-effect files are reverted before `writeCheckpoint`), so a check can never mutate the graded tree. Product surface (`packages/sdk-ts/src/judge/`), not harness-meta. Blocks any rung-4/rung-5 publication.

### 🟠 F-165 — F-162 recurrence: the suite ran Claude, not Gemini (the fix landed 7 min after launch)

- **Evidence:** both journals' capability entry records `code: {adapter:"claude-code", family:"anthropic"}`. Suite start `22:23:41Z` = `18:23:41 -0400`; the gemini-cli default flip is commit `20a2094` at `18:30:29` and `921b79d` at `18:31:14`, with `benchmarks/harness/dist/adapter.js` rebuilt at `18:30`. The running process had already loaded the pre-flip default.
- **Cost:** $2.7075 of real Anthropic spend. Under the keyless `gemini-cli` executor this suite is ≈ $0.
- **Why the existing plumbing didn't save it:** `adapter.ts:133` now defaults to `gemini-cli` and `main.ts:152` honors `--executor`/`CHIKORY_BENCH_EXECUTOR` — both correct, both landed too late. Nothing in the launch path *asserts* the resolved executor family before spending.
- **WP it spawns:** **WP-536 — bench launch family preflight.** `scripts/bench.sh` echoes the resolved `{executor, judge}` adapter+family before the first task and refuses to launch when they violate the standing directive (Gemini executes / Codex judges) unless `CHIKORY_BENCH_ALLOW_FAMILY_OVERRIDE=1`. Sibling of the F-119/120/121 launch guards. Track-B sized, but it is the second $2–5 directive burn in one day.

### 🟡 F-166 — workspace copy-back rewrites relative symlinks to absolute sandbox paths

- **Evidence:** in the copied-back `brownfield-003/workspace`, `git status --short` shows ` M .cursorrules`, ` M CLAUDE.md`, ` M README.md` — all three are symlinks whose target changed from `AGENTS.md` (relative) to `/Users/nikitazolotarev/repos/chikory/benchmarks/results/20260723-222341-chikory/brownfield-003/.chikory/runs/run-58b48706-…/workspace/AGENTS.md` (absolute, into the sandbox).
- **Why it matters:** the graded artifact is not self-contained — delete or prune the sandbox run dir and the copy's symlinks dangle. It also injects three phantom modified files into every scope/diff review of a delivered tree (this review had to rule them out by hand).
- **Fix:** copy-back in `benchmarks/harness/src/adapter.ts` must preserve symlinks as-is (`cp -R` semantics that do not resolve links / `fs.cp` with `verbatimSymlinks: true`). **Track-B hand-fix**, no WP.

### ℹ️ F-167 — judge spend is structurally invisible (F-9 family recurrence)

- **Evidence:** both judge passes record real token usage (28,312/901 and 26,173/581) with `costUsd: 0` and `judgeModel {provider:"openai-compat", model:"default"}` — the keyless CLI proxy reports no model id, so `pricing.ts` cannot price it.
- **Why it matters:** `judge.max_cost_share` is inert against a $0 judge, and the WP-303/304 publication rule "cost per successful task completion" would silently under-report by the judge's whole share.
- **Fix:** the proxy should surface its backing model id so the judge pass prices like any other. **Track-B note under existing cost-telemetry work**, no new WP.

### ℹ️ F-168 — the progression gate's STALLED message names the retired P2 ladder

- **Evidence:** with this suite's two ledger rows appended, `scripts/dogfood-progression.sh` prints `⛔ STALLED` followed by *"the next headline MUST be the current **WP-265** ladder rung (**plan.md §6** queue)"*. WP-265 is the **P2** horizon ladder, retired at rung 5 / dogfood-096; the current phase's ladder is **WP-530, `plan.md` §7**. The `rung` column is already phase-scoped — only the message is hard-coded.
- **Why it matters:** the gate is *binding*, so an operator or agent following its text literally is sent to a ladder that no longer exists. Sibling of 🟡 F-145 (the gate is chain-blind).
- **Fix:** parameterize the ladder id/section by current phase. **Track-B**, folded into the existing `dogfood-progression` note, no new WP.

## Gate verdicts for the next run (recorded)

| Gate | Verdict | Basis |
|---|---|---|
| §0 progression (mechanical, binding) | ⛔ **STALLED** | rung 3 → 3 → 3 over the trailing 3; no horizon / resume / looseness move either. Binding instruction: next headline **is** the current phase's ladder rung. |
| §0 ladder authored? | ✅ yes | P3 ladder = WP-530, `plan.md` §7, rungs 1–5. No new ladder owed. |
| §1.1 failure-surface | ✅ PASS | Cross-file (judge check runner + workflow ordering + a live proof) with a real destructive trap — the naive `git checkout .` fix destroys the executor's uncommitted delivery. |
| §1.2 product-progress | ✅ PASS | Lands in `packages/sdk-ts/src/judge/` — real open `plan.md` §7 WP-535 on the judge pillar. No scaffolding, no invented utility. |
| §1.3 mission-critical | ✅ **PROCEED** | Not busy work, not scaffold-hosted; it is the first of the three gates the rung-4 bullet itself names. |
| §1.5 friction-budget | ✅ PASS | `class=product`; trailing-3 harness-meta headlines 0/3, cap intact. |

**How STALLED was honored:** rung-4 as literally written (≥5 tasks scored vs a baseline) is not runnable in one campaign — it needs 3 more pinned+runnable tasks (WP-534), a baseline arm that has never run (WP-304), and a grader that cannot self-satisfy (WP-535). `dogfood-112` is recorded as **rung-4 work**: it is the first named gate on the rung-4 bullet in `plan.md` §7, on product code, not a detour around the ladder.

## KPI table (DOGFOODING §1.4)

| KPI | This suite | Trailing window | Target |
|---|---|---|---|
| Max horizon survived | 2 steps / 10m 19s | 8 steps (dogfood-105) | growing |
| Kill→resume count | 0 | 0 over trailing 3 | ≥1 per phase |
| Judge true-positives pre-land | 0 (both deliveries correct) | 1 over trailing 3 | opportunistic |
| Trailing-3 meta:product headline ratio | 0 harness-meta : 3 product | 0/3 | ≤ 1:3 ✅ |
| Per-step reliability (runs ≥5 steps) | n/a (no ≥5-step run) | 95.7% (5 rollbacks / 117 steps) | 99%+ |
| Current-phase ladder rung | **3** (repeat, 2 tasks scored) | rung-3 | rung-5 = P3 exit gate |

## Verdict on the thesis

- 🟢 **The WP-533 claim is now empirically true.** The exact two tasks that sealed FAILED on 2026-07-21 purely because `step.ts` mapped `exitCode !== 0` → FAILED now seal SUCCESS at 7/7. `brownfield-001` moved 2/3 → 3/3 with the judge's PROCEED no longer overridden. That is the durable-execution + judge loop doing its job end to end.
- 🟢 **Agent-as-a-Judge earned its keep on evidence, not vibes** — 7/7 checks genuinely executed inside the loop, and the rubric justifications quote real diff content.
- 🔴 **We cannot publish off this substrate yet.** A grading requirement that the judge can satisfy on its own behalf (F-164) is a credibility hole in exactly the artifact the P3 moat depends on. Fix it before rung-4, not after.
- 🔴 **Directive compliance is not enforced anywhere in the launch path** (F-165, second occurrence in one day, ~$7.7 burned across both).
- ⏳ **rung-4 remains 2 blockers away:** runnable corpus is 2/5 (`brownfield-002` blocked on WP-534 node provisioning) and no baseline arm has been run.
