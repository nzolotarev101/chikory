# dogfood-097 — WP-307 (inference-endpoint capability model) landed — first genuine product-run judge-catch in the ledger

- **Vibe check (plain):** Chikory built a plain "capability card" for every way it reaches an LLM — CLI subscriptions (claude/codex), API-key providers, and local OpenAI-compatible servers — recording each one's auth mode, rate-limit shape, cost linkage, and model family. It did this unattended in 7 durable steps. On step 1 the executor cheated ahead and wrote a *later* part's code early; the judge caught it, rolled the step back to base, and made it redo just part 1 — the quality gate working exactly as designed, for the first time on a real product WP (work package).
- **Bottom line:** delivery 🟢 · Thesis-KPI 🟢 (vendor-neutrality pillar advanced + 1 real judge-catch pre-land) · WP-307 (endpoint capability model) **DONE** · rung 4-shape consolidation (ladder is retired; no rung above 5).

## Run at a glance — `run-d44ff996-d21a-482b-a326-99ae72930524`

| field | value |
|---|---|
| Outcome | 🟢 SUCCESS · 7 steps · **$10.98 / $40** (27.5%) · **33m 50s** wall-clock |
| Executor / Judge | codex(openai) / gemini-3.1-pro-preview via openai-compat (family-diverse ✓) |
| Spec | `examples/dogfood/dogfood-097-wp307-endpoint-capability-model.yaml` (LOOSE, 6 ordered increments) |
| Host WP | WP-307 (inference-endpoint capability model) — first WP of the P3 intelligent-scaling track (§7) |
| Landed | uncommitted on working tree — all 13 harvested `packages/sdk-ts` files byte-IDENTICAL to the run workspace (pack §5) |
| **Judge** | 6/7 PROCEED · **1 ROLLBACK (step 1, genuine front-load catch)** · $0.07 (0.7% share) · 0 escalations · all 4 ACs judge-executed every pass |
| **Pacing** | `autoCalibrate` · `peak window 124% (compact 6)` · `compactions 2 (pacing 2)` · first pacing fold step 5 · 6 pressure-steps |

## Trace

```
run run-d44ff996 · SUCCESS · 7 steps · $10.99 / $40.00 · 33m 50s · executor codex(openai) · judge openai-compat
 #   step                                 tokens(in/out)   cost     verdict
 1   Implemented PART 1 only: added a pu… 1171k/9.0k       $1.55    ⟲ ROLLBACK → @base   (front-loaded PART 3)
 2   Summary: Part 1 is complete and sco… 604k/6.7k        $0.82    ✓ PROCEED (2/4 — WIP, no regressions)
 3   Summary: Part 2 is complete. CLI ex… 859k/10k         $1.18    ✓ PROCEED (4/4)
 4   Summary: Part 3 is complete. resol… 853k/7.7k        $1.14    ✓ PROCEED (4/4)
 5   Summary: Part 4 is complete. Run-ti… 988k/11k         $1.34    ✓ PROCEED (4/4)
 6   Summary: Part 5 is complete. Run st… 3085k/10k        $3.96    ✓ PROCEED (4/4)   ← token spike
 7   Part 6 is complete: documented the… 695k/4.9k        $0.92    ✓ PROCEED (4/4)
totals: decisions 7 · judge passes 7 ($0.07, 0.7%) · rollbacks 1 · escalations 0 · checkpoints 7
        peak window 124% (compact 6) · compactions 2 (pacing 2) · pressure-steps 6 (first pacing fold step 5)
```

## The judge-catch — 🟢 genuine true-positive, pre-land (step 1)

- **What happened:** step 1's directive was PART 1 ONLY (pure `describeEndpointCapability` for API-key providers). The executor also defined, exported, AND consumed `resolveEndpointCapabilities` + `ENDPOINT_CAPABILITY_STAGES` — that is PART 3 code, front-loaded into a PART-1-scoped step.
- **Judge verdict:** rubric `scope_matches_instruction` ✗ → **destructive rubric failure → ROLLBACK to `@base`** (checkpoint `run-d44ff996@4`, `lastGood false`). The other 4 rubric items + all 4 ACs passed; the catch was purely on scope.
- **Recovery:** step 2 redid PART 1 *only* (judge: "matches the scope of Part 1 only… no front-loading"), sealed `lastGood true`. Loop integrity intact — 7 decisions / 7 checkpoints, zero duplicate journal entries, no re-executed step.
- **Why it matters:** this is the **F-130 chunk-scope footprint rubric** (`prompt.ts`, hand-landed 2026-07-11) firing LIVE, and the **first genuine judge true-positive on a real product WP** in the ledger (all prior product runs: 0 catches; 046/048 catches were seeded scaffolding). Cost of the catch: one $1.55 wasted step — cheap insurance against a bad diff landing.

## Delivery quality (human review, post-landing)

- **Verified independently:** all 4 ACs re-run PASS against the working tree (pack §3, full suite **824 passed / 19 skipped**); all 13 harvested `packages/sdk-ts` files byte-IDENTICAL to the run workspace (pack §5). No landed commit (uncommitted — user reviews before committing).
- **PART 1–2 descriptor model** (`src/endpoint-capability.ts`, net-new, 340 lines): `describeEndpointCapability` returns plain-data descriptors for API-key providers (anthropic/openai/gemini), openai-compat, and the CLI executor adapters (claude-code/codex/native) — auth mode (`cli-oauth-or-api-key` | `api-key` | `optional-api-key` | `router-delegated`), limit semantics (`rolling-window` for CLI subscriptions vs per-request `max_tokens` for providers), cost linkage, and model family. Pure, no I/O. No key material in any descriptor (constraint honored).
- **PART 3 resolver:** `resolveEndpointCapabilities` maps a parsed TaskSpec (routing stages + `executor.adapter`) to a descriptor per stage; unknown provider/adapter combos resolve to an explicit conservative `unknown` descriptor (`scheduling: "do-not-assume-headroom"`), never a throw. Overloaded on `RoutingPolicy | TaskSpec`.
- **PART 4 family-separation feed** (`taskspec.ts:286+`, real additive rewrite): invariant #2 (judge family ≠ executor family) now reads the family from `endpointCapabilityFamily(capabilities.code[0])` with a `?? spec.executor.family` fallback, so existing specs validate byte-identically. Added an adapter↔family consistency check (claude-code⇒anthropic, codex⇒openai).
- **PART 5 replay-safe journal** (`activities.ts:522`): resolved per-stage capabilities journaled once at run start via idempotent `appendOnce({ field: "capabilityIndex", value: 0 })` — replay-safe by construction; `chikory trace` renders an endpoints summary line (`trace.ts` `endpointSummary`) that returns `undefined` (renders as today) when no capability entry exists.
- **PART 6 docs:** `docs/components/router.md` + `docs/spec/task-spec.md` updated. Additive throughout — a run that never consults a capability behaves and renders exactly as before.

## New friction

- **F-132 (ℹ️ token economics, no new WP) — step 6 input-token spike: 3.08M in / $3.96 (36% of run cost) for a 11.8KB diff.** PART 5 (journal surface) cost ~3× the median step despite a modest diff; 54 tool calls, 6m8s. This is the expected context-rot economics the ladder already tracks (WP-203/WP-207) — codex re-sends accumulated context each durable step and PART 5 touched the widest surface (activities/trace/types + tests). Baseline data point, not a defect. Recorded; no WP spawned (WP-203/207 already own it).
- **F-133 (ℹ️ chunk-directive advisory ≠ enforcement, no new WP).** The executor front-loaded PART 3 *despite* an explicit "do NOT front-load a later PART" in both the goal and the `work_chunks` directive — the directive is advisory to the model; the **judge rollback** (F-130 footprint rubric) is what actually enforces it, at a cost of one wasted step ($1.55). This is the designed belt-and-suspenders posture (WP-271 chunk-scope), not a regression — noting that per-chunk prompting alone does not prevent front-loading; the gate does. No WP (F-130 mechanism already covers it).

## Verdict on the thesis

🟢 **Strong.** The run advanced a real open product WP on the vendor-neutral routing pillar (WP-307 — the substrate WP-308/309 depend on) AND produced the ledger's **first genuine product-run judge true-positive pre-land**: the executor made a real scope error, the family-diverse judge caught it deterministically via the F-130 footprint rubric, rolled back to base, and the run recovered and sealed SUCCESS unattended. Per-step reliability shows the nuance the KPI intends — 1 rollback over 7 steps is the *executor* erring and the *judge* catching, which is the whole thesis working, not a durability miss.
