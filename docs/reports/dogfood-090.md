# dogfood-090 — WP-105 (durable-loop OTel spans) durable-root-context fix (the F-116 cure), run as the LITERAL ⑦ (~overnight) SOAK. An autonomous `chikory run` endured **6h 19m** across **4 durable parks each 90 min (ABOVE the proxy-token TTL) / 6h slept** and sealed SUCCESS, landing the WP-105 (OTel — all agent runs emit spans) fix that makes the run-root span tree stay run-rooted across every park **without any process-local memory**. Both un-proven ⑦-literal axes from dogfood-089 are now closed: token-refresh-across-park is surfaced (survived 4 parks longer than the TTL) and F-116 (process-local span-parenting Map) is FIXED and **live-proven on a genuine second worker process**.

- **WP:** WP-105 — OTel spans for the durable loop (observability pillar; CLAUDE.md "all agent runs emit OTel-compliant spans" + "full trajectory observability"; REQUIREMENTS OB-4). A real open plan.md §6 product WP. WP-272 (soak / time-paced durable re-entry) is the RUN VEHICLE (paces the run over hours); the durable-root-context fix is the LANDED PRODUCT DIFF (§1.2 — real WP, not scaffold).
- **Date:** 2026-07-07
- **Spec:** `examples/dogfood/dogfood-090-wp105-durable-span-context-overnight-soak.yaml` (LOOSE — outcome-shaped goal, five dependency-ordered PARTs; module/test layout left to the executor, F-82/F-83). Ladder-rung 4 (the ⑦-literal overnight consolidation). Thesis-KPI: wall-clock endurance toward the literal ⑦.
- **Run-id:** `run-45ce1499-7463-4492-ba66-0d252e0c229c` (SUCCESS · 5 steps · autonomous · byte-identical harvest on the working tree)
- **Landed:** un-committed (staged) on the working tree, byte-identical to the run workspace (§5 all `IDENTICAL`). HEAD at review `30988f8`. Pending user review/commit.
- **Mode:** `chikory run` (single durable run, UNATTENDED — `unattended:{escalation:seal_resumable_failed}`) under a real `soak` policy (`sleep_ms 5_400_000` = 90 min × `max_reentries 5`; 4 parks fired between the 5 chunks ≈ 6h slept).

## Trace

```
run run-45ce1499-7463-4492-ba66-0d252e0c229c · SUCCESS · 5 steps · $4.94 / $80.00 · 6h 19m · executor codex(openai) · judge openai-compat/gemini-3.1-pro-preview
 #   step (chunk)                          tokens(in/out)  cost     diff    verdict            note
 1   PART 1 pure resolveRunRootContext     724k/4.2k       $0.95    3078B   ✓ PROCEED (2/4)    AC-2/AC-3 unmet = PART-2..5 not yet landed, BY DESIGN
 2   PART 2 parent children under derived  922k/7.4k       $1.23    6377B   ✓ PROCEED (4/4)    Map lookup replaced by derived SpanContext
 3   PART 3 root span + terminal seal      849k/8.5k       $1.15    ~diff   ✓ PROCEED (4/4)    start/end lifecycle spans, no Map, no leak
 4   PART 4 soak-park span-root survival   761k/5.9k       $1.01    4974B   ✓ PROCEED (4/4)    post-park spans parent under same derived root
 5   PART 5 LIVE cross-park proof          417k/4.6k       $0.57    4522B   ✓ PROCEED (4/4)    fresh-worker + exporter-reset live tests
totals: decisions 5 · judge passes 5 ($0.04, 0.9%) · rollbacks 0 · escalations 0 · injections 0 · checkpoints 5
        pacing events 5 · peak window 1% (compact 0 · park 0) · re-entries 4 · soak-slept 6h 0m · feedback 1/1 steps
        issues found 3 · changes made 5 (issues:changes 3:5) · exact cost sum $4.9417
        checkpoint chain @4→@16→@22→@28 (lastGood true each) · commits 1a8a7578ceea … 316196742207
```

## Delivery quality (human review, post-landing)

Landed diff (staged, `git diff --cached`), 4 files, +326/−18:

- `src/otel.ts` (+94/−18) — **the fix.** `resolveRunRootContext(runId)` derives a stable W3C traceId (32-hex) + spanId (16-hex) via `sha256("chikory.run-root:" + runId)`, `forceNonZeroHex` guarding the all-zero invalid case. `runRootOtelContext` rebuilds the parent SpanContext (`trace.wrapSpanContext` + `trace.setSpan`) from that derivation; `startRunChildSpan` now parents children under it with **no `activeRunSpans` Map lookup**. The module-level `activeRunSpans` Map is deleted entirely. `recordRunStartSpan`/`recordRunEndSpan` each mint a `chikory.run` span, force its identity onto the derived id via `applyDerivedRunRootIdentity`, and `end()` it immediately.
- `src/index.ts` (+1) — barrel re-export of `resolveRunRootContext`.
- `test/otel.test.ts` (+45/−2) — unit: determinism, well-formedness, distinctness; start/end spans carry the derived id; the existing parenting test rebased onto the derived root.
- `test/runner/soak-live.test.ts` (+195/−7) — **two new LIVE Temporal tests** (see below).

**Verified independently:**
- §3 all 4 ACs re-run against the working tree — **PASS** (exit 0 each). AC-4 = `tsc --noEmit && eslint . && vitest run` → **753 passed / 19 skipped (772)**.
- §5 harvest byte-diff — all 4 files **IDENTICAL** to the run workspace. No drift.
- §4 scope — only the 4 files the goal names changed. No new dependency (`@opentelemetry/api` + `sdk-trace-base` were already present). No frozen-contract shape change.
- Determinism constraint honored: all span emission stays in the activities / `src/otel.ts` helpers; nothing moved into the `agent-loop.ts` workflow body.

**The live tests are the strongest part of this run** — and materially stronger than 089's single-worker proof:
- `post-park spans survive re-entry on a fresh worker` — starts worker A, drives the run to a soak SUSPEND at step 1, **shuts A down, starts a genuinely separate worker B** (`createRunnerWorker`), and asserts the post-park step/checkpoint/`chikory.soak.reentry` spans still share the derived run-root traceId + parent spanId. This is the **actual F-116 regression surface** (a different worker process), not a simulated Map-clear.
- `post-park spans keep the pre-park run-root trace after clearing in-memory span state` — resets the `InMemorySpanExporter` mid-park and asserts the post-park root reconstructs the SAME derived traceId. Proves durability across lost in-process state.

**Verdict: 🟢 genuine, non-hollow, correct.** 5 distinct non-empty diffs (3078–6377 B), one bounded sub-goal per sealed checkpoint (the non-hollow horizon, F-100/WP-270). The fix is the right shape: a deterministic run-id→SpanContext derivation is exactly the durable-context-propagation cure the 089 report prescribed for F-116, and it is live-proven cross-worker.

## New friction

Highest prior = **F-116**. Continue at F-117. (F-490 in dogfood-069 is a test-token string, not a friction id.)

### 🟡 F-117 → track-B / DOGFOODING §8 (NEW, dogfood-090, delivery — private-field mutation forces the root span identity)
- **Evidence:** `applyDerivedRunRootIdentity` (`src/otel.ts`) reaches into SDK-internal fields — it reassigns `span._spanContext` and clears `parentSpanContext` on the concrete span object from `@opentelemetry/sdk-trace-base`. The OTel **API** exposes no way to set a span's own spanId (that is the SDK `IdGenerator`'s job), so to make the emitted `chikory.run` root's spanId equal the derived id the executor mutates the private `_spanContext`, guarded by a structural `hasMutableSpanContext` typeguard.
- **Impact:** fragile against an `@opentelemetry/sdk-trace-base` upgrade that renames/reshapes `_spanContext`/`parentSpanContext`. The failure is **silent**: the typeguard just returns the span un-mutated, the root reverts to a random SDK-generated spanId, children's `parentSpanId` (still the derived id) no longer matches the root → orphan tree again — the exact F-116 symptom, but now with no Map to blame and no test that pins the SDK internal shape. Not a correctness bug in the loop (spans are side-effects), so track-B, not loop-integrity.
- **WP it spawns:** none new; track-B refinement folded under WP-105. The clean cure is a per-run seeded **custom `IdGenerator`** (public SDK extension point) or emitting the root purely as a wrapped `SpanContext` (no concrete Span), so no private field is touched. Record as a DOGFOODING §8 known limitation until a production OTel SDK bump forces it.

### 🟡 F-118 → track-B / DOGFOODING §8 (NEW, dogfood-090, delivery — the run-root span no longer measures run lifetime; two spans share one spanId)
- **Evidence:** In 089 there was ONE long-lived `chikory.run` span (opened by `recordRunStartSpan`, `end()`ed by the terminal seal) that carried the run's wall-clock duration. Now `recordRunStartSpan` and `recordRunEndSpan` each start a span and `end()` it immediately (`lifecycle: "start"` / `lifecycle: "end"`), both forced onto the **same derived traceId AND spanId**. The unit test asserts exactly this (`runSpans toHaveLength 2`, same `spanContext().spanId`).
- **Impact:** (a) no span carries this run's 6h 19m duration — an operator reading the trace must diff the start/end timestamps of two spans to recover run wall-clock; the goal asked the root to "still carry the run-lifetime + status attributes it did in 089" and only the *attributes* survived, not the lifetime. (b) two exported spans sharing one spanId is technically non-conformant OTel (spanId should be unique per span) — some backends may dedup or mis-render them. This is a direct consequence of the durable design (you cannot hold one live `Span` object across a durable park on a fresh worker), so it is an inherent trade, but it is a real observability regression from 089 worth recording.
- **WP it spawns:** none new; track-B under WP-105. Options: emit the root as a single zero-width marker with an explicit `run.duration_ms` attribute computed from the journal at seal time, or model start/end as two DISTINCT child spans of the derived root rather than two copies of the root itself.

### Carry-forward observations (not numbered friction)
- **✅ Token-expiry-across-park is now SURFACED (089 carry-forward CLOSED).** Parks were 90 min, above the nominal ~60-min proxy-token TTL; the run reached SUCCESS across 4 such parks — later steps could not have authed had the token not refreshed across a park. Surfaced by survival (no explicit refresh event is logged; an explicit `token.refreshed` span/log would make it auditable rather than inferred — minor, opportunistic).
- **Compaction never fired — `peak window 1%` (compact 0, park 0).** The 6h came from IDLE soak parks, which add zero context. WP-203/204/207 (context-rot / compaction) are all 🟢 at the mechanism level but have NEVER fired in a dogfood headline. This is the un-proven half of the ⑧ P2 exit gate and drives the next headline (see below).
- **Input-token economics:** 417k–922k input tokens/step (codex reloading its own context each re-entry), 4.2k–8.5k output. Baseline for WP-203/207; unchanged shape from 089. Note `peak window 1%` is Chikory's tracked context-window fraction (the agent-loop's own window), distinct from codex's internal token consumption above.

## Verdict on the thesis

🟢 **The ⑦ literal-overnight consolidation is DONE, and the one real 089 finding (F-116) is CURED and live-proven cross-worker.** For the first time the durable OTel span tree is proven to stay single-run-rooted across a genuine **second worker process** — the deterministic run-id→SpanContext derivation removes the last process-local dependency in the observability path, exactly the durable-context shape the loop already uses for state. The run endured 6h 19m / 4 parks above the token TTL, unattended, self-certifying SUCCESS — surfacing token-refresh-across-park, the second 089 gap. The judge held family diversity (gemini-3.1-pro ≠ codex/openai), executed every AC, and correctly gave step 1 a 2/4 PROCEED (honest work-in-progress, not a rubber-stamp) — WP-273 chunk-aware verdict's 3rd clean live validation. Two new track-B findings (F-117 private-field mutation, F-118 root-span-lifetime) are refinements of the fix, not correctness bugs. **Net:** the ⑦ rung is fully consolidated; the remaining ⑧ P2-exit axis is now cleanly isolated — **endurance via idle soak is proven, but context-growth-driven compaction has never fired live.** That is the next headline.

## KPI table (DOGFOODING §1.4)

| KPI | 090 | Trailing-3 (088/089/090) | Gate |
|---|---|---|---|
| Max horizon survived | **5 steps / 6h 19m** | **6h 19m (090)** — 2.2× the prior best (089 2h50m) | ⑧ P2-exit = 24h+ (closer, not there) |
| Kill→resume count | 0 (4 durable soak re-entries, not crashes) | 0 | resume proven earlier (WP-206/dogfood-077) |
| Judge true-positives pre-land | 0 (no seeded defect; step-1 2/4 is by-design AC progression, not a catch) | 0 | opportunistic |
| Meta:product headline ratio | product | **0:3** | ≤1:3 ✅ |
| Per-step reliability (runs ≥5 steps) | 5/5 PROCEED, sealed SUCCESS | 100.0% (0 rollbacks / ~29 steps, 4 runs ≥5) | 99%+ ✅ |
| Ladder rung | **4** (⑦ literal-overnight consolidation) | 3 → 4 → **4** (✅ PROGRESSING) | P2 exit = ⑧ 24h+ |

**Glossary:** WP = Work Package · AC = Acceptance Criterion (grep/exit-code check the judge runs) · rung = WP-265 horizon-ladder step (④ = hours/wall-clock endurance, ⑦ = literal ~overnight, ⑧ = P2-exit 24h+ brownfield) · soak = a durable idle/re-entry interval (WP-272) that produces real wall-clock via a zero-compute Temporal timer · durable park / re-entry = the workflow SUSPENDs on a Temporal timer then resumes from its journal · derived run-root context = `resolveRunRootContext(runId)` → a stable W3C traceId/spanId hashed from the runId, so any worker reconstructs the same span parent · span tree = the OTel parent/child trace structure · peak window = the fraction of the context window used (compaction fires when it climbs) · non-hollow = every sealed step carries distinct product work · F-116 = the fixed-this-run bug where the run-root span lived in a process-local Map.
