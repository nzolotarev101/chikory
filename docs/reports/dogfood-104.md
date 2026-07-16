# dogfood-104 — WP-521 (chain heal-by-default) P3-rung-1 attempt: recovery-observability surface LANDED, chain self-heal KPI NOT exercised

- **Vibe check (plain):** Chikory ran a real three-step chain that built a new
  "how many retries did each chain step take?" summary surface for the chain
  trace — three well-designed, additive modules, every test green. **But the one
  thing this run existed to prove — a chain recovering from a mid-chain step
  FAILURE — never happened.** The deterministic force-fail switch
  (`CHIKORY_SEED_CHAIN_FAIL_NODE`) was not turned on at launch, so all three
  steps passed on the first try, nothing failed, nothing replanned, and the
  recovery machinery (plus the surface built to display it) sat idle. The chain
  did show ONE genuine durability tick — step 2 of node A hung for 11.5 min, got
  killed by the per-step time cap, and step 3 resumed and finished — but that is
  a run-scope resume, not the chain-scope self-heal the P3 ladder rung-1 needs.
- **Bottom line:** delivery 🟢 (3 nodes, all additive, full suite **934 TS pass /
  22 skipped**, tsc + eslint clean on the merged tree) · **Thesis-KPI 🔴 NOT
  EXERCISED** — chain terminal SUCCESS with **zero `node_replanned` / zero
  `chain_failed`** entries; the middle node (B) sealed SUCCESS on its first
  incarnation. P3-rung-1 (chain self-heal) is **UNPROVEN by this run** →
  ledger `rung=0`, re-run owed (dogfood-105, seam ARMED) · one incidental
  run-scope kill→resume in node A (`resumes=1`) · judge catches 0 (green path) ·
  family-diverse ✓ (codex/OpenAI executor ≠ gemini-3.1-pro judge) · new friction:
  🔴 **F-146** (heal-ladder chain launched with the force-fail seam UNARMED and no
  preflight guard caught it — a full $5.51 / 56-min chain proved nothing on the
  headline axis) · 🟡 **F-147** (cost/token telemetry reads $0.00 / 0 tokens on
  node A's two FAILED steps despite 13 tool calls + 24m of work) · 🟡 **F-148**
  (node A burned ~36 min across 2 failed/stalled steps before delivering a
  trivial pure function in 2m).

## Run at a glance — `chain-83913c34-312d-4c7f-95f4-832a6a168473`

| field | value |
|---|---|
| Outcome | 🟢 SUCCESS (delivery) / 🔴 KPI NOT EXERCISED · 3 nodes (A/B/C) · **$5.51** total · **~56m 14s** wall (sequential) |
| Executor / Judge | codex(openai) / gemini-3.1-pro-preview via openai-compat (family-diverse ✓, invariant #2 held) |
| Spec | `examples/dogfood/dogfood-104-wp521-chain-heal-resume.yaml` (LOOSE chain goal; planner emitted the linear 3-node topology A→B→C) |
| Host WP | WP-521 (chain heal-by-default) — P3 self-heal / durable-execution track (plan.md §7, WP-530 ladder rung-1) |
| Ladder-rung target | P3-rung-1 (chain self-heal) — **NOT satisfied** (no node failed → no recovery to observe); ledger `rung=0` |
| Landed | **harvested to working tree, uncommitted** (topological merge of the 3 node deltas; full suite green on the merge) |
| Chain journal | `plan` ×1 · `node_started` ×3 · `node_sealed` ×3 (A/B/C all SUCCESS/PROCEED) · `chain_completion_review` ×1 (PROCEED) · `terminal` SUCCESS · **`node_replanned` ×0 · `chain_failed` ×0** |
| Scope | 6 files, all in `packages/sdk-ts/` (3 new src+test pairs; 1 additive edit to `trace.ts`) |

## Trace (chain timeline)

```
chain-83913c34 · SUCCESS · 3 nodes · ~56m · executor codex(openai) · judge gemini-3.1-pro (openai-compat)
 node   steps  tokens(in/out)   cost     verdict / notes                                  wall
 A        3     360k/4.2k*       $0.51    ✓ SUCCESS — step1 FAILED, step2 KILLED(maxSec),  38m 47s
                                          step3 SUCCESS (organic kill→resume, resumes=1)
 B        2     2259k+376k/24k   $3.56    ✓ SUCCESS — step1 PROCEED(0/1), step2 completed  13m 06s
 C        1     1072k/9.2k       $1.43    ✓ SUCCESS (3/3 criteria)                          4m 21s
 ── chain seal ──
 chain_completion_review    PROCEED    (aggregate design review over the coherent 3-node diff)
 totals: nodes 3 · succeeded 3 · FAILED 0 · replans 0 · recovery surface rendered NOTHING (no replan to show)
 * node A steps 1 & 2 recorded 0 tokens / $0.00 (F-147); $0.51 is step 3 only.
```

## Delivery quality (human review, post-landing)

Reviewed the merged working tree line-by-line against the spec goal. **The
product code is genuinely good** — this is not throwaway scaffolding.

| node | deliverable | verdict |
|---|---|---|
| A | `src/chain/recovery-summary.ts` — pure `summarizeNodeRecovery(nodeId, outcome, attempts, lastFailureReason)` → bounded one-line summary (`· status · attempts N · last failure: …`, 200-char cap). Focused 6-test file. | 🟢 IDENTICAL to run workspace; AC-1 PASS |
| B | `src/chain/chain-recovery-summary.ts` — `renderChainRecoverySummary(plan, nodeOutcomes, entries)` folds every `NodeOutcome` + the chain's `node_replanned` entries through node A's function in plan order. **Correctly tracks replan LINEAGE** (root-by-node map across replaced node ids `${id}-r${n}`), incrementing incarnation count + carrying the latest failure reason. Reuses A via ESM `./recovery-summary.js`. Focused test. | 🟢 sound design; AC re-passes |
| C | `src/chain/trace.ts` additive wire (+11 lines): renders a `recovery summary:` block **only when a `node_replanned` entry exists** — so replay-free chains render byte-identically (additive discipline held). Test imports both predecessors. | 🟢 additive; AC-2 co-ref PASS |

- **Full suite on the merged tree:** `934 passed / 22 skipped`, `tsc --noEmit`
  clean, `eslint` clean on all three changed src files. Scope discipline held —
  only `packages/sdk-ts/` touched (+ the spec YAML edit).
- **Harvest byte-diff caveat (benign):** the per-node verify pack flags
  `trace.ts` / `chain-recovery-summary.ts` as `DIFFERS` / `not-in-workspace`
  against node A's isolated workspace — expected, because each node workspace is
  a snapshot BEFORE the later nodes' handoffs accumulated. The chain-level seals
  confirm the topological merge (A base `4d46fb0` → B base `87e23276` → C base
  `8c8845dc`).
- **Irony worth stating:** node B built a real replan-lineage fold, but because
  the chain never replanned, `renderChainRecoverySummary` was exercised only on
  the empty case, and node C's guarded wire rendered NOTHING in the live trace.
  The surface is real; it was never observed doing its job this run.

## Thesis-KPI verdict — 🔴 NOT EXERCISED

The rung-1 KPI is **journal-read**: on a real 3-node chain whose middle node
FAILS its first incarnation, the chain journal must show the default
halt-and-replan firing (a `node_replanned` entry carrying the failed node's
evidence), the chain recovering to SUCCESS, and earlier verdicts unchanged.

Read from `.chikory/chains/chain-83913c34.../chain.db`:

- `node_sealed` A/B/C — **all `{status:SUCCESS, verdict:PROCEED}` on first
  incarnation.** No `-r1` retry node anywhere.
- **`node_replanned` count = 0. `chain_failed` count = 0.** `terminal` = SUCCESS.

The chain sailed clean. The heal-by-default path never fired because **no node
ever failed** — and no node failed because the deterministic force-fail seam was
not armed. Root cause: launch step 3 of the spec (`CHIKORY_SEED_CHAIN_FAIL_NODE=B
devbox run chain-dogfood`) was not applied — the chain ran with the plain
`chain-dogfood` launcher. The seam matches on `node.id === seedFailNodeId`
(`chain-loop.ts:170`); planner ids are `A`/`B`/`C`, so `=B` would have force-
failed the middle node. It was simply never set, and nothing refused the launch.

**The mechanism itself is not in doubt** — the committed in-suite live regression
`test/chain/chain-heal-live.test.ts` (seeded mid-chain fail → default replan →
retry SUCCESS → chain SUCCESS; `maxReplans:0` opt-out → FAILED) proves it at the
Temporal level. What is missing is the **real-chain observation on top**, which
is the entire reason this was a dogfood headline. P3-rung-1 stays **UNPROVEN**.

## New friction

### 🔴 F-146 — heal-ladder chain launched with the force-fail seam UNARMED; no preflight guard
- **Evidence:** chain terminal SUCCESS, 0 `node_replanned`, all nodes SUCCESS
  first incarnation; `CHIKORY_SEED_CHAIN_FAIL_NODE` never set. A full $5.51 /
  56-min chain produced a clean-path delivery but **zero headline-KPI signal** —
  the run's stated purpose (observe chain self-heal) was silently un-met.
- **Why it matters:** the P3 ladder advances only by a live dogfood recording
  its KPI. A heal-recovery headline that runs without its force-fail seam armed
  greens the delivery half while the ladder rung stays flat — invisible unless
  the review reads the chain journal. This is the chain-scope analog of the
  F-119/120/121 launch-preflight lineage (`dogfood.sh` refuses broken/unarmed
  specs at $0).
- **WP it spawns:** **WP-531 (track-B, hand-fixable)** — `chain-dogfood`
  preflight guard: if the spec declares a `Ladder-rung:` on the P3 heal track
  (or its goal/KPI names chain recovery / `node_replanned`), REFUSE launch unless
  `CHIKORY_SEED_CHAIN_FAIL_NODE` is set to a node id the planner will emit (or
  the launcher auto-arms the middle node post-plan). Hand-fix this review sitting
  per TASK-PROTOCOL §4 before the re-run (dogfood-105).

### 🟡 F-147 — cost/token telemetry reads $0.00 / 0 tokens on FAILED codex steps
- **Evidence:** node A step 1 (`FAILED`, 24m 20s, **13 tool calls**, 3255-byte
  diff) and step 2 (`killed: exceeded maxSeconds`, 11m 30s) both recorded
  `tokens {input:0, output:0}` and `$0.00 (estimated)`. Node A's reported $0.51
  is step 3 alone; ~36 min of real executor work is invisible in the cost total.
- **Why it matters:** the budget gate and the §1.4 token-economics KPI both
  undercount when a step fails or is killed — a stalled/thrashing executor looks
  free. Same family as F-9 (WP-218, missing-price → inert budget gate).
- **WP it spawns:** track-B note under WP-218 lineage — the codex adapter should
  attribute tokens/cost to FAILED and maxSeconds-killed steps, not only sealed
  ones. No new headline WP (telemetry accuracy, not loop integrity).

### 🟡 F-148 — node A burned ~36 min / 2 failed steps before a 2-min delivery
- **Evidence:** step 1 FAILED after 24m 20s / 13 tool calls / 3255-byte partial
  diff; step 2 stalled 11m 30s producing 0 tool calls / 0 diff, then killed by
  `maxSeconds=600` (690.1s, 1.15× cap, `retriable:true`); step 3 then delivered
  the whole pure `summarizeNodeRecovery` module in 1m 59s. The deliverable is a
  ~10-line pure function.
- **Why it matters:** executor thrash/stall on a trivial deliverable — the F-8
  (WP-217) wasted-step family. The **silver lining** is the durability win: the
  `maxSeconds` cap killed the stalled step (retriable), and the run resumed from
  `lastGood` (node-A@8) and completed — a genuine run-scope kill→resume
  (`resumes=1`), the one real thesis tick this run produced.
- **WP it spawns:** none new — logged as a token-economics / wasted-step data
  point (baseline for WP-203/207). The `maxSeconds` kill working as designed is
  a positive; the underlying stall is model behavior, not a Chikory defect.

## Verdict on the thesis

**Mixed.** The durable-execution substrate did its job at RUN scope — a stalled
step was killed and the run resumed to SUCCESS (the first non-zero `resumes` in
the trailing window). But the CHAIN-scope self-heal this run was designed to
demonstrate never fired, because the deterministic force-fail seam was not armed.
The product deliverable (chain recovery-observability surface) is landed, clean,
and full-suite green — real progress on F-144 — but the headline moat claim
(a real `chikory chain` recovers from a mid-chain node failure) remains a
committed unit test, not a live-chain observation. **P3-rung-1 is owed a re-run.**

## KPIs (§1.4)

| KPI | this run | trailing window | target |
|---|---|---|---|
| Max horizon survived | 3 nodes / 6 steps / ~56m wall | 3 nodes (103), 7 steps (102) | ↑ chain-horizon |
| Kill→resume count | **1** (node A, organic maxSeconds → resume) | 0 across 097…103 | ≥1 per rung 2+ |
| Judge true-positives pre-land | 0 (green path) | 1 (102), 0 (103) | catch real defects |
| Trailing-3 meta:product headline ratio | 0/3 (this = product) | 0/3 | ≤1 per 3 |
| Per-step reliability (runs ≥5 steps) | 95.1% (5 rollbacks / 103 steps) | 95.1% | 99%+ |
| Current-phase ladder rung vs exit | **P3-rung-0** (rung-1 attempted, NOT met) | rung 4 stale/P2-retired | P3-rung-5 (exit) |

**Ladder note:** the ledger `rung` for prior runs (097…103) reads `4` under the
retired P2/WP-265 numbering; under the P3/WP-530 ladder this run is the first
graded, and it satisfies **rung 0** (recovery unproven). The re-run (dogfood-105,
seam armed) is what can first claim P3-rung-1.
