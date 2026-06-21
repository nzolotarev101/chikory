# Dogfood-044 — WP-241 chain-level child approval/resume proof (LIVE — park fired via the WP-243 seam)

> **Vibe check:** This campaign finally proved the thing it set out to prove. A
> chain node's child run **parked** mid-chain, the chain surfaced it, a single
> `chikory chain resume <chain-id> --add-budget 5` unblocked it, and the chain
> followed through to **SUCCESS 2/2** — the parent orchestration staying attached
> the whole time. The first attempt (chain-bc247058) couldn't park because the
> tiny node one-shotted its task before the budget gate ran; the fix was WP-243,
> a **deterministic park-injection seam** (`debug.parkBeforeStep`) that forces a
> real SUSPEND→top-up cycle on demand. With it landed, the re-run parked exactly
> where intended and the WP-241 surfacing + resume UX worked end-to-end. One
> false start along the way (chain-8c303011) surfaced a *new* friction: re-running
> a deterministic-port dogfood whose deliverables are already committed to HEAD
> clones a baseline that already contains them → empty diff → the run is FAILED by
> the non-empty-diff guard after a node already burned $0.27. That's the
> redundant-run precheck (WP-228) needing to cover `chikory chain`.

**WP**: WP-241 (chain-visible child approval/resume) · **closes WP-243** (park-injection seam) · **Date**: 2026-06-21 · **Spec**: [`examples/dogfood/dogfood-044.yaml`](../../examples/dogfood/dogfood-044.yaml) · **Headline chain**: `chain-1bfb9d13-6c3f-4f9d-bcb0-abba4d6730df` · **Outcome**: 🟢 **SUCCESS 2/2 — WP-241 park surfacing + chain-resume EXERCISED LIVE** · **Runtime under test**: `4dfcac1` (WP-243 seam) on top of `8918219` (WP-241 substrate), both landed before the run · **Harvested delivery**: 4 files, landed `4730e98`

> **Acronyms:** *WP* = work package (a plan.md unit of work). *AC* = acceptance
> criterion (the spec's executable `check`). *Park* = a child run halts and waits
> for a human signal (here a budget *SUSPEND* awaiting a top-up). *Seam* = a
> dogfood/test-only hook (`debug.parkBeforeStep`) that forces a deterministic
> park. *Handoff* = the WP-239 mechanism that carries a predecessor node's sealed
> repo snapshot into the next node's workspace.

## What this campaign proves (the F-42 → WP-241 → WP-243 arc)

| Stage | Chain | Result |
|---|---|---|
| 1st attempt | `chain-bc247058…` | 🟡 SUCCESS 2/2 **but no park** — node B one-shotted, pre-step budget gate never fired (F-44). Spec called this risk in advance → filed **WP-243** seam. |
| false start | `chain-8c303011…` | 🔴 FAILED — re-run cloned a HEAD that already held the deliverables (committed in `b0ca2b7`) → empty diff → non-empty-diff guard sealed node-a FAILED. **New F-45.** |
| **headline** | **`chain-1bfb9d13…`** | 🟢 **SUCCESS 2/2 with the WP-243 seam** — node B parked at step 0, surfaced, `chikory chain resume --add-budget 5` drove it to SUCCESS. **WP-241 proven live.** |

The human removed the prior harvest's fixtures (`af81580`) between the false
start and the headline run, giving the headline run a clean baseline.

## Headline run evidence (`chain-1bfb9d13…`)

Chain plan (`.chikory/chains/chain-1bfb9d13…/chain.db`, `plan` entry) — per-node
budgets propagated correctly from the goal:

| Node | budgetUsd | dependsOn | writeSet |
|---|---|---|---|
| node-a | **11.95** | — | `resume-fixture-a.ts` + test |
| node-b | **0.05** | node-a | `resume-fixture-b.ts` + test |

Per-node run journals (`journal.db`):

| Node | Status | Steps | Step cost | Judge cost | tok in/out (step) | Verdict | Wall |
|---|---|---|---|---|---|---|---|
| node-a | 🟢 SUCCESS | s0 only | $0.23916 | $0.003335 | 178,744 / 1,573 | PROCEED · AC-1 pass | ≈64.6 s |
| node-b | 🟢 SUCCESS | **park@s0 → resume → s0** | $0.3645325 | $0.0043025 | 277,618 / 1,751 | PROCEED · AC-2 pass | ≈114.6 s |

- **Chain total: $0.61133 / $12 budget (5.1%)**; judge share **$0.0076375 = 1.25%**
  (cap `max_cost_share` 0.5 = 50%, far under).
- **Input tokens: ≈456k** (node-a 178,744 + node-b 277,618) for two one-function
  modules — baseline data for WP-203 / WP-207 (low-mid band of the series).
- **Wall: ≈2 m 59 s** (13:14:51.242 → 13:17:50.488Z); node-b's window includes the
  park, the human resume, and the productive step.
- **Family diversity real:** executor = `openai` `gpt-5.5` (plan/code/review via
  `openai-compat`), judge = `gemini-3.1-pro-preview` (Google family via
  `openai-compat`). Judge ≠ executor. ✓

### The park that DID fire (the point of the campaign)

Node B's run journal carries the full SUSPEND→top-up cycle the first attempt
never reached. Two `budget_event` entries bracket the productive step:

| idx | kind | event | details | meaning |
|---|---|---|---|---|
| 0 | budget_event | **halt** | `cause:"debug"`, `injected:1`, `atStep:0`, `spentUsd:0`, `budgetUsd:0.05` | WP-243 seam forced a SUSPEND **before** step 0 |
| 1 | budget_event | **top_up** | `addedUsd:5`, `budgetUsd:5.05` | `chikory chain resume <chain-id> --add-budget 5` unblocked it |

After the top-up, node B ran its real step (idx 2, $0.3645, 277,618 in / 1,751
out), the judge passed AC-2 (idx 3), verdict PROCEED (idx 4), checkpoint (idx 5),
terminal SUCCESS (idx 6). The `+$5` top-up matches the spec's recovery command
exactly (`--add-budget 5`).

ℹ️ **What's "deterministic" vs "real" here.** Only the *trigger* is synthetic:
WP-243's `debug.parkBeforeStep` injects the halt (`cause:"debug"`) so a park
happens regardless of step count. Everything downstream — `childParkedState`,
`followChain`'s parked-child surfacing line, and `chikory chain resume
--add-budget` re-attaching a worker, signalling the child, and following the
chain to terminal — is the **real WP-241 path**, exercised unchanged. The chain
journal itself stays clean (`plan → node_started ×2 → node_sealed ×2 →
terminal`) because the park lives in the *child's* per-run journal; WP-241
surfaces it by reading `childParkedState`, since the chain workflow is blocked
inside `executeChild` with nothing new to journal at chain scope (by design).

## Delivery quality (human review, post-landing — landed `4730e98`)

Reviewed the landed diff line-by-line against the goal — clean.

- **`packages/sdk-ts/src/chain/resume-fixture-a.ts`** — `resumeFixtureA(): string`
  returns exactly `"resume-a"`. Named export, pure, no I/O. ✓
- **`packages/sdk-ts/src/chain/resume-fixture-b.ts`** — imports `resumeFixtureA`
  from `./resume-fixture-a.js` (ESM `.js` relative), exports
  `formatResumeReport(): string` returning `` `${resumeFixtureA()} + resume-b` ``
  = `"resume-a + resume-b"`. The dependent import is the real evidence node B
  built on node A's predecessor artifact (WP-239 handoff). ✓
- **Tests** — both focused, asserting the exact strings. ✓
- **Scope** — exactly the 4 files in the two write sets; nothing else touched.
  No default exports, no new deps. ✓
- **Harvest provenance** — all 4 landed files **byte-IDENTICAL** to the node-B
  workspace (which carries both A and B via the handoff). ✓

### Independent verification (re-run against the working tree, in devbox)

| Check | Result |
|---|---|
| `pnpm exec vitest run test/chain/resume-fixture-{a,b}.test.ts` | 🟢 2 passed, exit 0 |
| `pnpm exec tsc --noEmit` | 🟢 exit 0 |
| `pnpm exec eslint .` | 🟢 exit 0 |

AC-1 and AC-2 both fully green independently of the run's own judge verdict.

## Anomaly review

- **Wasted/filler steps (headline run):** none — one real step per node, both
  diff-producing; the park added no extra step, only a SUSPEND/top-up bracket.
- **Cost telemetry:** nonzero USD on every step + judge (no `.00`-with-tokens
  gap; models present in `pricing.ts`). The two `budget_event` rows correctly
  carry `cost_delta_usd 0.0` (control events, not LLM calls).
- **Judge behavior:** both verdicts PROCEED; judge-executed checks ran and
  exited 0 (`"judge-executed check … exited 0"` in both forms); no
  ESCALATE/ROLLBACK; family diversity real.
- **Loop integrity:** node B's single productive step executed exactly once
  *after* resume (no duplicate/re-run of step 0 across the park); checkpoint
  chain consistent (`…@5`); clean chain journal.
- **Human ceremony:** launched the chain with the seam env (`CHIKORY_PARK_BEFORE_STEP`
  / `CHIKORY_PARK_NODE_INDEX`), watched it park, ran one `chikory chain resume
  <chain-id> --add-budget 5 --watch` to unblock — **the exact WP-241 UX this
  campaign existed to test, now confirmed working.** Plus the unplanned
  fixture-removal commit between the false start and the headline run (F-45).

## New friction

**F-45 — re-running a deterministic-port dogfood whose deliverables are already
committed to HEAD wastes a full node on a guaranteed-empty diff.** Evidence: the
false-start chain `chain-8c303011…` cloned HEAD `0ecf094`, which already carried
`resume-fixture-a.ts` (committed in `b0ca2b7`, the first attempt's harvest). The
executor's "create the module" was a no-op against files that already existed; the
judge even passed AC-1 (`vitest exited 0`, because the files were present) and
returned **PROCEED**, but the node sealed **FAILED — "node node-a produced no
repository changes"** via the non-empty-diff structural guard (`ec13d71`). Cost of
the doomed node before it was caught: **$0.26733 step + $0.00402 judge ≈ $0.2714**,
plus the human's recovery commit `af81580` to remove the fixtures and re-run. This
is **dogfood-017 F-25 / WP-228 (launch baseline-satisfied precheck) recurring in
the chain path**: a pre-launch precheck that runs the spec's acceptance `check`s
against the clean baseline would have found them already-satisfied and warned/
refused *before* spawning a worker. Two angles:
  - **Primary → WP-228 must cover `chikory chain`.** Today WP-228's pure decision
    half (`evaluateBaselinePrecheck`) is landed but the launch-path wiring is not,
    and it was scoped for single `chikory run`. Wire it for `chikory chain` too so
    a re-run against an already-satisfied baseline is refused unless `--force`.
  - **Secondary (folded in, no new WP):** the judge returned PROCEED on an
    empty-diff node — it does not itself detect "no changes made"; the non-empty-
    diff guard is the only backstop. That backstop worked (the run did FAIL), so
    this is defense-in-depth functioning, not a regression — but it confirms the
    judge alone would green an empty-diff node.

## Verdict on the thesis

🟢 **Proven.** The WP-241 chain-visible approval/resume UX — the entire reason
this campaign existed — was **exercised live end-to-end**: a child parked, the
chain surfaced it, a single chain-level `chikory chain resume <chain-id>
--add-budget 5` unblocked it, and the chain ran to SUCCESS 2/2 with the parent
worker attached. WP-243's deterministic park-injection seam (`debug.parkBeforeStep`)
is what made this reproducible instead of luck-of-the-step-count. **WP-241 → 🟢
(live-proven); WP-243 → 🟢 (seam landed + used to prove WP-241); F-42 closed
live.** The chain substrate (decomposition with correct per-node budgets,
family-diverse plan/judge, durable per-node runs, dependent WP-239 handoff, clean
byte-IDENTICAL harvest) all held. One real new friction, **F-45 → WP-228 chain
coverage** (redundant-run precheck), and the standing pre-step-only budget-gate
overshoot note from F-44 remains a documented limitation.
