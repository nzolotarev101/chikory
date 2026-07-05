# dogfood-087 — WP-202 (Memory Pointer store) LIVE RECALL + PRINCIPLED EVICTION, run GENUINELY UNATTENDED. Proves the ⑦ overnight rung's UNATTENDED-AUTONOMY axis (Ladder-rung 3, NOT a rung climb — the ~8h WALL-CLOCK axis stays blocked on F-111 → WP-272; §1.5 why-not recorded below). Makes the executor able to ACTIVELY pull an externalized pointer's fuller content mid-run and bounds the carried-pointer set with a principled eviction, delivered in SIX dependency-ordered durable steps under `unattended:{escalation:seal_resumable_failed}` (WP-271). All 6 steps non-hollow, 6/6 checkpoints, 100% per-step reliability, harvest byte-IDENTICAL. **Also the LIVE validation that the F-112 hand-fix held:** the FIRST attempt (`run-a94253fd`) died at step 3/6 on the chunk-unaware Rule-3 HALT; the re-run on the fixed harness (this run) sailed the SAME AC-2/AC-3-fail-by-design chunks 1–3 to SUCCESS.

- **WP:** WP-202 — Memory Pointer store (a CLAUDE.md first-class thesis pillar: "store large tool outputs externally, pass short refs into context"). A real open plan.md §6 product WP. The WP-271 `unattended` policy is the VEHICLE seeded INTO this real WP-202 code (§1.2 — no fresh throwaway utility).
- **Date:** 2026-07-05
- **Spec:** `examples/dogfood/dogfood-087-wp202-live-memory-recall-unattended.yaml` (LOOSE — goal states OUTCOME + constraints in six dependency-ordered PARTs; ACs pin done via OUTCOME symbols the goal NAMES; module/test layout left to the executor, F-82/F-83)
- **Run-id (delivered):** `run-8b8b81f7-991b-43c6-bf8f-0dbc48c6d6f7` (SUCCESS · 6 steps · re-run on the F-112-fixed harness)
- **Run-id (first attempt, harness-defect death):** `run-a94253fd-e1c6-4f91-a500-9db1e1028d73` (FAILED · 3 steps · $2.46 — F-112 Rule-3 HALT, hand-fixed in `3a64efd`/`fc79471` before the re-run)
- **Landed commit:** un-harvested (delivery on the working tree, byte-IDENTICAL to the run workspace — pack §5 all 10 files IDENTICAL)
- **Mode:** `chikory run` (single durable run, UNATTENDED — launched with `unattended:{escalation:seal_resumable_failed}`, walked away, no operator approval needed)

## Trace (delivered run `run-8b8b81f7`)

```
run run-8b8b81f7-991b-43c6-bf8f-0dbc48c6d6f7 · SUCCESS · 6 steps · $8.03 / $80.00 · 27m 12s · executor codex(openai) · judge openai-compat/gemini-3.1-pro-preview
 #   step (chunk)                         tokens(in/out)  cost      diff B   verdict
 1   PART 1 pure recall-request parser    1161k/5.1k      $1.5025    4061    ✓ PROCEED (2/4)   AC-2/AC-3 fail = PART-3/PART-6 not yet landed, BY DESIGN (WIP tolerance)
 2   PART 2 pure eviction decision        254k/4.2k       $0.3595    6061    ✓ PROCEED (2/4)   smallest chunk (pure fn + unit tests)
 3   PART 3 wire live recall into loop    1066k/8.6k      $1.4186    7014    ✓ PROCEED (3/4)   AC-3 now green; AC-2 still needs PART-4 eviction wire
 4   PART 4 wire principled eviction      919k/9.5k       $1.2433    6623    ✓ PROCEED (4/4)   all 4 ACs green from here
 5   PART 5 memory telemetry              1486k/10.0k     $1.9570   16196    ✓ PROCEED (4/4)   biggest diff (trace + journal + runTotals + tests)
 6   PART 6 live Temporal proof           1132k/7.7k      $1.4923    6803    ✓ PROCEED (4/4)   all chunks consumed + ACs met → SUCCESS
 totals: decisions 6 · judge passes 6 ($0.06, 0.8%) · rollbacks 0 · escalations 0 · injections 0 · checkpoints 6 (@4/@9/@14/@19/@24/@29) · pacing 6 · peak window 1% (compact 0 · park 0)
```

- **Loop integrity 🟢 (no divergence):** 6 distinct sealed checkpoints (`@4/@9/@14/@19/@24/@29`, commits `88e78258`/`32fa64f3`/`bc209c1e`/`976fe644`/`c8ce1893`/`4e35f28a`), `lastGood true` each, no duplicate journal entry, no re-executed committed step, 0 crash-resumes, 0 rollbacks, **0 escalations** (the unattended policy was armed but never needed to fire — the run never hit an approval gate). Chunk pointer advanced cleanly PART1→…→PART6 (consumed 0→6). **Non-hollow 6/6** — every checkpoint carries a distinct non-trivial diff (4061 / 6061 / 7014 / 6623 / 16196 / 6803 bytes); no empty-diff probe step (F-11 did not recur).

## Delivery quality (human review, post-run workspace = working tree) — 🟢 COMPLETE, all-green, contract-additive

All 6 numbered PARTs landed additively. Reviewed line-by-line against the goal.

| Goal PART | Delivered | ✓ |
|---|---|---|
| **1 — PURE RECALL-REQUEST PARSER (additive):** net-new pure total `resolveMemoryRecallRequest(executorText, refs): ArtifactRef \| null` in `memory-pointer.ts`; scans for a defined marker naming a carried pointer id; re-exported; exhaustive unit tests | `resolveMemoryRecallRequest` (`src/runner/memory-pointer.ts:105`): marker `[memory recall <id>]` on its own line (regex `/(?:^|\n)\[memory recall ([^\s\]]+)\](?=\n|$)/u`), matches full `ArtifactRef.id` OR the 12-char prefix, returns the ref or `null`. Pure, no I/O. Re-exported from `index.ts`. Unit tests: match (full id + prefix), no-marker, unknown-id, malformed (`[memory recall]`, trailing-extra, missing-brackets). | 🟢 |
| **2 — PURE EVICTION DECISION (additive):** net-new pure total `decideMemoryEviction(refs, policy?): {keep; evicted}` + local `MemoryEvictionPolicy`; opt-in max-count/max-bytes keeps most-recent, evicts coldest; no policy = no-op; unit-tested | `decideMemoryEviction` (`memory-pointer.ts:44`) + `MemoryEvictionPolicy{maxRefs?; maxBytes?}` (`:15`). No-policy / both-bounds-undefined → `{keep: refs.slice(), evicted: []}` (copy, immutable). Bounds → evict from the FRONT (oldest) while over `maxRefs` count OR over `maxBytes`. Unit tests: no-op, over-count evicts oldest, over-bytes, tie/empty, both bounds, input-immutability (`refs` unchanged). Pure, no `types.ts` change. | 🟢 |
| **3 — WIRE LIVE RECALL INTO THE LOOP (dep 1):** use `resolveMemoryRecallRequest` in `agent-loop.ts` so a step's recall request fetches the fuller excerpt via EXISTING `recallPointerExcerpt` and carries it into the NEXT step; no request → BYTE-EQUIVALENT | `agent-loop.ts:536`: after each step, `resolveMemoryRecallRequest(record.summary, carriedRefs)` → on match, `recallPointerExcerpt(formatPointerReference(ref), …recallArtifactExcerpt)` → sets `pendingMemoryRecallNote` → next step's `context.notes["memory.recall"]`. No request → `pendingMemoryRecallNote` undefined → `notes: {}` (byte-equivalent). New activity `recallArtifactExcerpt` (`activities.ts:489`) reads the artifact store by id-prefix (errors on missing/ambiguous). | 🟢 |
| **4 — WIRE PRINCIPLED EVICTION INTO THE LOOP (dep 2):** replace `carriedRefs.slice(-CARRIED_REFS_WINDOW)` with `decideMemoryEviction` under an opt-in policy; DEFAULT path BYTE-EQUIVALENT; do NOT weaken the compaction `digestRef` retention / `context_snapshot` handling | `agent-loop.ts`: `projectMemoryRefs`/`applyMemoryEviction` (`:119`/`:132`) run `decideMemoryEviction` **only over non-`context_snapshot` refs** (digest refs are always kept — the compaction retention is protected), gated by `memoryEvictionPolicy` = `{maxRefs: CARRIED_REFS_WINDOW}` **only when `spec.unattended !== undefined`**; policy `undefined` → the old `refs.slice(-CARRIED_REFS_WINDOW)` verbatim (byte-equivalent). | 🟢 (see F-113) |
| **5 — MEMORY TELEMETRY (dep 3/4):** additive `memory recalls N · evicted M` segment in the `chikory trace` totals sub-line, fed by loop counters; no-activity render BYTE-EQUIVALENT; no new REQUIRED journal field shape | `trace.ts:217`: `memorySummary` appended to the totals sub-line ONLY when `recalls>0 \|\| evicted>0`. `runTotals` (`journal.ts`) derives `memoryRecalls?`/`memoryEvictions?` from the last `checkpoint`/`terminal` payload. Counters persisted on the journal PAYLOAD (`activities.ts` — `{...checkpoint, memoryCounters}` only when >0), NOT on the frozen `Checkpoint` type; restored via cast (`activities.ts:744`). Trace test asserts both the >0 render and the byte-equivalent no-activity render. | 🟢 |
| **6 — LIVE PROOF (dep 1–5):** LIVE Temporal test (reuse `createRunnerWorker`/`makeJudgedSpec`/scripted registry/`waitFor`/`describe.skipIf`) — multi-chunk run UNDER the unattended policy: early large output pointerized, LATER step RECALLS it (excerpt reaches later context), carried set bounded, SUCCESS with NO approval; PLUS the no-recall/no-policy byte-equivalent path. Co-reference `resolveMemoryRecallRequest` + `createRunnerWorker` (F-97) | `test/runner/memory-pointer-interception.test.ts`: (a) live recall — step-2 recall request → `snapshots[2].notes["memory.recall"]` contains the pointer + payload. (b) **live multi-chunk unattended** — 8 chunks under `unattended:{escalation:seal_resumable_failed}`, judge wire, asserts `report.status === "SUCCESS"` (NOT `AWAITING_APPROVAL`), `checkpoints.length === 8`, carried non-digest refs ≤ 6, `snapshots[7].notes["memory.recall"]` contains the step-6 pointer id-PREFIX + payload, `memoryCounters.recalls === 1`, `evicted > 0`. (c) **byte-equivalence** — raw JSON snapshots `.toEqual` the exact expected `ContextBundle` strings for a no-recall/no-policy run. Co-references BOTH symbols (F-97-safe). | 🟢 |

- **Frozen contracts held:** `resolveMemoryRecallRequest`/`decideMemoryEviction` are NEW pure symbols; `MemoryEvictionPolicy` is a NEW local type; the eviction policy + telemetry are ADDITIVE OPTIONAL. **No shape change to `StepRecord`/`JournalEntry`/`Checkpoint`/`ContextBundle`/`ArtifactRef`** — `memoryCounters` rides on the journal PAYLOAD (optional, only when >0) and is read back through a cast, never added to the `Checkpoint` type. `RestoredWorkflowState.memoryCounters` (new required field) is an activities-internal interface, not a frozen contract. No new dependency. WP-123/WP-206/WP-269/WP-270/WP-271/WP-203-digest paths untouched.
- **Additivity is LIVE-PROVEN, not claimed:** PART 6's byte-equivalence test compares the raw serialized context snapshots exactly — the additive guarantee is an assertion, not a comment.
- **Scope (`git status --short`):** 10 files, all `packages/sdk-ts`. Src: `runner/memory-pointer.ts`, `workflow/agent-loop.ts`, `runner/activities.ts`, `journal/journal.ts`, `cli/trace.ts`, `index.ts`. Tests: `runner/memory-pointer.test.ts`, `runner/memory-pointer-interception.test.ts`, `runner/helpers.ts`, `cli/trace.test.ts`. All entailed by the goal. No out-of-scope file.

## Independent verify — the run's own green confirmed

- Pack §3 re-ran all 4 ACs against the WORKING TREE: **AC-1/2/3/4 PASS**. AC-4 = `tsc --noEmit && eslint . && vitest run` → **731 passed / 19 skipped, 107 files**, exit 0.
- Pack §5 byte-diffed all 10 changed files vs the run workspace: **all IDENTICAL** — the working tree IS the run's output; no divergence.
- The run's OWN judge executed all 4 ACs against the workspace each step (`judge-executed check … exited 0`); family diversity real: executor **codex (OpenAI)** vs judge **gemini-3.1-pro-preview (Gemini, via openai-compat shim)** — structurally distinct families.

## Anomaly hunt

- **F-112 fix validated LIVE (the headline anomaly, now closed):** the first attempt `run-a94253fd` HALTed at step 3/6 — AC-2 (needs PART-4 wiring) + AC-3 (needs the PART-6 live test) failed the first 3 chunks BY DESIGN, tripping the chunk-unaware Rule-3 consecutive-fail HALT. After the hand-fix (`workChunkInProgress` guard, `3a64efd`), the re-run `run-8b8b81f7` PROCEEDed through the IDENTICAL 2/4→2/4→3/4 chunk-1–3 pattern to SUCCESS. Same criteria trajectory, opposite verdict — the deterministic chunk-awareness fix (WP-273) works on a real multi-chunk run, not just the unit regression.
- **Wasted/filler steps:** none. 6/6 non-hollow, no empty diff, no "already done" re-verify. The 2/4-criteria PROCEEDs on steps 1–2 are correct WIP tolerance (the terminal ACs require later PARTs), not wasted steps.
- **Cost telemetry 🟢:** every step nonzero cost with nonzero tokens; no `.00`-with-tokens. Total exact **$8.0348 / $80 = 10.0%**; judge share **0.8%** ($0.06, 6 passes). codex(openai) + gemini priced correctly.
- **Token economics (baseline for WP-203/207):** input ≈ **1.0–1.5M tokens/step** (1161k/254k/1066k/919k/1486k/1132k) — codex re-reads the workspace each step; step 2 is the outlier-low (254k) because the pure-eviction chunk is small (12 tool calls). **$8.03 is the highest dogfood cost to date** (086 = $5.72), driven purely by per-step input volume × 6 chunks. Peak context window stayed at **1%** (compact 0, park 0) — the 200K window never filled at 6 steps, so compaction never triggered; this run does not stress the context-rot axis.
- **Judge behavior 🟢:** checks executed live each step (`exited 0`); rubric justifications sane; **0 escalations, 0 rollbacks**; `judge_catches = 0` (straight feature delivery, no seeded seam). The chunk-scoped judge (WP-271) correctly held PROCEED on steps 1–3 where AC-2/AC-3 legitimately failed — a whole-goal judge would have flagged the deferred parts. Family diversity real.
- **Human ceremony:** genuinely UNATTENDED — launched with the WP-271 policy and walked away; no `chikory approve`. Human work = slice + the F-112 hand-fix + re-launch + harvest-pending. (The re-run was forced by the harness defect, not operator choice.)
- **Loop integrity 🟢:** see Trace — clean chunk-pointer advance, no dupes, 0 resumes.

## New friction

Friction numbering is global + sequential; highest prior = **F-112** (Rule-3 HALT chunk-awareness, hand-fixed this cycle). Continue at F-113.

### ℹ️ F-113 → WP-202 knob-exposure (NEW, design-coupling, low, track-B): principled eviction activates off `spec.unattended` presence, not a dedicated memory-policy field

- **Evidence:** `agent-loop.ts` sets `memoryEvictionPolicy = spec.unattended === undefined ? undefined : {maxRefs: CARRIED_REFS_WINDOW}`. So `decideMemoryEviction` (the digest-protecting, byte-bound-capable eviction) engages ONLY when an `unattended` block is present; an ATTENDED long run still gets the crude `carriedRefs.slice(-6)`.
- **Impact (low):** no unboundedness — the crude slice still caps an attended run at 6 refs. The only loss is that an attended long horizon doesn't get the principled (digest-protecting / byte-aware) eviction, and the two orthogonal concerns (operator-presence vs memory bounding) are coupled. The executor chose this to stay additive — a dedicated `spec.memory.eviction` field would have reshaped the TaskSpec contract, which the goal's frozen-contract constraint pushed against.
- **WP it spawns:** track-B note under WP-202 — expose an explicit `MemoryEvictionPolicy` spec knob (with the cross-language contract + parity cost) when a real attended long-horizon run needs it. NOT a headline — the mechanism is correct and byte-safe; only the activation trigger is indirect.

### Still-open carry-forward (not new this run)
- 🔴 **F-111 → WP-272 (the binding next headline):** the ⑦ overnight rung's WALL-CLOCK axis (~8h) still has NO soak/idle-survival mechanism — run wall-clock ≈ (real decomposable sub-goals) × ~4-5 min/step (this run: 6 steps / 27m), so no chunk count reaches hours. dogfood-087 proved ONLY the UNATTENDED-AUTONOMY axis; the literal ~8h rung waits on WP-272. **This is WHY the ladder rung did not climb this run (§1.5 why-not).**
- 🟡 **F-110 → track-B:** the unattended escalate seals `status = FAILED`, conflating a policy-park with a genuine failure (needs a frozen-`RunStatus` ADR). Not exercised this run (0 escalations).
- 🟡 **F-108 → WP-206×WP-270 (latent):** `consumedWorkChunks` not restored on resume → a resumed chunked run replays from chunk 0. Untouched (0 resumes this run). NB: this run ADDED `memoryCounters` to the restore path — the restore correctly rehydrates the counters, but the pre-existing `consumedWorkChunks` gap is unchanged.

## Verdict on the thesis

🟢 **Strong.** This run is the Memory Pointer pillar paying rent AND the second consecutive proof of the judge-trust machinery holding under chunked horizons. A structurally-diverse judge (Gemini) supervised a 6-chunk, 27-minute, genuinely operator-free run that made the executor able to actively recall externalized context mid-run and bounded the carried-pointer set with a principled, digest-protecting eviction — the exact long-horizon memory lever the thesis claims (CLAUDE.md Memory Pointer Pattern under load). The run also delivered the LIVE validation that the F-112 hand-fix (WP-273 chunk-aware deterministic rules) works on a real run, not just a unit test: the identical AC-fail-by-design chunk sequence that killed the first attempt now PROCEEDs to SUCCESS. 6/6 non-hollow, 100% per-step reliability, contract-additive, harvest byte-IDENTICAL. The one residual (F-113, eviction activation coupled to `unattended`) is a knob-exposure nicety, not a defect. **The ⑦ rung's UNATTENDED-AUTONOMY axis is now LIVE-PROVEN on real product code — the rung does NOT climb because its ~8h WALL-CLOCK axis remains blocked on F-111 → WP-272 (the binding next headline).**

## KPI table (DOGFOODING §1.4)

| KPI | This run (087) | Trailing-3 (085/086/087) | Target / gate |
|---|---|---|---|
| Max horizon survived | 6 steps / 27m 12s | 6 steps / ~27m | ⑧ P2-exit = 24h+ (far) |
| Kill→resume count | 0 | 0 | resume proven @082 (`run-a94253fd` prior window) |
| Judge true-positives pre-land | 0 (no seam) | 0 | opportunistic |
| Meta:product headline ratio | product | **0:3** | ≤1:3 ✅ |
| Per-step reliability (runs ≥5 steps) | **100%** (0 rollbacks / 6 steps) | 100% | 99%+ ✅ |
| Ladder rung | **3** (⑦ unattended-autonomy axis proven; wall-clock axis blocked) | 3 → 3 → 3 (⛔ STALLED) | P2 exit = ⑧ 24h+ brownfield |

**Glossary:** WP = Work Package (plan.md unit). AC = Acceptance Criterion (grep/exit-code check the judge runs). Rung = WP-265 horizon-ladder step (⑦ = overnight-unattended). Non-hollow = every sealed checkpoint carries a distinct non-trivial diff. Probe step = an empty-diff re-verify step (F-11). Byte-equivalent = the additive path produces output identical to pre-change, asserted not claimed.
