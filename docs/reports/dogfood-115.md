# dogfood-115 — WP-537 (design finding gates the seal) — FAILED: the executor delivered outside its sandbox, so nothing was ever graded

- **WP:** WP-537 (wire the design-fix retry loop into first-verdict seals — the F-180 fix)
- **Date:** 2026-07-27
- **Spec:** [`examples/dogfood/dogfood-115-wp537-design-finding-gates-the-seal.yaml`](../../examples/dogfood/dogfood-115-wp537-design-finding-gates-the-seal.yaml)
- **Run-id:** `run-c19147fe-13b6-4964-834d-9d55ccd99484`
- **Base HEAD at launch:** `ade2e85`
- **Outcome:** **FAILED** · 4 steps · $0.1576 / $30.00 · 7m 27s · executor `gemini-cli` (gemini) · judge `openai-compat` (`gpt-5.6-sol xhigh`)
- **Landed:** **nothing from the run.** WP-537 stays open. This sitting hand-landed the two 🔴 harness fixes below; the run's own delivery is parked in `git stash@{0}`, unjudged.

## Plain lead (vibe check)

The run failed, and the reason is worse than a bad delivery: **the coding agent
did the work in the wrong copy of the repo.** Every Chikory run gives the agent a
private clone to work in, and grades that clone. This agent instead edited the
developer's real checkout — the one the clone was made from — so its clone stayed
empty. The harness saw four steps that changed nothing, the judge graded an empty
tree, every acceptance check went red, and the run burned to a halt. Meanwhile a
complete, correct implementation was sitting in the developer's working directory,
untracked by the run, invisible to the trace, the checkpoints and the rollback.

The quality gate behaved **exactly right** — it refused to seal a run that had
delivered nothing into the graded tree, and its design rubric spelled out why. The
gate is not what broke.

Two harness defects came out of this and were both fixed by hand in this sitting:

- 🔴 **F-192** — nothing detected or prevented the escape. A step that writes
  outside its workspace was indistinguishable from a step that did nothing. Now
  the harness compares the source repo before and after each empty-diff step and
  fails the step loudly, naming the escaped paths.
- 🔴 **F-193** — the *review tool itself* was lying. `scripts/dogfood-verify.sh`
  collapsed multi-line acceptance checks onto one line before re-running them,
  which broke two of this run's four checks into syntax errors and reported
  **FAIL** for a delivery that actually passes. This review very nearly recorded
  the opposite conclusion.

Net: no product progress. The campaign's highest-value seam (WP-537) is unchanged
and re-runs as dogfood-116, now with the acceptance oracle proven in **both**
directions against a real reference implementation.

## Glossary (IDs used here)

- **WP-537** — the work package this run was chartered to deliver: make a design finding reach a consumer on a one-step run.
- **F-180** — the bug WP-537 fixes: on a one-step run a failing design-rubric item has no consumer, so the run seals SUCCESS carrying it.
- **F-n** — global sequential friction id. This report adds **F-192…F-195**.
- **AC-n** — acceptance criterion: a shell check the judge executes against the delivered tree.
- **workspace / source repo** — the per-run clone at `.chikory/runs/<run-id>/workspace` that gets graded, vs the developer checkout it was cloned from (its git `origin`).
- **first-verdict seal** — a run whose sealing judge pass is its first, i.e. its diff base is the run's base commit. Every one-step run is one.
- **oracle-owned AC** — an AC whose check states its own expected inputs and outputs, instead of running tests the executor wrote for itself.
- **P3-rung-4** — the P3 proof ladder's 4th rung: ≥5 brownfield tasks scored against a baseline.
- **VERIFY-SUITE** — the launch preflight's class for a check that shells out to `tsc`/`vitest`/`pnpm exec`; those are never dry-run, so they must be hand-verified.

## Trace excerpt (journal = ground truth)

```
run run-c19147fe-13b6-4964-834d-9d55ccd99484 · FAILED · 4 steps · $0.16 / $30.00 · 7m 27s
  executor gemini-cli(gemini) · judge openai-compat · ⚠ cost meter blind (unpriced tokens)
 #   step                              tokens(in/out)  cost    verdict
 1   ### Summary of Changes …           4.9k/1.3k      $0.00   ✓ PROCEED (1/4 criteria)
 2   ### High-Level Summary …           6.7k/616       $0.00   ✓ PROCEED (1/4 criteria)
 3   ### High-Level Summary …           7.3k/493       $0.00   ⛔ HALT
 4   ### Simplified Summary …           7.8k/551       $0.00   ⛔ HALT
totals: decisions 4 · judge passes 4 ($0.1576, 100.0%) · rollbacks 0 · escalations 0 · remediations 1
        checkpoints 4 · pacing events 4 · peak window 94% (compact 3) · issues found 21 · changes made 0
        endpoints plan/review/judge openai-compat · code gemini-cli(gemini)
EVERY step: diff e3b0c44298fc · 0 bytes · 0 tool calls
failed: judge HALT: criterion AC-1, AC-2, AC-3 failed 3+ consecutive verdicts
        → HALT (goal drift / budget-waste guard) (remediation exhausted after 1 attempt)
```

Judge pass #4 rubric, verbatim — the gate naming the real state of the tree:

```
✗ tests_pass — 3/4 judge-executed checks failed: AC-1, AC-2, AC-3
✗ design_serves_overall_goal — No implementation design is present in the empty diff, and the
  authoritative AC-1 and AC-2 checks demonstrate that the existing design still neither reacts
  to a first-verdict rubric failure nor wires rubric outcome into the decision.
✓ no_unrelated_deletions · no_secrets_introduced · no_architecture_violations · scope_matches_instruction
```

## What actually happened (the escape, proven)

The evidence is unambiguous and does not depend on reading the agent's prose:

| Fact | Evidence |
|---|---|
| The run's workspace was never modified | `git -C .chikory/runs/run-c19147fe-…/workspace status --porcelain` → empty; all 4 step diffs are the same 0-byte artifact `e3b0c44298fc` |
| The workspace was complete and usable | `packages/sdk-ts/src/workflow/{agent-loop,completion-review}.ts`, `node_modules/.pnpm`, and a built `dist/` all present, all mtime 14:53 (workspace prep), none touched after |
| The developer checkout WAS modified, mid-run | `agent-loop.ts` 14:54:26 · `completion-review.test.ts` 14:54:31 · `completion-review-live.test.ts` 14:54:54 · `completion-review.ts` 14:56:21 — all inside steps 1–2 (18:53:16–18:56:49 UTC = 14:53:16–14:56:49 local) |
| Those edits are the real deliverable | 206 insertions across the 4 files, matching the step summaries line for line (`isRubricClean`, the 7 rubric spellings, the 2×2×3 matrix tests) |
| The agent believed the real checkout was the repo | every path in every step summary is an absolute `file:///Users/nikitazolotarev/repos/chikory/...` URI — never the workspace path |
| The escape route was reachable from inside the sandbox | `git -C <workspace> remote -v` → `origin /Users/nikitazolotarev/repos/chikory`; the adapter runs `agy` under `--dangerously-skip-permissions` |

**Mechanism: not pinned.** A minimal reproduction (a source repo with a nested
clone at `.chikory/runs/probe/workspace`, `agy` invoked with the same flags) wrote
correctly *into the workspace*, both with and without an explicit
workspace-boundary instruction. So nesting alone does not reproduce it, and the
prompt boundary added below is a hardening measure, not a proven cure. Per the
anti-rabbit-hole rule the hunt stopped there: the durable defense is **detection**,
which is certain, cheap, and now in place.

Contrast with dogfood-114 (`run-fc10fe73`), same adapter, same layout, which wrote
a 19,482-byte diff into its workspace correctly — and whose transcript narrates
real tool calls on *relative* paths ("list the files in the workspace root
directory"). This run's transcript has no tool narration at all.

## Delivery quality (human review, post-landing)

The run landed nothing. The stray delivery in `stash@{0}` was reviewed anyway,
because it decides what dogfood-116 must do:

- 🟢 **It is correct.** All four ACs pass against it (AC-1's full 2×2×3 matrix
  included), and the whole sdk-ts suite is green with it applied.
- 🟡 **It is over-fitted to the AC's probe object.** `CompletionReviewState` gained
  **seven** optional spellings of "the rubric failed"
  (`hasRubricFailures`, `rubricClean`, `rubricFails`, `rubricResults`,
  `sealingRubricResults`, `sealingRubricFailures`,
  `sealingVerdictHadRubricFailures`), each with its own branch in `isRubricClean`.
  The real call site in `agent-loop.ts` passes exactly one of them. The other six
  are dead public API, added because AC-1's probe object sets all seven — see
  🟡 **F-194**.
- **It was never judged.** No judge pass ever saw it. Landing it by hand would be
  the precise failure this campaign exists to rebut, so it stays stashed and
  WP-537 re-runs as dogfood-116.

## New friction

### 🔴 F-192 — an executor that writes outside its workspace is indistinguishable from one that does nothing

**Evidence:** the table above. Four steps, $0.1576, 7m 27s, terminal FAILED, a
silently mutated developer checkout, and a complete delivery outside the audit
trail — all reported as four `SUCCESS` steps with empty diffs.

The harm is structural, not cosmetic. An empty step diff is the *only* signal the
harness has, and it is overloaded: "nothing to do" and "everything done elsewhere"
produce identical journals. Everything downstream inherits the ambiguity — the
judge grades an empty tree, checkpoints commit nothing, the step-3 rollback to
`@10` restored a tree that was already identical, and harvest finds nothing to
harvest. The operator's checkout is mutated with no record that a run did it.

**HAND-FIXED THIS SITTING.** Two layers:

1. **Detection (the real fix)** —
   `packages/sdk-ts/src/executors/workspace.ts:64-96` adds
   `sourceRepoDirtyPaths()`, which resolves the clone's local `origin` and returns
   its porcelain path set. `packages/sdk-ts/src/executors/step.ts:95-97,109-115`
   samples it **before** the step (so an already-dirty operator checkout is not a
   false positive) and again after, but **only when the step diff is 0 bytes** —
   zero added cost on any step that produced work. New paths ⇒ the step is
   `FAILED` + retriable, naming them:
   `executor wrote OUTSIDE its workspace: the step diff is empty but N path(s) changed in the source repo this workspace was cloned from — …`
   (`step.ts:177-199`). The detector disarms silently when `origin` is absent or
   non-local, so the conformance fixtures and every non-clone workspace are
   unaffected.
2. **Prompt boundary (hardening, unproven)** —
   `packages/sdk-ts/src/executors/prompt.ts:50-61` replaces the vague "Work only
   inside the current directory" with the workspace's absolute path plus an
   explicit "its `origin` is NOT yours to touch". The minimal probe above shows
   this is *not* what fixes the observed escape; it is cheap insurance.

**6 new tests**, `packages/sdk-ts/test/executors/workspace-escape.test.ts`, all
green — escape detected and named; work-in-workspace still SUCCESS; an
already-dirty source repo does **not** fire; a legitimately empty step does **not**
fire; and the detector returns `null` with no local origin. Full sdk-ts suite **988 passed /
23 skipped** on the landed state (982 on HEAD + these 6), tsc + eslint clean.
With `stash@{0}` applied on top it is 994/23 — that is how the stray delivery
was verified, and it is not what was landed.

**Not fixed, and queued: the escape is still *possible*.** Detection turns a
silent 7-minute burn into a loud one-step failure; it does not stop the write. The
structural fix is to stop nesting the graded clone inside the repo it was cloned
from — `runner/paths.ts:26-28` puts it at `<dataDir>/runs/<id>/workspace`, i.e.
inside the source checkout, while the benchmark harness already clones to
`os.tmpdir()` (F-184). → **WP-539 (queued)**.

### 🔴 F-193 — the review tool flattened multi-line acceptance checks and reported false FAILs

**Evidence:** `scripts/dogfood-verify.sh:67` emitted each check as a tab-separated
record via `(ac.check ?? "").replace(/\s+/g, " ")`. For this run that produced:

- **AC-1** — the `//` comment inside the `node -e` script swallowed the remaining
  ~20 lines → `SyntaxError: Unexpected end of input`, exit 1.
- **AC-3** — the `vitest` line and the following `node -e` line were glued into one
  argv → exit 1.

Both reported **FAIL** in the pack's §3. The judge's own runner preserves newlines
(journal `criterionResults` show the checks multi-line and exiting 1 for the
*correct* reason — an empty tree), so **only the review tool was wrong**. Verified:
re-running AC-1's stored bytes with newlines intact against the stray delivery
gives `AC-1 OK: design-finding matrix correct`, exit 0.

This is a first-class loop-integrity defect: the pack is the mechanical half of
every review, and it was capable of failing a good delivery — or, worse, of making
a reviewer distrust a correct judge.

**HAND-FIXED THIS SITTING.** `scripts/dogfood-verify.sh:67-73` now base64-encodes
the check body into the one-line record; `:160-161` decodes it back to the exact
bytes before `bash -c`. Proven both directions on this run's own checks: against
the stray delivery **AC-1/2/3/4 all PASS**; against the restored HEAD tree
**AC-1/2/3 FAIL** on their real assertions (`FAIL: a FIRST-VERDICT seal carrying a
failing rubric item must REVIEW — this is F-180`; `only 8 completion-review tests
pass`) and AC-4 passes.

### 🟡 F-194 — an oracle-owned AC that probes many input spellings teaches the executor to implement all of them

**Evidence:** AC-1 deliberately probed seven possible field names for "the sealing
rubric failed", so the design would not be pinned to one (a good instinct — the
goal left the design open). The executor read the probe as a specification and
implemented all seven as optional fields with seven branches, six of which no
caller uses.

This is the mirror image of F-187 (an oracle that probes *one* family ships
regressions): an oracle that probes *many* families ships dead surface. The AC
cannot both leave the design open and avoid dictating it — but it can stop
rewarding breadth. **track-B note**, owed to `docs/DOGFOODING.md` §3.4: an
oracle-owned AC should probe the design's *behavior* through **one** documented
input shape and let a rubric item, not the check, judge the API's tidiness.
Recorded, not fixed — dogfood-116 reuses AC-1 unchanged so its RED/GREEN proof
stays valid.

### 🟡 F-195 — pacing reported three compaction events with no folds recorded

**Evidence:** the trace totals carry
`pressure-steps 3 (unfolded 3)` plus the warning
`pressure fired for 3 step(s), but no pacing folds were recorded`, while the
watch log printed `⏱️ pacing compact — 81% / 86% / 94% window`. The governor
detected pressure and announced compaction three times; nothing was folded.

Almost certainly benign *here* — there was no work in the context to fold, because
every step diff was empty — so this may be an artifact of F-192 rather than an
independent defect. **track-B note**: re-check on dogfood-116, which will have real
diffs at 90%+ window occupancy. If it recurs with a non-empty context the pacing
governor (WP-310) is announcing an action it does not take.

### Recurrences (no new id)

- ℹ️ **F-167/F-9** — `$0.0000` metered across 26.7k executor tokens; `⚠ cost meter blind`. Structural on the keyless gemini-cli arm (`routing.stages.code.model: default`), as recorded in dogfood-114.
- ℹ️ **F-176** — `toolCalls: 0` on all 4 steps; `parseAgyOutput` recovers no tool count. Made this run harder to diagnose: 0 tool calls looked like a *possible* fabrication until the mtimes settled it.
- ℹ️ **F-190** — every step was a first-verdict seal; the run never got a second judge cadence. Unchanged.
- ℹ️ **F-168** — the progression gate's ⛔ message still hard-codes the retired P2/WP-265 ladder while the live ladder is WP-530/§7. Still open, track-B.

## Friction disposition

| F-n | Severity | Defect | Disposition |
|---|---|---|---|
| F-192 | 🔴 | an executor writing outside its workspace is indistinguishable from one doing nothing — 4 steps, $0.1576, terminal FAILED, operator checkout silently mutated | **HAND-FIXED THIS SITTING** — `workspace.ts:64-96` + `step.ts:95-97,109-115,177-199` detector, `prompt.ts:50-61` boundary; **6 tests**, suite 988/23 landed |
| F-193 | 🔴 | `dogfood-verify.sh` flattened multi-line checks → false FAIL on AC-1/AC-3 for a delivery that passes | **HAND-FIXED THIS SITTING** — `scripts/dogfood-verify.sh:67-73` base64 emit, `:160-161` decode; proven both directions on this run's own checks |
| F-194 | 🟡 | an oracle-owned AC probing 7 field spellings taught the executor to implement all 7; 6 are dead API | **track-B note** — `DOGFOODING.md` §3.4 guidance owed; AC-1 kept unchanged for dogfood-116 |
| F-195 | 🟡 | 3 pacing "compact" events, 0 folds recorded (`pressure-steps 3 (unfolded 3)`) | **track-B note** — likely an F-192 artifact (empty context); re-check on dogfood-116 |
| — | 🔴 | the escape remains *possible*: the graded clone lives inside the repo it clones | **→ WP-539 (queued)** — move the run workspace out of the source repo, as the bench harness already does (F-184) |

## KPI table (DOGFOODING §1.4)

| KPI | This run | Trailing window | Target |
|---|---|---|---|
| Max horizon survived | **UNMEASURED** (4 steps, 0 of them productive) | UNMEASURED on the CLI arm (F-190) | ≥10 steps |
| Wall-clock survived | 7m 27s | — | — |
| Kill → resume count | 0 | 0 over trailing 3 | ≥1 |
| Judge true-positives pre-land | **1** — refused to seal a run that delivered nothing into the graded tree; the `design_serves_overall_goal ✗` rationale named the actual state of the tree | 2 over trailing 3 | — |
| Trailing-3 meta:product headline ratio | 0 meta : 3 product (this run was `class=product`) | cap ≤1 meta / 3 — intact | ≤1:3 |
| Per-step reliability (runs ≥5 steps) | n/a (4 steps) | 93.8% (8 rollbacks / 128 steps) | 99%+ |
| Current-phase ladder rung | **0** (off-ladder: nothing delivered) | 3 | rung 5 = P3 exit gate |
| Cost | $0.1576 / $30.00 (0.5%) · judge share **100%** | — | — |
| Probe-step share (F-11 / WP-221) | 4 of 4 steps empty-diff — 0.0% of cost, 100% of steps | — | — |

## Verdict on the thesis

**The gate held; the sandbox did not.**

The Agent-as-a-Judge loop did precisely what the thesis claims it should. Given an
empty tree and an executor confidently reporting a completed 2×2×3 test matrix,
the judge executed the acceptance checks itself, found three of four red, refused
to seal, escalated to HALT after three consecutive stuck verdicts, and its design
rubric wrote down the true state: *"No implementation design is present in the
empty diff."* An executor-authored summary of ~600 words claiming green
TypeScript, green ESLint, 10 unit tests and 4 live tests bought it nothing. That
is the whole argument for judging artifacts instead of grading text, and this run
is a clean demonstration of it.

What the run exposes is one layer down: **the judge can only grade what the
harness hands it.** Chikory's durability guarantees — checkpoints, rollback,
resume, the audit trail — all assume the workspace is where the work is. When that
assumption broke, every mechanism above it kept operating correctly on the wrong
data. Cheap to detect, and now detected; but the honest reading is that per-step
reliability at 93.8% is measured against a substrate that had an undetected way to
lose an entire delivery.

Cost of the lesson: **$0.1576 and 7 minutes**, against a $30 budget. The budget
gate was never the binding constraint — the judge's goal-drift guard was, and it
fired at the right time.

## Status

- **WP-537: NOT DELIVERED.** Re-runs as dogfood-116 with the escape detector live.
- **WP-539 (NEW, queued):** move the run workspace out of the source repo.
- Landed this sitting: F-192 + F-193 hand-fixes (see the status block in `plan.md`
  for the commit).
- `stash@{0}` holds the unjudged WP-537 delivery. It is the **reference
  implementation** that proves dogfood-116's AC-1 GREEN; do not land it.
