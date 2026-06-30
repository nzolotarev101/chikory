# dogfood-069 — WP-257 literal-preservation verifier LANDED (the F-64 root-cause guardrail); and the run DOGFOODED ITS OWN BUG: launched as a chain, the planner paraphrase dropped 32/35 mandated literals — the very defect the delivered `planLiteralGaps` would have caught

- **WP:** WP-257 (the chain planner must preserve grep-pinned/verbatim literals from the parent goal into each node's `goal`) — pure verifier half. The dogfood-069 spec was authored as a **single `chikory run`** (its header three times says "NOT a chain", explicitly because a chain "would re-risk the very F-64 paraphrase this WP exists to fix"); the operator instead launched it with **`chikory chain`** — the **third run in a row** where a single-`run` spec was chained — and **F-64 recurred exactly as the spec warned.**
- **Date:** 2026-06-30
- **Spec:** `examples/dogfood/dogfood-069.yaml` (`dogfood-069-wp257-literal-preservation-verifier`)
- **Run-id (chain, single node):** `chain-bdaef796-667f-4e17-8ad2-4bd49951bb7f-node-implement_literal_preservation` (plan `plan-91e4a59a-eadf-4284-8412-3e95f483c1cd-implement_literal_preservation`). The planner decomposed the goal into **one node** (`implement_literal_preservation`). Runtime HEAD `361c4b4`.
- **Landed commit:** none yet — **2 files STAGED, uncommitted** on the working tree (`packages/sdk-ts/src/planner/literal-preservation.ts` NEW, `packages/sdk-ts/test/planner/literal-preservation.test.ts` NEW), byte-IDENTICAL to the node workspace (pack §5 both `IDENTICAL`). Left for operator review per dogfood-review §4.
- **Gate verdict (pre-launch, dogfood-069 header):** ✅ PROCEED — §1.1 ✅ cross-file pure module + test, real failure surface (exact-token discriminator, dedup/order, no-mutation) · §1.2 ✅ advances real open 🔴 WP-257, the durable-chain pillar's own root bug · §1.3 ✅ highest-value unblocked real-product slice. **Confirmed correct post-landing** — but the launch-mode divergence turned the run itself into a live demonstration of the bug WP-257 fixes.

## Outcome in plain English

WP-257 is the **root cause** behind a three-run streak of chain failures: the chain planner *paraphrases* each node's goal and **drops the exact, grep-pinned literals** the parent goal mandated (it HALTed dogfood-066, built a divergent parser in dogfood-067, leaked contract drift in dogfood-068). dogfood-069 lands the **deterministic guardrail half**: a pure `planLiteralGaps(plan)` that, given a decomposition, returns every backtick literal from the parent goal that **no node goal preserves**. The §4 follow-up — calling it inside the planner pass and **REVISE-ing** when the list is non-empty — turns F-64 from a silent paraphrase into a *caught* planner-output defect.

The delivery is **textbook** — 7 passing tests including a bonus exact-token-boundary case, mirrors `src/planner/coverage.ts`'s `planCoverageGaps` shape exactly, pure, type-only `Plan` import, JSDoc citing WP-257.

The irony is the headline. The spec said **"launch as a single `chikory run`, NOT a chain"**, three times, *because a chain re-risks the F-64 paraphrase*. The operator launched it as a **`chikory chain`** anyway. The planner compressed the entire detailed brief into a **two-sentence node goal** that dropped every grep-pinned literal — `WP-25`, `WP-255`, `assessSpecStaleness`, `parseWpStatus`, the exact-token rule, dedup/order, the `coverage.ts` mirror. **The run dogfooded its own bug.** It survived only because the F-49 AC-1 grep pins persisted into the acceptance criteria and the judge's per-step feedback drove the executor to re-add the literals by step 3 (steps 1-2 *failed* AC-1 and burned ~$1.72 — 63% of run cost). And the decisive proof: running the **delivered** `planLiteralGaps` against this run's **own** parent-goal-vs-node-goal flags **32 of 35** literals as gaps — WP-257's verifier, applied to WP-257's own launch, catches the defect that nearly sank it.

## Trace

```
chain chain-bdaef796-… · SUCCESS · 3 steps · $2.73 / $5.00 · 10m 30s · executor codex(openai) · judge gemini-3.1-pro-preview(openai-compat)
plan plan-91e4a59a-… · ONE node: implement_literal_preservation (planner did NOT decompose into ≥2 nodes)

 #   step deliverable                          tokens(in/out)  step$    judge$   verdict          dur
 1   literal-preservation.ts + test (partial)  695k/6.2k       $0.9304  $0.0066  ✓ PROCEED 1/2    3m27s   ✗ AC-1 (grep pins missing)
 2   add missing pieces (still partial)        595k/4.8k       $0.7917  $0.0050  ✓ PROCEED 1/2    2m24s   ✗ AC-1 (grep pins missing)
 3   complete: all grep-pins + cases pass      748k/5.2k       $0.9866  $0.0076  ✓ PROCEED 2/2    2m38s   ✓ AC-1 + AC-2

totals: 3 steps · 3 judge passes · $2.7279 total · judge $0.0192 (0.7%) · 10m30s · 0 rollbacks · 0 escalations
        checkpoints 3 (…@4, …@9, …@14, all lastGood true) · peak window 0% (compact 0 · park 0 — F-56 did NOT recur)
        no empty-diff probe step (F-11 did not recur) · harvest 2/2 files IDENTICAL to node workspace
```

## Delivery quality (human review, post-landing)

🟢 **Exceeds spec.** Reviewed `literal-preservation.ts` + test line-by-line against the goal:

| Mandated | Delivered | ✓ |
|---|---|---|
| `extractGoalLiterals` — first-seen order, de-duped, `[]` when none | `Set`-backed dedup, push-order, empty-safe | 🟢 |
| `planLiteralGaps` — parent literals no node preserves, goal order | `extractGoalLiterals(plan.goal).filter(!some node preserves)` | 🟢 |
| EXACT-TOKEN rule (`WP-25` NOT preserved by `WP-255`-only node) | `containsExactToken` regex with boundary class `[^A-Za-z0-9_-]` flanking the escaped token — hyphen + word-char excluded | 🟢 |
| type-only `Plan` import, named exports, no default, pure, no I/O | `import type { Plan }`, two named exports, no mutation | 🟢 |
| Mirror `coverage.ts` `planCoverageGaps` shape | same pure-decision shape, JSDoc cites WP-257 + the `planCoverageGaps` analog | 🟢 |
| ≥6 mandated test cases verbatim (`parseWpStatus`/`Plan`/`assessSpecStaleness`/`WP-25`/`WP-255`) | 7 tests — all mandated cases **plus a bonus** exact-token-boundary case (`XWP-25`, `WP-25a`, `WP-25_extra`, `F-490`, `grep-pinned-extra` all correctly excluded) | 🟢 |
| no mutation of `plan` | `JSON.stringify` snapshot assertion | 🟢 |

- **Scope discipline:** exactly the 2 named new files (pack §4 / `git status --short`). No `types.ts`, barrel, `coverage.ts`, planner harness, or dependency touched. ✓
- **AC re-run against working tree:** AC-1 PASS (7 grep-pins + scoped vitest 7 passed), AC-2 PASS (tsc + eslint + full suite **554 passed | 19 skipped**). ✓
- **Harvest:** both files byte-IDENTICAL to the node workspace (pack §5). ✓

## New friction

Friction numbering is global + sequential; the highest prior is F-69, so this report opens at **F-70**.

### 🔴 F-70 → WP-261 — launched as a `chikory chain` against a single-`run` spec, and F-64 recurred exactly as the spec warned (3rd consecutive launch-mode divergence)

- **Evidence.** The journaled node `goal` (`runs.task_json`) is a two-sentence paraphrase: *"Create the new file `…/literal-preservation.ts` implementing `extractGoalLiterals` and `planLiteralGaps` as named exports… Create the test file… to test all verbatim cases and verify both pass tests, lint, and build."* The parent spec goal contains **35** backtick literals; the node goal preserves **3** (the two function names + the empty literal). Running the delivered `planLiteralGaps` over `(parent goal, node goal)` returns **32 gaps**, including `WP-25`, `WP-255`, `assessSpecStaleness`, `parseWpStatus`, `Plan`, `coverage.ts`, `planCoverageGaps`, the exact-token rule phrasing.
- **Impact.** Steps 1-2 (`695k`+`595k` input tokens, **$1.72 combined = 63% of the $2.73 run**) both verdicted ✓ PROCEED **1/2** with AC-1 *failing* — the executor was rebuilding the grep-pinned literals it never received in its goal, guided only by the judge's AC-1-failed feedback. Step 3 finally satisfied all pins. This is the **same root mechanism that HALTed dogfood-066**; it recovered here only because the executor reconciled the surviving AC-1 grep within the 3-strike budget guard (dogfood-066's generic-parser path could not).
- **Why a WP.** This is the **third consecutive** run (067, 068, 069) where a spec authored single-`run` was launched as a chain. In 067/068 the divergence was benign-to-positive (it produced the first durable chains on real code). In 069 it **actively triggered the exact failure the spec warned the chain would cause.** WP-261: the launcher must honor the spec's prescribed execution mode — refuse (or loudly warn + require `--force`) when a spec whose header/conventions mark it single-`run` is launched via `chikory chain`, so the F-64-warned-against path is not taken silently. (Track-A; small CLI guard, the `evaluateSpecStalenessPrecheck` warn-shape.)

### 🟢 F-71 (positive, no new WP — promotes the WP-257 §4 wire to top priority) — the landed verifier catches its own run's defect

- **Evidence.** `planLiteralGaps(this run's plan)` = 32 gaps (above). The pure half delivered by this very run is **proven correct against the live F-64 defect** — not a synthetic fixture, the run's own decomposition.
- **Consequence.** The documented §4 follow-up — call `planLiteralGaps` inside `runPlannerPass`/`buildPlan` and **REVISE** the decomposition (or warn) when it returns non-empty — would have flagged this node goal at *plan time*, before a single executor token was spent. With the pure half landed and validated, **the §4 wire is now the single highest-value WP-257 slice.** It is harness wiring (planner pass), so it is **operator-landed / track-B** like every prior pure-half wire — not a dogfood headline.

### 🟡 F-58 / WP-249 reinforced — delivery STAGED, no `Run-ID:` trailer, not harvested via `chikory land --verify`

- Same standing pattern: the 2 files are STAGED uncommitted (not even harvested), so the landed-commit re-gate that `chikory land --verify` provides is again bypassed. No new WP — WP-249's track-B harvest-adoption remainder already owns this.

## Verdict on the thesis

🟢🔴 **The strongest single thesis data point in the corpus — by accident.** WP-257 exists because the chain planner drops mandated detail; dogfood-069 was launched in the exact mode the spec said would trigger that bug; the planner duly dropped 32/35 literals; and **the function the run was delivering is precisely the guardrail that catches it.** Two thesis claims land at once:

- 🟢 **Durable + judge-on-disk-artifacts is resilient.** Even fed a lossy paraphrased goal, the loop recovered to a correct, lint-green, spec-exceeding SUCCESS across 3 checkpointed steps (`…@4/@9/@14`, all `lastGood`, no rollback, no re-execution) — because the F-49 grep pins survived into the *acceptance criteria* and the inner-loop judge kept failing AC-1 until the executor complied. The quality gate, not the goal text, carried the run.
- 🔴 **But the planner paraphrase is a real, recurring, now-triply-fatal defect**, and the cost is visible: **63% of this run's spend** was the executor reconstructing dropped literals. The pure guardrail is landed and proven; until the §4 wire lands, every grep-pinned chain stays one budget-guard-away from a dogfood-066-style HALT.

**WP-257 → 🟡** (pure `planLiteralGaps` verifier LANDED + proven against the live defect; the `runPlannerPass`/`buildPlan` REVISE wire remains — now top priority). **New: F-70 → WP-261** (launcher must honor the spec's execution mode). **Next dogfood run: WP-202 Memory Pointer Pattern recall-wire or another unblocked real product slice** — the WP-257 §4 wire is operator/track-B (planner harness), so it is not the headline.
