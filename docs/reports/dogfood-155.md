# dogfood-155 — a step's handover note now points at files that still exist tomorrow (WP-606)

**WP:** WP-606 (a step summary must carry refs that outlive the run; F-390) · **Date:** 2026-08-18 ·
**Spec:** `examples/dogfood/dogfood-155-wp606-summary-carries-usable-refs.yaml` ·
**Run:** `run-c1f1b066-d59e-4f8e-848f-2b1508b2ba7b` · **Landed:** this review's commit ·
**Ladder:** rung 0 (off-ladder) — P3's ladder is WP-530 (moat ladder) and its next rung, rung-5, is an
operator-run multi-hour suite, not an agent-runnable spec

## Plain lead

Every step of an agent run writes a note that the next step reads. A third of that note used to be
long web-style links into a scratch folder that gets deleted the moment the run ends. After this run
the note names files the way the rest of the project does — a repo-relative path plus its line range — and nothing
points into a folder that no longer exists. Measured against the previous run's own saved note, the
change removes **1,654 of 6,660 bytes (24.8%)** and all **15** dead links, without touching a single
path that belongs to somebody else.

The run also did the thing the whole product is for: the judge read the first attempt, found a real
duplicated call the tests could not see, and the loop fixed it before anything landed.

## Trace

| field | value |
|---|---|
| terminal | 🟢 SUCCESS · 3 steps · 13m 5s |
| cost | **$0.2235** of $20 budget (**1.1%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — ⚠ cost meter blind: 5,884 tokens metered, $0.00 priced (CLI OAuth, no per-token price) |
| judge | `openai-compat` (`gpt-5.6-sol` xhigh) · 5 passes |
| verdicts | rollbacks 0 · escalations 0 · resumes 0 |
| checkpoints | 3 · injections 0 · pacing events 3 · peak window 1% |
| acceptance | AC-1 PASS · AC-2 PASS · AC-3 PASS (re-run in the working tree (brownfield — harvested delivery)) |
| harvest | 2/2 files byte-**IDENTICAL** to the run workspace |

**Per-step** (the facts pack records the FIRST judge pass per step; steps 1 and 3 each drew a
second, cumulative-design pass — component timeline `s0 j@0 j@0 s1 j@1 s2 j@2 j@2`):

| # | tokens in/out | cost | wall | diff | verdict(s) |
|---|---|---|---|---|---|
| 1 | 4.4k/1.5k | $0.0000 | 3m 39s | 16,600 B | pass #1 ✓ PROCEED (3/3) · pass #2 ✓ PROCEED (0/0) with `cumulative_design_coherent` ✗ |
| 2 | 6.1k/856 | $0.0000 | 1m 2s | 544 B | pass #3 ✓ PROCEED (2/3) — AC-3 exited 1 |
| 3 | 6.9k/1.3k | $0.0000 | 1m 0s | 2,194 B | pass #4 ✓ PROCEED (3/3) · pass #5 ✓ PROCEED (0/0), `cumulative_design_coherent` ✓ |

No empty-diff probe step — **F-11 (wasted probe step) did not recur**.

## Delivery quality (human review, post-landing)

**Landed files** (2, both named or trivially entailed by the goal):

| file | change |
|---|---|
| `packages/sdk-ts/src/executors/step.ts` | +67/−5 — `normalizeWorkspaceRefs` (`:46`), applied once at the shared seam (`:216`), every branch reads `base.summary` (`:238`, `:261`, `:286`, `:314`) |
| `packages/sdk-ts/test/executors/summary-refs.test.ts` | new, 305 lines, 10 tests |

**Goal, line by line.**

| goal clause | verdict | evidence |
|---|---|---|
| refs inside the workspace become workspace-relative **and keep their lines** | 🟢 | `src/executors/step.ts:46`; both `#L106-L147` and bare-`:106-147` spellings collapse to `path:106-147` |
| both emitted spellings handled (`file://…#L…` URL and bare absolute path) | 🟢 | proven on real data below; unit rows for `#L1-L10`, `#L1-10`, `#1-10`, `#L5`, `#5`, `:1-10`, `:5` at `test/executors/summary-refs.test.ts:274` |
| it happens **once, at the site that knows the workspace root** | 🟢 | `src/executors/step.ts:216` inside `runCliStep`; `codex.ts:145`, `claude-code.ts:199`, `gemini-cli.ts:147` all route through it and were **not edited** |
| `StepRecord` shape unchanged | 🟢 | value change only; `StepRecordSchema` untouched |

**Independent verification the ACs did not do — the normaliser run against the REAL previous-run
summary.** The premise was measured off `run-f7735f50-…`'s own persisted step record; I re-read that
record and fed it through the delivered `normalizeWorkspaceRefs` with that run's real
`workspaceDir`:

| metric | before | after |
|---|---|---|
| summary bytes | 6,660 | 5,006 (**−1,654, −24.8%**) |
| `file://` URLs | 15 | **0** |
| absolute-workspace mentions | 15 | **0** |
| line information | `#L106-L147` | `:106-147` — preserved on every rewritten ref |

Nine lines changed and no others; e.g.
`[…](file:///Users/…/run-f7735f50-…/workspace/packages/sdk-ts/src/judge/harness.ts#L106-L147)` →
`[…](packages/sdk-ts/src/judge/harness.ts:106-147)`. Nothing outside the workspace moved.

**The four designed traps — all rejected:**

| trap | verdict | evidence |
|---|---|---|
| a path **outside** the workspace is left exactly as written | 🟢 | `https://…#L10-L20`, `/etc/hosts` and a **sibling** dir `"<ws>-sibling/other.ts"` all survive (`test/executors/summary-refs.test.ts:124`); the trailing lookahead makes `<ws>-sibling` fail to match at all |
| the transcript artifact is not rewritten | 🟢 | raw stdout with the absolute URL still in the artifact while `record.summary` is normalised (`test/executors/summary-refs.test.ts:169`) |
| nothing-to-normalise comes back **byte-identical**; empty stays empty | 🟢 | `test/executors/summary-refs.test.ts:200`, `:222` |
| the `agy` envelope strips stay in the adapter | 🟢 | `NOTIFICATION_BLOCK`/`GMSG_NOTIFICATION_BLOCK` untouched at `src/executors/gemini-cli.ts:52,62`; AC-2 greps both |

**Tests are not a copy of the grading checks (F-360).** The repo suite adds three cases the ACs never
asked for: the sibling-directory near-miss, a **FAILED**-branch record, and seven line-syntax
variants. Suite **1,588 → 1,598 passed | 23 skipped**, 194 files — +10, over AC-3's floor of 1,592.

**Scope discipline** 🟢 — 2 files, no dependency change, no Python mirror, no `StepRecord` contract
change, escape guard (F-192) and pacing policy untouched (AC-3 greps both).

**⚠️ This run could not exercise its own fix (F-197).** The harness executing the run is HEAD-at-launch,
so all three of this run's summaries still carry the old shape — measured from its journal:
**14,637 B across 3 summaries, 34 `file://` URLs, 4,781 B = 32.7%**. The signature to check next
review: read `record.summary` out of the next run's journal (`kind='step'`) and expect **0** matches
of `file://…/workspace/`.

## New friction

### F-392 🟡 — the `native` executor adapter does not inherit the shared-site fix

`native` is a first-class registered adapter (`src/agents/registry.ts:70`,
`src/endpoint-capability.ts:10`), built by WP-213 (raw-LLM in-process loop). It does **not** go
through `runCliStep`: it builds its own record at `src/executors/native.ts:248`. So the WP's stated
outcome held for 3 of the 4 registered adapters. The goal named only the three CLI adapters, so the
run met its spec — this is a coverage gap in the WP, not a delivery defect. **HAND-FIXED this
sitting.**

### F-393 🟡 — AC-3's structural grep is a *spelling* oracle, and it fought the judge

AC-3 greps `summary: parsed\.summary|summary: [A-Za-z]+\(` over `step.ts`. Judge pass #2 raised a
genuine finding — the delivery computed `const summary = normalizeWorkspaceRefs(…)` and then called
`normalizeWorkspaceRefs(…)` a **second** time building `base`. Step 2 fixed it by reusing the
variable via the ES6 shorthand `summary,` — strictly better code — and AC-3 exited 1 with
*"src/executors/step.ts no longer builds StepRecord.summary from the parsed result"*. That is a
**false RED**: the shared seam was intact; only the spelling changed. Step 3 (1m 0s, 2,194 diff
bytes, judge passes #4+#5 = **$0.0796**, 36% of run spend) existed solely to restore a
grep-matching spelling. The two graders disagreed about correct code, and the AC won.

### F-394 ℹ️ — `escapeRegex` duplicated

`src/executors/step.ts:36` re-implements, byte-for-byte, the `escapeRegExp` already at
`src/planner/literal-preservation.ts:117`. The existing one is module-private, so it could not be
imported without exporting it. Cosmetic.

### ℹ️ Recurrences, not new items

- **F-391 (no live `concernSeverities` datum) recurs for a 4th straight run.** All 5 persisted
  verdicts carry `kind,form,rationale,costUsd,tokens,judgeModel` and no `concerns` array. Note the
  adjacent mechanism *did* work: a **rubric** failure (not an out-of-rubric concern) rode into the
  next step and was repaired.
- **F-306/F-387 (executor self-narration) stays small.** Step 3's summary opens with *"I have
  launched the typecheck command and will wait for it to complete."* — 78 bytes. Consistent with the
  2.2% re-measurement; not the story.

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-392 | 🟡 | the `native` adapter builds its own `StepRecord` and never applied the new normalisation | **HAND-FIXED THIS SITTING** — `src/executors/native.ts:245` (normalise once, reused by `claimsComplete` and the failure reason); 1 new test at `test/executors/native.test.ts:130`, verified **RED** against the pre-fix file and **GREEN** after |
| F-393 | 🟡 | an AC grep pinned a code *spelling*, false-RED'd strictly better code, and cost a step + $0.0796 | **track-B note** — rule recorded in DOGFOODING §7; no WP (spec-authoring discipline, not product code) |
| F-394 | ℹ️ | `escapeRegex` duplicates `escapeRegExp` (`src/planner/literal-preservation.ts:117`) | **track-B note** — export the existing helper next time either file is opened |

## Verdict on the thesis

🟢 **The judge earned its cost this run.** The acceptance checks all passed on step 1 and would have
sealed the run there. The *cumulative-design* pass — a different altitude, reading the whole diff
rather than the criteria — found a duplicated call, said so, did not gate, and the executor repaired
it in the next step; pass #5 confirmed the repair. That is a real true-positive from an
Agent-as-a-Judge running **in the inner loop**, on a delivery whose own tests were green. It is the
first repair-driving catch since dogfood-152.

🟡 **The caution is that the same loop then burned a step un-doing that repair's spelling** (F-393).
An acceptance criterion that grades *how the code is written* can outrank a judge finding about
*whether the code is right*. AC-1/AC-2 owned their oracles and behaved; AC-3's structural greps are
the cheap half of the oracle and they are where the false RED came from.

ℹ️ **Off-ladder for a 17th run.** P3's rung-5 needs an operator-run multi-hour benchmark suite
(WP-304's OpenHands arm plus a corpus wide enough to separate 19 requirements at 95% confidence).
It has not been agent-runnable since dogfood-139, and the progression gate will keep reading STALLED
until a human runs it.

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | **3 steps** / 13m 5s | 3 (dogfood-149) over the trailing 3+3 |
| kill → resume count | 0 | 0 across the last 8 runs |
| judge true-positives pre-land | **1** (duplicate `normalizeWorkspaceRefs`, pass #2 → repaired step 2 → confirmed pass #5) | 3 in 9 runs (149, 151, 152, 155) |
| meta:product headline ratio | 0:1 (product) | **0/3 harness-meta** — cap ≤1/3 not busted |
| per-step reliability (runs ≥5 steps) | n/a (<5 steps) | 94.7% — 9 rollbacks / 170 steps, 21 runs (target 99%+) |
| ladder rung vs exit gate | **0** (off-ladder) | P3 exit gate = WP-530 rung-5, operator-run, unmoved since dogfood-139 |

## Next run — dogfood-156 (WP-618)

**Target, in plain English:** when a chain runs several agents in sequence and one of them was never
actually checked — its test suite was killed by the clock, so nobody learned whether the code is
good — the chain will write that down and show it, instead of folding the node in as an ordinary
success the next agent then builds on.

| field | value |
|---|---|
| spec | `examples/dogfood/dogfood-156-wp618-inconclusive-survives-fanin.yaml` |
| WP | WP-618 (a node's inconclusive outcome must survive the fan-in; F-332) |
| format / mode | LOOSE · RUN (single node) |
| suite baseline | **1,599 passed \| 23 skipped, 194 files**, measured under devbox at the launch commit; AC-3 floor 1,603 |

**Why this and not the ladder rung.** §0 reads ✅ **PROGRESSING** (max steps 3 vs 2), so the default
candidate is P3's ladder rung. Rung-5 of WP-530 (moat ladder) needs WP-304's OpenHands arm plus a
corpus wide enough to separate 19 requirements at 95% confidence — a quota-bound multi-hour
benchmark suite the **operator** runs by hand (dogfood-122: an LLM executor may not supervise it).
It has not been expressible as a spec since dogfood-139. WP-618 is product code on the chain pillar
(durable multi-run execution, WP-219) with a premise re-measured from the code at this review.

**The designed trap.** Add `inconclusiveCheck` to `NodeResult`, copy it in `readNodeResult`
(`src/chain/activities.ts:235`), and stop. Every unit test at the point of manufacture is green
while four hand-written field lists downstream — `chain-loop.ts:338`, `recordNodeSealed`'s payload
(`src/chain/activities.ts:294`), `NodeSealedPayload` (`src/chain/store.ts:78`) and `chainRecordFrom`
(`src/chain/store.ts:296`) — silently drop it, so nothing reaches disk or the operator. This is the
third consecutive run against that family (F-380 → F-388 → F-392). **The throwaway reference
implementation written during arming fell into it too**, at hop 5: `chainRecordFrom` folded the map
and then rebuilt `ChainRecord` from a hand-written field list that omitted it — AC-2 and AC-3 caught
it, which is the point.

**Gate verdicts.**

| gate | verdict | one line |
|---|---|---|
| §0 progression | ✅ | PROGRESSING; the ladder rung is operator-run and cannot be a spec, so a non-ladder candidate must beat it — WP-618 does, on the chain pillar |
| §1.1 failure surface | ✅ | one value crossing five hops across `chain/`, `cli/` and the chain journal; the plausible-and-wrong delivery is well documented and has landed three times |
| §1.2 product progress | ✅ | real open `plan.md` §6 product WP; no scaffolding, no invented utility |
| §1.3 mission-critical | ✅ PROCEED | not busy work, not scaffold-hosted — it closes a compounding-error hole in the chain substrate |
| §1.5 friction budget | ✅ | `class=product`; trailing-3 harness-meta headlines **0/3**, cap ≤1/3 not busted |

**AC arming evidence.** The launch preflight classes all three ACs VERIFY-SUITE, so none dry-ran;
all three were hand-verified in **both** directions with `dogfood-arm.sh`:

| AC | RED on HEAD | GREEN vs reference | % of 120 s judge cap |
|---|---|---|---|
| AC-1 | ✅ exit **1**, 2s | ✅ exit 0, 2s | 2% |
| AC-2 | ✅ exit **1**, 2s | ✅ exit 0, 3s | 3% |
| AC-3 | ✅ exit **1**, 76s | ✅ exit 0, 75s | **63%** |

Every RED printed its own assertion text, not a died-before-judging signature — e.g. AC-1:
*"the chain must write down that this node's check never ran … expected
`{"nodeId":"N-1","outcome":{"status":"…` to contain `pre_existing_suite_still_green`"*. AC-2's first
draft was **repaired during arming**: its trap assertion segmented the rendered trace by string
offset and swallowed the shared topology line `N-2 <- N-1`, so it stayed RED against a correct
reference; it now asserts per line, and was re-verified RED after the repair.

Launch preflight is green at $0 and the spec-pick glob resolves to this file.
