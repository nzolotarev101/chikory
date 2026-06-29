# dogfood-066 — FIRST durable CHAIN on real product code (WP-256 spec-staleness gate) — *node A HALTed: planner dropped the grep-pinned literals*

- **WP:** WP-256 (launch-time spec-staleness gate, born from dogfood-065 F-60). Attempted as a 2-node durable CHAIN — node A `parseWpStatus` parser, node B `assessSpecStaleness` consumer importing node A's symbol via the WP-239 handoff. The chain is the thesis vehicle (no seam): planner-decompose → meta-judge gate → durable per-node journal.
- **Date:** 2026-06-29
- **Spec:** `examples/dogfood/dogfood-066.yaml` (`dogfood-066-chain-wp256-spec-staleness`)
- **Run-id (chain):** `chain-15509162-b259-483c-b313-f9d7dbafbcfa` (plan `plan-a6f82468-b3ac-4bf9-80dd-c709bcc1af8e`); node-a child run `chain-15509162-b259-483c-b313-f9d7dbafbcfa-node-node-a` (runtime HEAD `e423b64`).
- **Landed commit:** none — chain FAILED, nothing harvested. Working tree clean (pack §4 empty); node A's diff lives only in `.chikory/runs/<node-a>/workspace` (committed there as `5a00f88`/`14decf1`/`a389c4e`).
- **Gate verdict (pre-launch, recorded in spec header):** ✅ **PROCEED** — §1.1 ✅ genuine 2-node chain on the durable-execution pillar · §1.2 ✅ advances real open 🔴 WP-256 · §1.3 ✅ thesis-stressing slice on a real WP, user-confirmed. **This review CONFIRMS the gate was right: the run surfaced exactly the "🟡 ALSO VALID THESIS DATA" outcome the spec predicted — a real durable-chain friction on real code (F-62).**

## Outcome in plain English

The first durable multi-node chain on real product code **FAILED at node A** — but it failed *usefully*, surfacing a genuine bug in the chain machinery rather than a flaw in the work. The chain planner took node A's detailed brief (which mandated **verbatim** test fixtures `WP-255`/`WP-25` that a grep enforces) and **compressed it to a single sentence**, dropping those literals. The executor then built a perfectly reasonable parser, wrote its own passing tests using *real* `plan.md` WP ids — and was graded against an acceptance check it was never told the secrets of. It could not win from step 1. The judge's budget-waste guard correctly **HALTed after 3 consecutive failures** ($3.76 of the $6 node budget), so the loop didn't burn the whole budget on an unwinnable task. Node B never ran.

**Net:** WP-256 NOT delivered. The chain pillar's decompose + meta-judge gate + durable node-A journal WERE exercised (good); the WP-239 dependent handoff was NOT (node B blocked). New blocker F-62 → **WP-257** (planner must preserve mandated literals into node goals).

## Trace (excerpt)

```
run chain-15509162-…-node-node-a · FAILED · 3 steps · $3.76 / $6.00 · 7m 51s · executor codex(openai) · judge openai-compat
 #   step                                 tokens(in/out)   cost     verdict
 1   Done. Added parseWpStatus plus fo…   1410k/7.2k       $1.83    ✓ PROCEED (0/1 criteria)
 2   Implemented the remaining AC-1 cle…  844k/5.7k        $1.11    ✓ PROCEED (0/1 criteria)
 3   Implemented the WP status parser/t…  614k/3.7k        $0.80    ⛔ HALT
        judge: "criterion AC-1 failed 3+ consecutive verdicts → HALT (goal drift / budget-waste guard)"
totals: decisions 3 · judge passes 3 ($0.01, 0.3%) · rollbacks 0 · escalations 0 · injections 0
        checkpoints 3 · peak window 0% · issues found 6 · changes made 3 (issues:changes 6:3)
chain: plan-judge PROCEED · 2 nodes · node-a FAILED (HALT) · node-b pending (never dispatched) · 0/2 succeeded
```

- Plan-judge **PROCEED** on the decomposition (the meta-judge gate ran and passed).
- Every step's judge rubric was **3/3 green on the non-destructive items** (`no_unrelated_deletions`, `no_secrets_introduced`, `scope_matches_instruction`) — the only failure was `AC-1` (the grep), every step.
- Cost-share: total **$3.7609 / $6.00 (62.7%)**, judge share **0.3% ($0.0113)**, no empty-diff probe step (F-11 did not recur).

## Root cause (human review of journal + workspace + source)

The spec `goal` carries the full Node A brief, including this **verbatim, grep-pinned** mandate:

> …encoding AT LEAST these cases verbatim … a 🟢 row for `WP-255` → `"green"` … the EXACT-MATCH discriminator — a fixture containing BOTH a `| WP-25 | … | 🔴 | …` row and a `| WP-255 | … | 🟢 | …` row …

The AC-1 check enforces it: `… && grep -q "WP-25" test/cli/wp-status.test.ts && pnpm exec vitest run …`.

**What the executor actually received** (`chikory trace … --step 1`, `instruction:` / `plan item:` lines, identical):

> "Implement packages/sdk-ts/src/cli/wp-status.ts and packages/sdk-ts/test/cli/wp-status.test.ts to parse and test WP status from plan.md markdown tables."

That one sentence is the **planner-generated `node.goal`** — `runPlannerPass` paraphrased node A's brief and **discarded every mandated literal** (`WP-255`, `WP-25`, the exact-match discriminator). `planNodeToTaskSpec` (`src/chain/node-spec.ts:91`) then sets the child run's `goal = node.goal`, so the executor never saw the fixtures the grep checks for. Critically, the planner **preserved the strict AC-1 grep verbatim** while paraphrasing away the prose that tells the executor what to write — an asymmetry that makes the node structurally unwinnable.

The executor did sane work against the brief it had: a generic markdown-table parser (header `WP`/`Status` columns + separator-row detection) and a 5-case test using **real** `plan.md` ids — `WP-001`, `WP-002`, `WP-111`, `WP-210`, `WP-30`, `WP-301`, `WP-302` (and hallucinated `F-49 grep-pinned mandated case` comments pulled from confused context). Its own tests pass (`5 passed`, tsc 0, eslint 0). But `grep -q "WP-25"` over that test → **exit 1** (verified independently against the workspace tree: no `WP-25` literal present). AC-1 fails every step → 3-strike HALT.

## Delivery quality (human review)

- **WP-256 delivered?** ❌ No. Node A never sealed SUCCESS; node B (the actual WP-256 staleness decision) never dispatched. WP-256 stays 🔴.
- **Scope:** clean — working tree untouched (pack §4 empty), nothing harvested. The node-A artifacts are quarantined in the run workspace. No cleanup needed.
- **The chain path WAS genuinely exercised** (F-32 guard satisfied): `.chikory/chains/chain-15509162-…` exists with a `ChainJournal`; plan-judge PROCEED is journaled; one `…-node-node-a` child run exists. It correctly stopped at the FAILED node and did not dispatch node B.

## New friction

### F-62 (🔴) — the chain planner drops grep-pinned mandated literals from node goals → the executor is graded against an AC it was never told → WP-257

- **Evidence:** spec `goal` mandates verbatim `WP-255`/`WP-25` fixtures; AC-1 greps `WP-25`; the executor's `instruction`/`plan item` (trace step 1) was the one-line paraphrase with no literals; the workspace test contains zero `WP-25` (independently `grep`-confirmed, exit 1); 3 steps / $3.76 burned on a structurally unwinnable node before the HALT guard fired.
- **Why it matters:** F-49 discipline ("each AC greps the mandated literals verbatim so the executor cannot skip/stub the primitive") **assumes the executor receives the brief that names those literals.** In a single `run` that holds — the goal goes straight to the executor. In a `chain`, the planner re-summarizes each node's goal and the literals are lost, while the strict grep AC survives. Every grep-pinned chain dogfood inherits this trap. This is the first-ever real durable-chain-on-real-code friction (the pillar was avoided across dogfood-042→065 precisely to dodge findings like this) — exactly the data the run was launched to get.
- **Spawns WP-257** (🔴): the planner must carry mandated/verbatim content into node goals. Two designs: (a) when a spec `goal` contains explicit per-node sections (`Node A:` / `Node B:`), pass them through **verbatim** as the node goals instead of re-summarizing; (b) instruct `runPlannerPass` to preserve any quoted literal / `grep`-pinned token / fenced code block from the source goal into each node's goal, and add a planner-output check that every AC-referenced literal still appears in some node goal. Sibling of WP-232 (chain-launch verification).

### F-63 (🟢, positive — no WP) — the budget-waste HALT guard worked exactly as designed

- **Evidence:** AC-1 failed steps 1–3; on step 3 the judge fired `criterion AC-1 failed 3+ consecutive verdicts → HALT (goal drift / budget-waste guard)`, sealing the node FAILED at **$3.76 / $6.00 (62.7%)** rather than letting it churn to the 8-step / full-budget ceiling.
- **Why it matters:** a structurally-unwinnable node is the worst budget sink (every step looks like "progress, no regressions" to the per-step judge). The 3-strike consecutive-failure HALT is the right circuit-breaker and it caught this cleanly. No change needed — recorded as a thesis-positive signal (the quality gate bounded the waste from a real bug). One tuning datapoint for the future: 3 strikes here cost ~63% of budget; if node budgets shrink, a 2-strike threshold would bound it tighter.

## Verdict on the thesis

🟢 **Strongly positive — this is what dogfooding the durable-chain pillar is FOR.** The chain ran for real on real product code for the first time, and instead of a green dashboard it produced a precise, reproducible bug in the decompose layer (F-62/WP-257) plus a clean demonstration that the budget-waste guard bounds the cost of such a bug (F-63). The §1.1/§1.3 gates predicted this exact "🟡 ALSO VALID THESIS DATA" branch and it paid off. The one caution: WP-256 (the product WP) is **still 🔴 and unblocked** — it must not get lost behind the new WP-257. Deliver WP-256 via a single `run` (which carries the full goal+literals, sidestepping F-62) next, and tackle WP-257 to unblock grep-pinned chain dogfoods after.
