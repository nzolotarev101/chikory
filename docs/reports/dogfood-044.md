# Dogfood-044 — WP-241 chain-level child approval/resume proof (park did NOT fire)

> **Vibe check:** The chain delivered both files perfectly and sealed SUCCESS
> 2/2 — but the thing this run existed to prove (a parked child surfaced on
> `chikory chain --watch`, then unblocked with `chikory chain resume`) never
> happened, because node B finished its whole job in a single step. The budget
> SUSPEND gate is checked *before* each step, so a one-step node seals SUCCESS
> before the gate ever runs. This is the exact "trigger risk" the spec flagged
> in advance, and it is a first-class result: **proving WP-241 live needs a
> deterministic park-injection seam** (new WP-243), not another budget-suspend
> attempt.

**WP**: WP-241 (chain-visible child approval/resume) · **Date**: 2026-06-21 · **Spec**: [`examples/dogfood/dogfood-044.yaml`](../../examples/dogfood/dogfood-044.yaml) · **Chain**: `chain-bc247058-d070-4b22-a052-3fa140ae94a1` · **Outcome**: **SUCCESS 2/2 — but WP-241 park path NOT exercised** · **Runtime under test**: `8918219` (WP-241 substrate, landed before the run) · **Harvested delivery**: 4 files staged uncommitted on the working tree

## Run evidence

Chain plan (`.chikory/chains/chain-bc247058…/chain.db`, `plan` entry) — both
per-node budgets propagated correctly from the goal:

| Node | budgetUsd | dependsOn | writeSet |
|---|---|---|---|
| node-a | **11.95** | — | `resume-fixture-a.ts` + test |
| node-b | **0.05** | node-a | `resume-fixture-b.ts` + test |

Per-node run journals (`journal.db`):

| Node | Status | Steps | Step cost | Judge cost | tok in/out (step) | Verdict | Wall |
|---|---|---|---|---|---|---|---|
| node-a | 🟢 SUCCESS | s0 only | $0.3235 | $0.0041 | 246,326 / 1,560 | PROCEED · AC-1 pass | 84.0 s |
| node-b | 🟢 SUCCESS | s0 only | $0.3386 | $0.0039 | 255,983 / 1,862 | PROCEED · AC-2 pass | 105.3 s |

- **Chain total: $0.6701 / $12 budget (5.6%)**; judge share **$0.0080 = 1.2%**
  (cap `max_cost_share` 0.5 = 50%, far under).
- **Input tokens: ≈504k** for two one-function modules — baseline data for
  WP-203 / WP-207 (in line with the 500k–790k series range).
- **Wall: ≈3 m 9 s** (11:58:31.838 → 12:01:41.207Z).
- **F-11-closed `s0 j@0` shape held** for both nodes (single real step, judge
  at step 0, no empty-diff probe step).
- **Family diversity real:** executor = `codex`/`openai` (`gpt-5.5` plan/code/review),
  judge = `gemini-3.1-pro-preview` (Google family via `openai-compat`). ≠ executor. ✓

### The park that didn't happen (the point of the campaign)

Node B carried the intended strict `budgetUsd 0.05`, yet **no park occurred**.
Its journal is `step → judge → verdict → checkpoint → terminal` with a single
step at idx 0 — it sealed SUCCESS in one step. The USD budget SUSPEND gate is
evaluated at the **top of the run loop, before each step**, using a pre-step
estimate; step 0 has no prior cost so it always passes, and because node B
needed no step 1, the gate that would have parked it (second-step estimate >
$0.05 cap) **never ran**.

Consequently the WP-241 surfacing path (`followChain` parked-child line +
`chikory chain approve|resume <chain-id>`) had nothing to surface and was
**never exercised live**. The chain journal confirms a clean straight-through
run: `plan → node_started ×2 → node_sealed ×2 → terminal`, zero park/suspend
entries. The spec called this exact outcome in advance (lines 38–43) and
declared it a valid, plan-advancing result requiring a follow-up seam.

ℹ️ **Side-effect of the pre-step-only gate:** node B spent **$0.3425 against a
$0.05 cap (6.85×)**. A node that completes in its first step can overshoot its
USD budget by a full step's cost, because the gate only blocks the *next* step
and never interrupts a running one. By-design today, but worth recording.

## Delivery quality (human review, post-harvest)

Reviewed the landed diff line-by-line against the goal — clean.

- **`packages/sdk-ts/src/chain/resume-fixture-a.ts`** — `resumeFixtureA(): string`
  returns exactly `"resume-a"`. Named export, pure, no I/O. ✓
- **`packages/sdk-ts/src/chain/resume-fixture-b.ts`** — imports `resumeFixtureA`
  from `./resume-fixture-a.js` (ESM `.js` relative), exports
  `formatResumeReport(): string` returning `` `${resumeFixtureA()} + resume-b` ``
  = `"resume-a + resume-b"`. The dependent import is the real evidence that node
  B built on node A's predecessor artifact (WP-239 handoff). ✓
- **Tests** — both focused, asserting the exact strings. ✓
- **Scope** — exactly the 4 files in the two write sets; nothing else touched.
  No default exports, no new deps. ✓
- **Harvest provenance** — all 4 staged files **byte-IDENTICAL** to the node-B
  workspace (which carries both A and B via the handoff). ✓

### Independent verification (re-run against the working tree, in devbox)

| Check | Result |
|---|---|
| `pnpm exec vitest run test/chain/resume-fixture-{a,b}.test.ts` | 🟢 2 passed, exit 0 |
| `pnpm exec tsc --noEmit` | 🟢 exit 0 |
| `pnpm exec eslint .` | 🟢 exit 0 |

AC-1 and AC-2 both fully green independently of the run's own judge verdict.

## Anomaly review

- **Wasted/filler steps:** none — one real step per node, both diff-producing.
- **Cost telemetry:** nonzero USD on every step + judge (no `.00`-with-tokens
  gap; models present in `pricing.ts`). Budget gate is live but, as above,
  structurally cannot fire on a one-step node.
- **Judge behavior:** both verdicts PROCEED; judge-executed checks ran and
  exited 0 (`"judge-executed check … exited 0"` in both forms); no
  ESCALATE/ROLLBACK; family diversity real.
- **Loop integrity:** no duplicate entries, no re-executed steps, no resume;
  checkpoint chain consistent; clean chain journal.
- **Human ceremony:** launched the chain; the planned `chikory chain resume
  --add-budget` recovery step was never reached because no park occurred — the
  WP-241 UX it was meant to test stays unverified end-to-end.

## New friction

**F-44 — the budget-SUSPEND trigger cannot reliably park a node, so WP-241's
live proof is blocked.** Evidence: node B carried `budgetUsd 0.05` yet sealed
SUCCESS in a single step (`journal.db` idx 0 = only step); the pre-step,
top-of-loop budget gate never evaluated a second-step estimate, so no SUSPEND
park, no `followChain` surfacing, no `chikory chain resume` exercised. The USD
gate parks only a node that does **not** finish in its first step, and step
count is non-deterministic (model-dependent) — for a small task the executor
routinely one-shots it. ESCALATE (quota/judge) and token-FAILED are equally
model/transport-dependent. There is therefore **no deterministic way to force a
child to park**, which is the precondition for proving WP-241 live.
→ **WP-243** (new): a deterministic **park-injection seam** — a dogfood/test-only
hook that suspends a child at a chosen point (e.g. a spec/env flag like
`parkAfterStep: 0` or a debug signal that forces `SUSPENDED`/`AWAITING_APPROVAL`
before sealing), so dogfood-044 can be re-run to assert the chain `--watch`
surfacing line **and** `chikory chain resume <chain-id>` → SUCCESS with the
parent worker attached. This is the WP-241 follow-up the spec named.

Secondary observation folded into F-44 (no separate WP yet): the pre-step-only
budget gate lets a one-step node overshoot its USD cap by a full step
($0.3425 vs $0.05, 6.85×). If hard-cap enforcement becomes a requirement it is
a distinct slice; today it is documented as a known limitation.

## Verdict on the thesis

🟡 **Partial.** The chain substrate (decomposition with correct per-node
budgets, family-diverse plan/judge, durable per-node runs, dependent handoff,
clean harvest reconciliation) all worked and the delivery is exactly correct —
but the WP-241 chain-visible approval/resume UX, the entire reason for this run,
**was not exercised** because the only available park trigger is
non-deterministic. WP-241 remains 🟡: substrate landed + unit-tested, live proof
still owed. The unblock is **WP-243** (deterministic park-injection seam); once
landed, re-run dogfood-044 unchanged to close F-42/WP-241 live.
