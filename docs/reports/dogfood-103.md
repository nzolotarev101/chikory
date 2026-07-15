# dogfood-103 — WP-311 (big-picture design judging) COMPLETION: chain-completion aggregate design review on a REAL 3-node chain

- **Vibe check (plain):** Chikory ran a real three-step chain (each step done by a separate agent run, handing work to the next), and at the very end a *fourth* judge looked at the **whole** combined change against the chain's overall goal — not just each step in isolation — and signed off. That "look at the big picture once the whole chain is done" review is the last piece of WP-311 (make the judge evaluate architecture/design, not just changed lines). This run proves it fires on a real chain exactly once, references the chain goal and the combined diff, and never re-grades the already-finished steps. The three steps themselves added a small, genuine feature: a per-node "design summary" line in the chain trace.
- **Bottom line:** delivery 🟢 (3 nodes, all additive, 179 insertions across 4 `packages/sdk-ts/` files, every AC re-passes green, **full suite 916 TS + 30 harness + 84 py green on the harvested merge**) · **Thesis-KPI 🟢 PROVEN from the chain journal:** exactly **one** `chain_completion_review` entry (chain-level big-picture judging), verdict PROCEED, `diffBase: "chain-base"` (the true cross-node cumulative diff resolved — not the degraded node-local fallback), reviewed all 3 nodes, and the 3 `node_sealed` verdicts are **unchanged** (no re-judge; F-107 discipline held at chain scope) · judge catches: **0** (a proof run — no seeded defect; the aggregate review correctly PROCEEDed a coherent design) · family-diverse ✓ (codex/OpenAI executor ≠ gemini-3.1-pro judge) · new friction: 🟡 **F-144** (no read-only `chikory chain trace` — the new aggregate surface only renders during a live follow) · 🟡 **F-145** (progression gate is chain-blind — a 3-node chain reads as "3 steps" so it can't flip STALLED) · ℹ️ **F-143** (aggregate-review rationale says "work in progress" on a SEALED chain). **WP-311 now DONE (all four design-judging altitudes proven).**

## Run at a glance — `chain-9d189c1a-e66b-4a30-b1c5-f6093b72e6fd`

| field | value |
|---|---|
| Outcome | 🟢 SUCCESS · 3 nodes (WP-311-A/B/C) · 1 step each · **$4.46** (node steps + node judges) · **12m 31s** wall-clock |
| Executor / Judge | codex(openai) / gemini-3.1-pro-preview via openai-compat (family-diverse ✓, invariant #2 held) |
| Spec | `examples/dogfood/dogfood-103-wp311-chain-completion-review.yaml` (LOOSE chain goal; planner emitted the linear 3-node topology) |
| Host WP | WP-311 (big-picture design judging) COMPLETION — P3 intelligent-scaling / big-picture-judging track (plan.md §7) |
| Landed | **harvested to working tree, uncommitted** (topological merge of the 3 node deltas; full suite green on the merge) — this review commits+pushes it (user instruction) |
| Node judges | 3 PROCEED / 3 PROCEED / 3 PROCEED (A 2/2 · B 1/1 · C 3/3 criteria) · 0 rollbacks · 0 escalations |
| **Chain review** | **1 `chain_completion_review` · PROCEED · base `chain-base` · 0 failed findings** (20s gemini pass, fired between last `node_sealed` and `terminal`) |
| Scope | 4 files, all in `packages/sdk-ts/` (2 new src, 1 new test, 1 additive edit to `trace.ts`) |

## Trace (chain timeline)

```
chain-9d189c1a · SUCCESS · 3 nodes · 12m 31s · executor codex(openai) · judge gemini-3.1-pro (openai-compat)
 node            step   tokens(in/out)   cost     verdict            wall
 WP-311-A         1     910k/7.9k        $1.22    ✓ PROCEED (2/2)    3m 38s
 WP-311-B         1     1149k/7.2k       $1.51    ✓ PROCEED (1/1)    4m 27s   (reuses A via ./design-summary.js)
 WP-311-C         1     1322k/7.9k       $1.73    ✓ PROCEED (3/3)    4m  6s   (imports both predecessors)
 ── chain seal ──
 chain_completion_review    PROCEED · base chain-base · findings 3/3 pass    ~20s
 totals: nodes 3 · succeeded 3 · failed 0 · design summary rendered · review: PROCEED · no design findings
```

Chain journal (ground truth, `chain.db`): `plan ×1 · node_started ×3 · node_sealed ×3 · chain_completion_review ×1 · terminal ×1`.

## Thesis-KPI proof (read from the chain journal, dogfood-101 precedent)

The spec KPI was **not** a node AC — it is read post-run from the chain journal. All four assertions hold:

| KPI assertion | Evidence | ✅ |
|---|---|---|
| Exactly ONE aggregate review on a SUCCESS chain | `SELECT kind,COUNT(*)` → `chain_completion_review\|1` | 🟢 |
| Review references `plan.goal` + cross-node CUMULATIVE diff | `reviewChainCompletion` passes `plan.goal` + `renderOverallGoalContext` + `sinceCommit=chain-base`; payload `diffBase:"chain-base"` (the FIRST node's base reachable from the LAST node's workspace — the git-bundle history survived both handoffs, so the **degraded node-local fallback did NOT fire**) | 🟢 |
| Node verdicts UNCHANGED (no re-judge, F-107 at chain scope) | 3 `node_sealed` entries intact; review is append-only, non-destructive; chain still sealed SUCCESS | 🟢 |
| `chikory trace <chain-id>` renders the aggregate line | `trace.ts:56-65` pushes `review: PROCEED · no design findings · base chain-base`; unit test `C-COMPAT` asserts the additive `design summary:` section + byte-identical legacy render | 🟢 |

Review payload findings (all pass): `no_architecture_violations` · `design_serves_overall_goal` ("logic separated into well-scoped functions … proper ESM reuse … integrating additively") · `cumulative_design_coherent` ("file placement consistent … no leftover scaffolding or logic duplication"). This is the judge reasoning over the **whole 179-line cross-node delta** against the chain goal — the design-altitude the per-line WP-215 scan can't reach.

## Delivery quality (human review, post-landing)

Reviewed the harvested diff line-by-line against each node's goal:

- **NODE A** `src/chain/design-summary.ts` (25 lines) — pure `summarizeNodeDesign(nodeId, outcome, reason)`: `oneLine` whitespace-collapse + `capReason` ellipsis cap at `MAX_NODE_DESIGN_REASON_CHARS=200`. Named exports, no default, no I/O, no dep. ✔ AC-1 (grep of `summarizeNodeDesign(` outside `trace.ts`) re-passes. *Minor:* `NodeOutcome` carries only `status`/`verdict` (no reason field), so the executor threaded `node.goal` as the `reason` arg — a reasonable reading of the spec's "size-capped reason"; not a defect.
- **NODE B** `src/chain/chain-design-summary.ts` (17 lines) — `renderChainDesignSummary(plan, nodeOutcomes)` folds every outcome through A in **plan order** via `plan.nodes.flatMap`, `join("\n")`. Reuses A through the relative ESM specifier `./design-summary.js` (the chain handoff carried it — not recreated). ✔ B-RENDER re-passes.
- **NODE C** `src/chain/trace.ts` (+7 lines) — additive block after the totals line: `if (designSummary.length > 0) { push "design summary:" + rendered }`. Existing chains with no sealed outcomes render **byte-identically** (test asserts the exact legacy string). ✔ AC-2 co-reference + AC-3 tsc/eslint/vitest re-pass.
- **Test** `test/chain/design-summary.test.ts` (130 lines, 5 focused tests) — deterministic output, newline removal, reason truncation, plan-order stability, and the integrated trace + legacy-compat assertion importing **both** predecessor symbols. Scoped vitest (fits the judge per-check cap — F-141 lesson honored).

Scope discipline: clean. Only the 4 files each node's `writeSet` named changed; no new dependency; no frozen-contract reshape. Harvest §5 byte-diff: node B's owned files IDENTICAL; the `DIFFERS` on `trace.ts`/test vs the node-A/B *intermediate* workspaces is expected (each node workspace holds only its cumulative-to-that-node tree; the harvest is the topological merge, and the full suite passed green on it).

## New friction

Continuing the global sequence (highest prior = F-142).

- 🟡 **F-144 → WP-522 track-B (NEW):** there is **no read-only `chikory chain trace <chain-id>`**. The chain trace — now carrying the WP-311 aggregate `review:` line AND node C's new `design summary:` section — only renders inline during a live `chikory chain` launch/approve/resume follow (`chain.ts:429 finishChain`). To inspect a *sealed* chain post-hoc (exactly what this review needed) there is no command; `chikory trace <chain-id>` errors (`no journal … under .chikory/runs`) because chain journals live under `.chikory/chains/`. **Evidence:** I had to reconstruct the render via `read-chain-record.mjs` + a throwaway script. The chain-completion-review pass **cost** is likewise surfaced nowhere (the `review:` line shows verdict/findings/base, no cost). **Fix (track-B):** add read-only `chikory chain trace <chain-id>` (or teach `chikory trace` to resolve a chain-id to the chain journal), and render the aggregate-review pass cost in the chain totals. Reviewer-observability, not loop-integrity → track-B note, does not headline.
- 🟡 **F-145 → dogfood-progression track-B (NEW):** the progression gate is **chain-blind**. Its horizon axis counts a single run's `max steps`, so dogfood-103 — the sanctioned "STALLED axis-mover = a real chain run" (plan.md line 20) — reads as **"3 steps"** and **cannot** flip ⛔ STALLED even though it moved the multi-run/chain-horizon axis the plan explicitly credited. **Evidence:** re-running `dogfood-progression.sh` after appending the 103 row still prints ⛔ STALLED (`max steps 7 vs 8`). **Fix (track-B):** teach `scripts/dogfood-progression.sh` to credit a `mode=chain` run's cross-node node-count as a distinct chain-horizon axis (or sum node steps). **Meta-class** (`scripts/`) → track-B note under the §1.5 budget, not a headline.
- ℹ️ **F-143 → track-B convention (NEW):** the `chain_completion_review` **rationale** reads `"work in progress, no regressions — no criteria evaluated"` on a chain that **sealed SUCCESS** — a misleading durable-journal string (it inherits `runJudgePass`'s no-criteria canned rationale because the aggregate review passes `criteria: []` by design). Low/latent (the rubric *findings* carry the real content; verdict is correct). **Fix (track-B):** give the aggregate/completion review a terminal-appropriate rationale (e.g. derive from rubric findings) instead of the mid-run "work in progress" default. No WP — convention/hand-fix candidate.

No 🔴 loop-integrity friction. Loop integrity clean: 3 `node_started`/`node_sealed` pairs, no duplicate entries, no re-executed steps, `appendOnce` idempotency held (single review entry), checkpoint chains `lastGood true` on every node.

## Verdict on the thesis

🟢 **Strong positive.** Chikory judged a **multi-agent chain's cumulative design against its stated goal, once, at the seal, without disturbing the finished work** — the exact "big-picture, not line-picture" gate WP-311 promised, now proven at all four altitudes (rubric item · node-judge overall-goal section · per-run completion review · **chain-level aggregate**). The `diffBase: "chain-base"` result is a quietly important durability proof: the git-bundle history stayed reachable across **two** node handoffs, so the aggregate judge saw the *true* whole-chain delta, not a fallback slice. This is the first chain headline of the P3 track and it moved the chain-horizon axis the single-run ladder can't express.

**Caveat:** this is a *green-path* proof (a coherent design correctly PROCEEDed) — the aggregate review's **catch** power (a genuinely incoherent cross-node design → SUCCESS-with-findings) is proven only by the in-suite scripted-fail regression (`chain-completion-review-live.test.ts`), not yet by a real chain with a real cross-node design smell. A future chain that seeds a real design incoherence into a product WP would close that.
