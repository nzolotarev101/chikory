# dogfood-079 — WP-265 rung 2 REACHED: the WP-508 `chikory chain` re-host on WP-204 tiered memory decomposed into 4 sequential judge-gated nodes, survived a LIVE mid-chain `kill -9` → `chikory chain resume` WITHOUT re-executing the completed node, and sealed 4/4 SUCCESS — the first at-horizon durable kill→resume in the ladder

- **WP:** WP-204 — tiered memory (core / archival / recall + provenance on every write, the poisoning safeguard). A real open P2 product WP, hosted here as the **WP-508 chain re-host** of WP-265 rung 2 (the ≥10 durable step/checkpoint horizon + the first live mid-chain kill→resume), now that its two blockers landed (WP-509 planner-decompose, WP-510 writeSet gate).
- **Date:** 2026-07-03
- **Spec:** `examples/dogfood/dogfood-079.yaml` (`dogfood-079-wp204-tiered-memory`, LOOSE, Ladder-rung 2, `min_nodes: 4`) — launched with `chikory chain` (WP-508's whole premise). WP-266 loose-AC lint 🟢; WP-261/267 launch-mode enforcement held after the header reword (see F-93).
- **Chain-id:** `chain-f4b08133-77c7-47b3-ae63-8a3803bbfc14` (plan `plan-52362e84-14f1-4a52-b4b0-6ecc501db91c`). Node runs `…-node-tiered-memory-{core,archival,recall,provenance}`. Runtime HEAD `d4ab544` (the 4th WP-510 fix).
- **Terminal state:** 🟢 **SUCCESS · 4/4 nodes** — every node `✓ PROCEED (2/2 criteria)`, 0 rollbacks / 0 escalations / 0 injections. `chain SUCCESS` at `2026-07-03T12:32:58.818Z`.
- **Landed commit:** `9304c68` (auto-harvest mid-session — 4 files, **652 insertions**, working tree clean). Re-verified green this review.
- **Harness fixes this run EXERCISED (all track-B, landed 2026-07-03):** WP-509 `min_nodes` decompose floor + hardened planner prompt (`031baa7`); WP-510 writeSet gate across **four** false-fail modes (`031baa7` test-tree, `8dff9b8` executor-named new file, `d4b7d2a` directory-scope, `d4ab544` barrel `index.*`); spec-hygiene `4939d19` (launch-guard header reword) + `4d06cfb` (de-backtick goal for the WP-257 literal floor). dogfood-078 died on WP-509+WP-510; this run is their live proof.

## Trace — 4 sequential chain nodes, 1 executor step each, spanning the kill→resume

```
chain plan-52362e84 · SUCCESS · 4 nodes · 4/4 succeeded · executor codex(openai) · judge openai-compat/gemini-3.1-pro-preview

 node                      run suffix          result             steps  tokens(in/out)  cost     dur      seal (UTC)
 tiered-memory-core        …-tiered-memory-core   ✓ SUCCESS (2/2)   1     744k/7.0k       $1.01   4m31s   12:18:20.307
 tiered-memory-archival    …-archival             ✓ SUCCESS (2/2)   1     696k/5.6k       $0.93   4m34s   12:22:54.166
 tiered-memory-recall      …-recall               ✓ SUCCESS (2/2)   1     600k/6.3k       $0.82   4m8s    12:27:02.504
 tiered-memory-provenance  …-provenance           ✓ SUCCESS (2/2)   1     1186k/11k       $1.60   5m56s   12:32:58.813

totals: 4 nodes · 4 judge passes (all PROCEED, ~$0.01 each, 0.6–1.0% share) · 0 rollbacks · 0 escalations · 0 injections
        node spend Σ = $4.36 (planner/plan-judge PROCEED, small, not separately extracted) · budget_usd 50 (≪ cap)
        family diversity real: executor codex(openai) ≠ judge gemini-3.1-pro-preview via openai-compat shim
        wall clock 12:13:49.575 (plan accepted) → 12:32:58.818 (chain SUCCESS) = 19m 9s, spanning the kill
```

Every node ran the reduced planner-derived per-node AC (its own deliverable), judged by `gemini-3.1-pro-preview`; the spec's full AC-1…AC-5 were re-verified against the harvested tree this review (§Delivery).

## The rung-2 KPIs — finally captured (both, live)

### Horizon: the ≥10 durable step/checkpoint boundaries came from CHAIN decomposition (WP-508's thesis)
The plan decomposed the WP-204 goal into **exactly 4** sequential nodes (`min_nodes: 4`, at the floor — WP-509 proven live: dogfood-078's planner collapsed the same shape into 1). Durable boundaries crossed: `plan accepted` + 4 × (`node started` → `checkpoint …@N` → `node sealed`) = **13 durable state transitions**, each node its own `chikory run` with its own workspace, journal and checkpoint. The horizon is **inter-node** (chain checkpoints), not intra-run — see ℹ️ F-94.

### Kill→resume: the first LIVE at-horizon durable resume in the ladder (KPI was 0 for 4 straight runs)
- Original worker: `plan accepted 12:13:49` → `core sealed 12:18:20.307` → `archival started 12:18:20.313`. The operator `kill -9`'d the chain worker's process group **mid-archival**. Temporal (a separate persistent process) held the durable state.
- Resume worker: `chikory chain resume chain-f4b08133… --watch` → `resume delivered to node tiered-memory-archival`; the chain continued archival → recall → provenance → `chain SUCCESS`.
- **Proof the completed node was NOT re-executed:** `tiered-memory-core`'s seal timestamp is **byte-identical** in both logs — `2026-07-03T12:18:20.307Z` (pre-kill `chain-079.log`) and `12:18:20.307Z` (post-resume `chain-079-resume.log`) — and its cost is unchanged at **$1.01**. The resume replayed core from the durable journal; it did not re-run codex (which would have re-spent ~$1 and moved the timestamp). This is the durable-execution thesis demonstrated end-to-end at a real horizon, not in a unit fixture.

## Delivery quality (human review of the harvested working tree) — 🟢 COMPLETE, all-green, scope-clean

Read the 652-insertion diff line-by-line against the goal's four OUTCOME deliverables. The feature is real, additive, pure, and correct.

| Goal deliverable | Delivered (all in `packages/sdk-ts/src/memory/tiered.ts` unless noted) | ✓ |
|---|---|---|
| **1 — CORE TIER:** pure typed `TieredMemory` core (put/get/list), bounded, deterministic, no I/O, sibling of `src/judge/` primitives | `class TieredMemory<TValue>` (`tiered.ts:43`) — `put/get/list`, `maxEntries` bound (`DEFAULT_CORE_MEMORY_MAX_ENTRIES=128`), monotonic `nextSequence`, `Map`-backed, zero I/O; `copyRecord` returns defensive copies | 🟢 |
| **2 — ARCHIVAL TIER:** core overflow spills into an append-only archival tier, nothing evicted is lost | `evictOldestIfNeeded()` (`tiered.ts:104`) pushes the oldest core record into `archivalRecords[]` with `tier: ARCHIVAL_MEMORY_TIER` when `size > maxEntries` — append-only, retains everything; `getArchival`/`listArchival` read it | 🟢 |
| **3 — RECALL TIER:** a `recall` query across BOTH tiers, best-match or most-recent ordering | `recall(query)` (`tiered.ts:100`) over `[...archival, ...core]`; standalone `recall()` (`tiered.ts:122`) tokenizes + scores (`scoreRecord`/`countOccurrences`), `order: "best-match" \| "most-recent"`, `limit` | 🟢 |
| **4 — PROVENANCE:** every write records `provenance` (sourceRef / origin); a write with none is REJECTED | `put(...)` requires `TieredMemoryWriteOptions.provenance`; `validateProvenance` (`tiered.ts:187`) **throws `TypeError`** when neither `sourceRef` nor `origin` is a non-empty string — the memory-poisoning safeguard, enforced at the write boundary | 🟢 |
| CONSTRAINTS: strict TS, ESM `.js`, named exports, NO new dep; no `StepRecord`/`JournalEntry`/memory-pointer change; NEW additive `src/memory/`; barrel re-export from package index | `src/memory/index.ts` re-exports the 12 named symbols; `src/index.ts` adds one line `export * from "./memory/index.js";`; no existing contract/shape touched; no dep added | 🟢 |

- **Scope:** exactly **4 files** — `src/memory/tiered.ts` (+271), `src/memory/index.ts` (+14), `test/memory/tiered.test.ts` (+366), `src/index.ts` (+1). No `src/runner/` (memory-pointer), no contract, no shared type touched. Clean.
- **Independent AC re-verify (this review, against the working tree — never trust the run's own green):** AC-1…AC-4 greps (`TieredMemory`/`archival`/`recall`/`provenance` scoped to the net-new `src/memory/`) all **PASS**; AC-5 `tsc --noEmit` OK · `eslint .` OK · `vitest run` **621 passed / 19 skipped / 0 failed** (incl. the WP-123 live-Temporal crash-recovery test). AC-3's `src/memory/`-scoped grep correctly does NOT false-green on the incumbent `recallPointerExcerpt` in `src/runner/` (F-90 net-new-dir anchor held).
- **Verdict on the delivery:** **WP-204 → 🟢 DONE.** Tiered memory (core/archival/recall) with provenance enforcement is built as pure unit-tested primitives, all-green, harvested and pushed.

## New friction (highest prior F-90 → F-91, F-92, F-93; ℹ️ F-94)

### 🟡 F-91 → WP-512 — the exact-path chain writeSet gate needed FOUR successive false-fail fixes before a LOOSE chain could pass; directory-scoping it erodes the conflict-safety guarantee the writeSet exists for
- **Evidence:** WP-510 (the dogfood-078 fix) admitted only the test tree. Launching dogfood-079 surfaced **three more** false-fail modes, each false-FAILING a judge-PROCEEDed, all-green node:
  1. test tree (`isTestPath`) — the original F-89, `031baa7`;
  2. the executor named its own `src/memory/tiered.ts` where the planner's writeSet guessed `src/memory/core.ts` (a NEW file in the declared dir) — `8dff9b8`;
  3. a downstream node MODIFIED the upstream-created `tiered.ts` under that executor-chosen name (a cross-node modify, not an add) — `d4b7d2a` made the boundary directory-scoped for added OR modified;
  4. a node re-exported its primitive from the package barrel `src/index.ts`, one dir up from its declared writeSet — `d4ab544` `isBarrelPath`.
  The gate's boundary is now `{exact path ∪ test tree ∪ barrel index.* ∪ any declared-entry's directory}` (`src/chain/write-set.ts:130` `undeclaredWritePaths`).
- **Why it matters:** exact-path writeSet enforcement is **fundamentally incompatible** with a LOOSE chain, which by design delegates file LAYOUT to the executor (F-82/F-83). Four self-inflicted false-fails on one goal shows the exact-path writeSet is the wrong primitive for LOOSE decomposition; the directory-scope relaxation that unblocks it also means the gate no longer catches a node scribbling on a sibling file in a directory it partly owns — the conflict-safety it was built for is largely gone for linear LOOSE chains (acceptable here: no parallel writers, judge + full-build AC are the real backstop, but it should be a deliberate design decision, not four reactive patches).
- **Fix → WP-512:** decide the writeSet primitive for LOOSE chains explicitly — either (a) derive the writeSet from the node ACs' `check` paths + declared **directories** up front (not exact files) so the planner declares intent at directory granularity, or (b) drop exact-path enforcement for LOOSE chains and rely on the judge + full-build AC + a lightweight cross-node "did you touch another node's declared file" advisory. Sibling of WP-510. Track-B.

### 🟡 F-92 → WP-513 — the WP-257 literal-preservation floor REVISE-rejected the decomposed plan because the planner PARAPHRASES: goal backtick-literals dropped from the per-node goals, which is exactly what a decomposing planner does
- **Evidence:** at launch, `planLiteralGaps` (`src/planner/literal-preservation.ts`) via `meta-judge-verdict.ts` REVISE-rejected the plan — every backtick literal in `plan.goal` (`types.ts`, `StepRecord`, `JournalEntry`, `.js`, `src/index.ts`, `src/judge/`, the memory-pointer path, `TieredMemory`) must appear in at least one node goal, but the planner paraphrased the goal into per-deliverable node goals and dropped several. Worked around this run by **de-backticking the entire goal narrative** (`4d06cfb`) so the ACs carry the greppable symbols and the goal prose carries none.
- **Why it matters (latent tension between two harness features):** WP-257's literal floor was built to stop a planner from silently dropping a REQUIRED symbol. But WP-509's whole job is to make the planner DECOMPOSE and paraphrase a goal into K smaller node goals — which necessarily drops/reworders literals. The two features are in direct tension: the literal floor treats healthy decomposition as symbol loss. De-backticking is a fragile author-side workaround (any future chain author will re-hit it).
- **Fix → WP-513:** reconcile the literal floor with decomposition — check goal literals against the UNION of (all node goals ∪ all node ACs), not each node goal alone; or exempt chain plans from the per-node literal floor and rely on the ACs (which are copied verbatim into nodes) to pin symbols. Sibling of WP-257/WP-509. Track-B.

### 🟡 F-93 → WP-514 — the launch-mode guard false-tripped on NARRATIVE PROSE in a spec header comment, not on an authoring intent
- **Evidence:** the first `chikory chain` launch was rejected by `detectIntendedSingleRun` (`src/cli/launch-mode-precheck.ts`) because a header COMMENT line contained the phrase "single `chikory run`" (describing what the spec is NOT), which matched a `SINGLE_RUN_PATTERNS` regex. Fixed by rewording the comment to "a decomposed, durable, multi-node chain" (`4939d19`).
- **Why it matters:** WP-261/267's launch-mode guard is meant to catch a spec AUTHORED for a single run being launched as a chain (or vice versa) — an intent signal. Matching the regex against free-text comment prose makes it fire on a spec that merely MENTIONS the other mode narratively, forcing the author to avoid ordinary English near the guard's keywords. False-positive on documentation.
- **Fix → WP-514:** scope `detectIntendedSingleRun` to intent-bearing fields (`name`, `goal`, explicit mode declarations) and ignore `#` comment lines, or require the single-run phrase in an imperative position, not any mention. Sibling of WP-261/WP-267. Track-B.

### ℹ️ F-94 (no new WP) — each per-node deliverable collapsed to 1 codex step, so the horizon is INTER-node only; intra-run compounding-error is still un-stressed
- **Evidence:** all 4 nodes journaled exactly 1 durable step (744k–1186k input tokens each, one step, judge PROCEED first try). The per-step reliability KPI (runs ≥5 steps) is still un-measured — codex one-shots each ~1-file deliverable, same single-step pattern as F-86/dogfood-077, now per node.
- **Why it matters (not a blocker):** WP-508's thesis is explicitly that the horizon comes from chain decomposition (inter-node durable checkpoints), which this run delivered. But the ≥5-step single-RUN reliability curve — the compounding-error target (95%→99% over many steps IN ONE run) — is still not exercised; the chain sidesteps it by making each run tiny. Rung 3 (the ~8h overnight run) is where intra-run horizon must finally appear. No new WP; folds into the WP-265 ladder + the WP-203/204 token-economics baseline.

### 🟡 F-58 / WP-249 — auto-harvest landed with a generic message, no `Run-ID:`/`Chain-ID:` trailer
- Same standing pattern: `9304c68` ("attempt at start chain -> stop -> resume: succeeded") harvested the delivery but carries no run/chain-id trailer linking it to the audit trail. WP-249 owns it; no new WP.

## KPIs (DOGFOODING §1.4)

| KPI | This run (dogfood-079) | Trailing window / target |
|---|---|---|
| Max horizon survived (durable steps / wall-clock) | **13 durable chain boundaries** / 4 sequential nodes / **19m 9s** wall (spanning the kill) | rung-2 target ≥10 durable checkpoints — ✅ **MET (1st time, after 4 misses 075/076/077/078)** |
| Kill→resume count (live at-horizon) | **1** — `kill -9` mid-`archival`, `chikory chain resume`, core NOT re-executed (identical seal ts `12:18:20.307`, $1.01 unchanged) | ✅ **first live at-horizon durable resume**; prior count 0 (unit-proven only) |
| Judge true-positives pre-land | **0** — all 4 nodes PROCEED first try (a clean build, no seam drill); honest 0 | seam drills excluded per ledger |
| Trailing-3 meta:product headline ratio | **0:3** (077/078/079 all product) | target ≤1:3 — 🟢 well under |
| Per-step reliability (runs ≥5 steps) | n/a — each node 1 step (F-94) | no ≥5-step single run yet — the intra-run horizon gap, deferred to rung 3 |
| Current ladder rung vs P2 exit gate | **rung 2 ✅ REACHED** | next: rung 3 (~8h overnight unattended) → P2 exit gate (24h brownfield) |

## Verdict on the thesis

🟢 **The first unambiguous long-horizon durable-execution win in the ladder.** After four straight rung-2 misses, the WP-508 chain re-host worked exactly as designed: the `chikory chain` planner DECOMPOSED the WP-204 goal into 4 sequential judge-gated nodes (WP-509 `min_nodes: 4` floor proven live), the chain crossed 13 durable checkpoints, and — the headline — an operator `kill -9` mid-chain was recovered by `chikory chain resume` **without re-executing the completed node** (byte-identical seal timestamp + unchanged cost prove journal replay, not re-run). WP-204 tiered memory (core/archival/recall + provenance-reject) landed complete, pure, all-green (621 passed), and scope-clean. The cost was three more writeSet-gate false-fail modes (F-91 → WP-512: the exact-path writeSet is the wrong primitive for LOOSE chains), a literal-floor-vs-decomposition tension (F-92 → WP-513), and a launch-guard false-trip on comment prose (F-93 → WP-514) — all harness-meta track-B, none the headline. **Rung 2 is done; the next headline is rung 3 (the ~8h overnight unattended run), which is where the still-unmeasured INTRA-run ≥5-step reliability curve (F-94) must finally appear.**
