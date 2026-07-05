# dogfood-085 — WP-215 ARCHITECTURE RUBRIC, hosting the NON-HOLLOW rung-3 HORIZON. The FIRST launch to USE `bounded_work_unit.work_chunks` (WP-270) in its own YAML: 5 dependency-ordered sub-goals, one per durable step, converting dogfood-082's HOLLOW horizon (F-100) into a real per-step-reliability curve. Delivered the whole architecture-scan chain — a net-new pure `scanDiffForLayeringViolations` primitive → `collectEvidence` wire (`architectureLabels`) → `prompt.ts` render → a NON-destructive `no_architecture_violations` standing-rubric item → LIVE Temporal proof — mirroring the shipped secret/dependency scans. 6 durable checkpoints, all 4 ACs green, harvest byte-IDENTICAL. **BUT the horizon was neither fully non-hollow nor fully autonomous:** a chunk-unaware judge ESCALATEd at step 2 (all ACs+rubric PASSED — it raised an out-of-rubric concern that PART 4 was "omitted", not knowing PART 4 was chunk 4 of 5), which PARKED the run for human approval and, being a non-PROCEED verdict, re-handed chunk 2 → step 3 was a HOLLOW empty-diff re-verify (4.9% of run cost). That spurious-ESCALATE-parks-for-approval behavior is a HARD blocker for the ⑦ overnight-unattended rung (it would hang all night). → 🔴 F-107 → new WP-271.

- **WP:** WP-215 — security & architecture rubric checks (JD-4). A real open plan.md §6 product WP on the judge pillar; the security side (secret-scan S1–S3, dependency-scan S4–S5) was landed, the **architecture side was genuinely unbuilt** (REQUIREMENTS.md JD-4: "Architecture rubric still P2"). This run built it. The WP-270 chunking mechanism is the VEHICLE seeded INTO this real WP's code (§1.2: no fresh throwaway utility).
- **Date:** 2026-07-04
- **Spec:** `examples/dogfood/dogfood-085-wp215-arch-rubric-nonhollow-horizon.yaml` (LOOSE, `Ladder-rung: 3`, `Thesis-KPI: NON-HOLLOW per-step reliability`, `budget_usd: 50`, `max_steps: 30`) — launched with `chikory run` (single durable run). Loose-AC discipline honored: AC-1/2 grep the net-new `scanDiffForLayeringViolations` symbol the goal NAMES (absent on HEAD, F-90); AC-3 F-97-hardened (a `test/` file co-referencing `scanDiffForLayeringViolations` AND the LIVE driver `createRunnerWorker`); module/test layout left to the executor (F-82/F-83).
- **Run-id:** `run-17b5ef57-7064-4e35-95cc-e3edfbad7dea`. Executor `codex(openai)` / gpt-5.5, judge `openai-compat/gemini-3.1-pro-preview`.
- **Landed commit:** un-harvested at review time (working tree, byte-IDENTICAL to the run workspace — pack §5 all 12 files IDENTICAL). Harvest then commit.

## Trace

```
run run-17b5ef57 · SUCCESS · 6 steps · $4.36 / $50.00 · 22m 41s · executor codex(openai)/gpt-5.5 · judge openai-compat/gemini-3.1-pro-preview
 #   step (chunk)                         tokens(in/out)  cost      diff B   verdict
 1   PART 1 pure primitive                943k/9.8k       $1.2771   10858    ✓ PROCEED (3/4)   AC-2 fail = not-yet-wired, by design
 2   PART 2 evidence wire                 1367k/9.9k      $1.8082   11747    ⚠ ESCALATE        SPURIOUS — all AC+rubric PASS
 3   PART 2 re-handed (chunk not advanced) 151k/2.2k      $0.2114   0        ✓ PROCEED (4/4)   HOLLOW empty-diff re-verify
 4   PART 3 prompt render                 156k/1.9k       $0.2136   2199     ✓ PROCEED (4/4)
 5   PART 4 standing rubric item          180k/1.7k       $0.2418   621      ✓ PROCEED (4/4)
 6   PART 5 live proof                    404k/4.8k       $0.5530   4944     ✓ PROCEED (4/4)
 totals: decisions 6 · judge passes 6 ($0.05, 1.2%) · rollbacks 0 · escalations 1 · injections 0 · checkpoints 6 (@4/@9/@14/@19/@24/@29) · pacing 6 · peak window 1%
```

- **Loop integrity 🟢 (no divergence):** 6 distinct sealed checkpoints, no duplicate journal entry, no re-executed committed step, 0 crash-resumes. The step-3 re-hand is the CORRECT by-design behavior of the F-101 fix (`consumedWorkChunks` increments only on PROCEED, so a non-PROCEED chunk is redone, never skipped) — the fault is upstream (the spurious ESCALATE), not the loop.
- **Chunk pointer trace (confirms the F-101 fix works as intended):** step1 PART1→PROCEED (consumed 0→1) · step2 PART2→ESCALATE (consumed stays 1) → **run parked AWAITING_APPROVAL** → approved → step3 re-handed PART2 (consumed 1), empty diff, PROCEED (1→2) · step4 PART3 (2→3) · step5 PART4 (3→4) · step6 PART5 (4→5, all chunks consumed + ACs met → SUCCESS).

## Delivery quality (human review, post-run workspace = working tree) — 🟢 COMPLETE, all-green, contract-additive

All 5 numbered PARTs landed, additively, mirroring the shipped `scanDiffForSecrets` / `scanDiffForNewDependencies` chain. Reviewed line-by-line against the goal.

| Goal PART | Delivered | ✓ |
|---|---|---|
| **1 — PURE PRIMITIVE:** side-effect-free `scanDiffForLayeringViolations(diff): string[]` in a new `src/judge/` module; added-lines-only import extraction, declared layer order, forbidden-upward flag, stable sorted+de-duped `from→to` labels; exhaustive unit tests; NOT yet wired | `src/judge/scan-layering.ts` (new): 10-layer `LAYER_ORDER` (core→providers→router→artifacts→executors→judge→planner→workflow→runner→cli); `isAddedCodeLine` (`+`, not `+++`, skips comments); `filePathFromDiffLine`/`normalizeProjectPath` (`.js`→`.ts`); `extractSpecifiers` (from/side-effect/`require`/dynamic-`import`); flags `toIndex > fromIndex` (lower layer importing higher) → `Set` sorted. `test/judge/scan-layering.test.ts` (new): forbidden-upward, legal-downward/sibling, relative/`node:`/external, empty-diff. Pure, no I/O. | 🟢 |
| **2 — EVIDENCE WIRE:** call the scan from `collectEvidence` over the FULL diff (before prompt truncation) into a NEW REQUIRED `CollectedEvidence.architectureLabels`; thread through `harness.ts`; additive | `evidence.ts`: import + `const architectureLabels = scanDiffForLayeringViolations(diff)` at `:158` (before `bound(...)`), added to the `CollectedEvidence` interface (`:55`) and the returned object (`:218`); `harness.ts:207` passes `collected.architectureLabels` beside `secretScanLabels`/`newDependencyLabels`. No frozen-contract reshape beyond the added field. | 🟢 |
| **3 — PROMPT RENDER:** a `## EVIDENCE — deterministic architecture scan (added diff lines)` section (a `renderArchitectureLabels` sibling), one `- <label>` per violation or `(none)` | `prompt.ts`: `renderArchitectureLabels` sibling of the secret/dependency renderers; additive, LLM still adjudicates. | 🟢 |
| **4 — STANDING RUBRIC ITEM:** a NON-destructive `no_architecture_violations` item in `STANDING_RUBRIC` | `rubric.ts:41`: `{ id: "no_architecture_violations", description: "…reports no forbidden layer dependencies…", destructive: false }`. NOT a rule-1 auto-ROLLBACK; `RubricItem` shape unchanged. | 🟢 |
| **5 — LIVE PROOF:** a LIVE Temporal test (reuse `createRunnerWorker`/`createTemporalRunner`/`waitFor`/`describe.skipIf`/`makeJudgedSpec`) driving a real `chikory run` whose diff seeds a forbidden import → asserts the violation surfaces in `architectureLabels` + the rendered section; AND a clean diff → `[]` + `(none)` | `test/judge/architecture-scan-evidence.test.ts` (new): co-references `scanDiffForLayeringViolations` AND `createRunnerWorker` (F-97-safe); `test/runner/verdict-gating.test.ts` + `test/runner/helpers.ts` updated for the architecture-scan + clean-diff paths. | 🟢 |

- **Frozen contracts held:** a NEW pure module + one additive REQUIRED field on `CollectedEvidence` + additive render/rubric edits. No shape change to `StepRecord` / `JournalEntry` / `Checkpoint` / `RubricItem`. No new dependency.
- **Scope (`git status --short`):** 12 files, all under `packages/sdk-ts/src/judge` + `test/`, all entailed by the goal — new: `scan-layering.ts`, `scan-layering.test.ts`, `architecture-scan-evidence.test.ts`; modified additively: `evidence.ts`, `harness.ts`, `index.ts`, `prompt.ts`, `rubric.ts`, `verdict-gating.test.ts`, `helpers.ts`, and the `secret-scan`/`new-dependency-scan` evidence tests (updated for the new required field). No out-of-scope file; `agent-loop.ts`/contracts untouched.

## Independent verify — the run's own green confirmed

- Pack §3 re-ran all 4 ACs against the WORKING TREE: **AC-1/2/3/4 PASS** (AC-4 = `tsc --noEmit && eslint . && vitest run` → **699 passed / 19 skipped, 104 files**, exit 0). The delivery is on the tree (un-harvested but present), so the tree-grep ACs are trustworthy here.
- Pack §5 byte-diffed all 12 changed files vs the run workspace: **all IDENTICAL** — the working tree IS the run's output; no divergence.
- The run's OWN judge executed all 4 ACs against the workspace each step; family diversity real: executor gpt-5.5 (OpenAI) vs judge gemini-3.1-pro-preview (Gemini, via openai-compat shim).

## New friction

Friction numbering is global + sequential; highest prior = F-106 (dogfood-082/083 era). Continue at F-107.

### 🔴 F-107 → WP-271 (NEW, judge-trust + durability — the headline finding): the judge is CHUNK-UNAWARE, so it ESCALATEs an intermediate chunked step for a "missing" later PART that is deferred BY DESIGN — parking the autonomous run for human approval and wasting a step

- **Evidence (journal, step 2 verdict):** all 4 ACs passed AND all 4 rubric items passed (`tests_pass`, `no_unrelated_deletions`, `no_secrets_introduced`, `scope_matches_instruction`), yet the verdict was **ESCALATE** with `concerns: ["The executor completely omitted PART 4 of the goal, which instructed to add the no_architecture_violations item to the STANDING_RUBRIC…"]`. Step 2 was chunk 2 of 5 (`part-2-evidence-wire`); PART 4 was correctly not yet started. The judge receives the FULL `spec.goal` (all 5 PARTs) but NOT the active `work_chunk` directive that scopes the executor — so it measured chunk 2 against the whole goal and flagged deferred-by-design work as an omission.
- **Impact — two coupled harms:**
  1. **Autonomy-breaking (the hard one):** an ESCALATE sets `status = AWAITING_APPROVAL` and blocks on `await condition(() => pendingApprovals.length > 0 || cancelRequested)` (`agent-loop.ts:580-581`) with **no timeout** — the run PARKED mid-horizon and only continued because a human approved. An **unattended** run (the ⑦ overnight rung, DOGFOODING §1.1) would hang indefinitely on the first spurious escalate. This is the F-78-class "nobody watching" hang the overnight rung exists to surface — discovered one rung early.
  2. **Hollow step (the cheap one):** because ESCALATE is not PROCEED, `consumedWorkChunks` did not increment (`agent-loop.ts:547`), so step 3 was re-handed the SAME chunk (PART 2), found it already landed, and sealed a HOLLOW **0-byte diff** — **$0.2114, 4.9% of run cost** (the F-11/WP-221 empty-diff probe metric). So the "non-hollow" horizon was 5/6 non-hollow, dented by exactly this escalate.
- **Why the delivery still succeeded:** the run was human-attended; the judge's *substantive* adjudication (ACs + rubric) was correct every step; the terminal SUCCESS still required all ACs. So this is a judge-TRUST + DURABILITY defect, not a delivery gap — but it directly blocks the next rung.
- **WP it spawns — WP-271 (judge chunk-scoping + unattended-safe escalate policy):** thread the active `work_chunk` directive into the judge's evidence/prompt so an intermediate chunked step is adjudicated against the CURRENT chunk (a chunk-aware judge notes "PART 4 pending (chunk 4/5)" and PROCEEDs instead of escalating); AND/OR give ESCALATE an unattended-mode policy (bounded approval wait → seal a resumable `AWAITING_APPROVAL`/HALT rather than block forever) so an overnight run cannot hang on a park. **This is the named blocker for the ⑦ overnight-unattended rung** (§1.2 fallback carve-out — see "Ready the next run").

### 🟡 F-108 → WP-271-adjacent (NEW, latent, WP-206×WP-270): `consumedWorkChunks` is not restored on crash→resume, so a resumed chunked run replays from chunk 0

- **Evidence:** `consumedWorkChunks` is a local `let = 0` (`agent-loop.ts:146`) mutated only at `:547`; the resume-restore block (`agent-loop.ts:240-253`) restores `checkpoints`, `lastGoodCheckpointId`, `escalationIndex`, etc., but **NOT** `consumedWorkChunks`. A `chikory resume` of a chunked run re-initialises the counter to 0 → `decideWorkChunk` re-hands chunk 0 → already-done early chunks produce empty diffs until the executor catches up.
- **Impact:** latent — 0 resumes this run. Self-corrected by the AC gate (missing work fails the final judge), but wasteful and it re-triggers the F-107 hollow-step pattern on every resumed chunked run; interacts badly with F-107 (a resumed overnight run would both hang on escalates AND re-walk consumed chunks). Fold into WP-271 or a WP-206-adjacent track-B fix (persist `consumedWorkChunks` into the checkpoint like `lastGoodCheckpointId`, or derive it from PROCEED-sealed checkpoints on restore).

### ℹ️ Not-new: F-101 empirically RE-CONFIRMED CLOSED

The step-3 re-hand (chunk redone after a non-PROCEED, never skipped) is the LIVE proof that the F-101 fix (`consumedWorkChunks` PROCEED-gated, replacing raw `checkpoints.length`, run-03d161e9) behaves correctly under a real non-PROCEED chunk verdict — the first at-horizon exercise of that path outside its unit regression. No action.

## Cost / token economics — the WP-203/207 baseline datapoint

| Metric | Value |
|---|---|
| Total (exact) | **$4.3563** / $50 budget (8.7%) |
| Judge share | **1.2%** ($0.0522 across 6 passes) |
| Most expensive step | step 2 PART-2 wire — **$1.8082** (1,367k in / 9.9k out) |
| Cheapest productive step | step 5 PART-4 — $0.2418 (621-byte diff) |
| **Hollow probe (step 3)** | **$0.2114 = 4.9% of run cost** (F-11/WP-221) |
| Input-token skew | steps 1–2 (front-loaded reasoning) = 2,310k of 3,201k total input tokens (72%) |

- **Non-hollow verdict: 5/6 (major improvement over dogfood-082's front-loaded 1-real-step hollow horizon).** Steps 1,2,4,5,6 each carried a distinct non-trivial product diff (10858/11747/2199/621/4944 B); only step 3 was hollow, and its cause is F-107, not the chunking mechanism. WP-270 `work_chunks` demonstrably distributed the work across durable checkpoints as designed.

## Verdict on the thesis

🟢 **The judge chain works and the horizon distributed.** The architecture-scan judge-evidence primitive shipped end-to-end and the WP-270 chunking mechanism produced a genuinely distributed 6-checkpoint horizon (5/6 non-hollow) — the trustworthy per-step-reliability curve dogfood-082 could not. **Per-step reliability = 100% (0 rollbacks over 6 steps).**

⚠️ **But the horizon was not autonomous, and that is the finding that matters.** A structurally-diverse judge is supposed to be a safety asset; here its lack of chunk-scope turned it into a spurious tripwire that (a) parked the run for a human and (b) wasted a step. For the inner-loop thesis this is fine (a human is present); for the NEXT rung — an unattended overnight run — a judge that can indefinitely park the loop on a false positive is a **hard blocker**. F-107/WP-271 must land before ⑦.

## §1.4 KPI table

| KPI | This run (085) | Trailing-3 (083c/085 window) | P2 target |
|---|---|---|---|
| Max horizon survived | **6 durable steps / 22m41s** | 6 steps (085) | 24h+ brownfield |
| Kill→resume count | 0 | 0 | ≥1 at horizon |
| Judge true-positives pre-land | **0** (the 1 ESCALATE was a FALSE positive — chunk-unaware) | 0 | ≥1 genuine |
| Trailing-3 meta:product headline ratio | 0:3 (all product) | 0:3 ✅ (≤1:3) | ≤1:3 |
| Per-step reliability (runs ≥5 steps) | **100%** (0 rollbacks / 6 steps) | 100% (085 only ≥5-step run) | ≥99% |
| Ladder rung vs P2 exit gate | **rung 3 non-hollow REACHED** (⑥) | stuck at 3 (⛔ STALLED) | rung ⑧ = 24h brownfield |

## Ready the next run — gates applied

- **Progression gate (MECHANICAL, BINDING):** ⛔ **STALLED** — trailing-3 rung 3 vs prior-3 rung 3, max-steps 6 vs 6; no thesis axis advanced. Binding: the next headline IS the current WP-265 ladder rung; new 🔴 friction is hand-fixed/queued, it does not headline. Per-step reliability now measurable (100%).
- **The current ladder rung (§6 queue) = ⑦ overnight *unattended* run — but it is BLOCKED by F-107.** An unattended run cannot tolerate a spurious ESCALATE that parks the loop for approval with no timeout (F-107 harm #1). This is the §1.2 **fallback carve-out**: the ladder rung is blocked by harness the dogfood mechanism itself depends on. When the carve-out fires, the named blocker becomes the next priority.
- **Next headline = WP-271 (the F-107 unblock): chunk-scoped judge adjudication + unattended-safe escalate policy.** Verdicts:
  - **Failure-surface (§1.1):** ✅ — a judge-contract change threading `work_chunk` scope into evidence/prompt + an escalate-policy change in `agent-loop.ts`; cross-file, additive-guarantee (a no-chunk run must stay byte-equivalent), plausibly failable (a judge that now under-reports, or a park policy that mis-seals).
  - **Product-progress (§1.2):** ✅ — real judge-quality code on the JD-3/JD-4 judge-trust thesis pillar (`src/judge/*` + `agent-loop.ts`), NOT scaffolding. Hosts the unblock for the ⑦ rung.
  - **Mission-critical (§1.3):** ✅ PROCEED — not busy-work; it is the named prerequisite for the next horizon rung.
  - **Friction-budget (§1.5):** ✅ — WP-271's surface is `src/judge/` + `src/workflow/` (PRODUCT, `class=product`), not harness-meta; trailing-3 meta 0/3, cap intact.
- **Alternative the user may override to:** write the ⑦ overnight spec directly and accept the hang risk (NOT recommended — a single spurious escalate burns the whole night, the exact cost the rung warns about). WP-271-first is the responsible sequencing.

**Ledger row appended:** `085,WP-215,run,SUCCESS,6,4.36,loose,product,0,0,3,0`
