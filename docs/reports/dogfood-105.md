# dogfood-105 — WP-521 chain self-heal, force-fail seam armed (P3 rung-1)

- **WP:** WP-521 (chain heal-by-default) headline · WP-522 (read-only `chikory chain trace`) node deliverable
- **Date:** 2026-07-19
- **Spec:** `examples/dogfood/dogfood-105-wp521-chain-heal-rerun-armed.yaml`
- **Headline run-id:** `chain-da846d34-d528-41b0-9b13-d9c28c64f807` (launched `CHIKORY_SEED_CHAIN_FAIL_NODE=1`)
- **Landed fixes (local, unpushed):** `903be2f` `6347c86` `a2abd71` `8a0580f` `8274c1f`
- **Outcome:** 🟡 **rung-1 self-heal PROVEN (journal) · chain did NOT seal** — N-C snagged in an out-of-rubric approve loop (F-154); user chose stop-and-write-up.

## Plain lead

The chain's self-heal worked end-to-end for the first time: the middle node was
force-failed, the chain replanned, and the retry **recovered to SUCCESS** — both
halves of rung-1, read from the journal. Getting there took **six launches**, each
clearing a distinct harness wall (seam id, executor deps, plan-gate literal, git
lock). The final node (N-C) delivered correctly but couldn't *seal*: a good judge
catch (AC-3 verified the wrong file) collided with an approve loop that can't
force-seal an out-of-rubric concern. The self-heal thesis is banked regardless.

## Trace (headline run `chain-da846d34`)

| node | child-run outcome | chain-level | steps | cost | wall | note |
|---|---|---|---|---|---|---|
| N-A | SUCCESS | SUCCESS | 1 | $1.91 | 7m38s | `renderChainReadTrace` renderer + test |
| N-B | SUCCESS | **FAILED (seeded)** | 2 | $2.69 | 8m54s | seam `=1` force-failed dispatch idx 1 → replan |
| N-B-r1 | SUCCESS | SUCCESS | 3 | $1.93 | 17m04s | **recovery**; step 1 killed→resumed (`resumes=1`) |
| N-C | — | ⏸ AWAITING_APPROVAL | 2 | $2.39 | — | out-of-rubric approve loop (F-153/F-154) |

Chain journal: `node_replanned → plan-8ee50a97-…-r1` present (self-heal fired);
N-B-r1 sealed SUCCESS (recovery). Chain total ≈ **$8.92**.

## Thesis-KPI verdict — 🟢 rung-1 PROVEN (both halves)

| KPI half | status | evidence |
|---|---|---|
| halt-and-replan fires | 🟢 | `node_replanned` entry, failed node's evidence carried into replan |
| chain recovers to SUCCESS | 🟢 | **N-B-r1 sealed SUCCESS** (the retry incarnation) |
| earlier verdicts unchanged | 🟢 | N-A verdict not re-judged |

This is the first time the flat kill→resume / chain-recovery KPI (0 across 097–104)
has moved at chain scope. dogfood-104 delivered the surface but never fired the seam
(F-146); this run fired it and recovered.

## Delivery quality (human review, post-landing)

- **N-A** — `src/chain/read-trace.ts` `renderChainReadTrace` folds a sealed
  `ChainRecord` + journal into a bounded trace, reuses the recovery/design
  renderers. Focused test passes. ✅
- **N-B-r1** — `chikory chain trace <chain-id>` wired into `src/cli/chain.ts`
  (`cmdChainTrace`), relative ESM import of N-A's renderer, non-zero on unknown id.
  Landed on the **retry** incarnation as designed. ✅
- **N-C** — E2E test in `test/cli/chain-trace.test.ts`: imports both predecessors
  (`renderChainReadTrace` + `cmdChainTrace`), seals a synthetic chain with a
  `node_replanned` entry, asserts `recovery summary:` shows `attempts 2`.
  **Independently verified: 3 tests pass, scope = one test file, no production
  files touched.** Delivery is correct — the halt is a verification-plumbing
  artifact, not a code defect.

## New friction (global numbering continues from F-148)

> Commit messages used provisional labels F-147–F-150 that collide with the
> existing F-147/F-148 (dogfood-104). Authoritative numbers are below; SHAs are
> the reference.

- **F-148 CLOSED** (was "node A ~36m thrash before delivery", dogfood-104). Precise
  root cause: the executor workspace is a bare `git clone` with **no `node_modules`**,
  so any executor that self-verifies hits `vitest: not found` and thrashes to the
  `maxSeconds` cap. Fix `a2abd71`: `prepareRun` installs deps per clone
  (`pnpm install --frozen-lockfile --prefer-offline`, ~3s warm, guarded+idempotent).
- 🔴 **F-149** — chain force-fail seam keyed on the **planner-chosen** node id;
  `=B` never matched the planner's `N-B` (F-146 residue: seam armed but inert).
  Fix `903be2f`: planner-agnostic `isSeededFailNode` (numeric = 0-based dispatch
  index, else exact/trailing-segment). Launch with `=1` (middle of a 3-chain).
  → spawns no WP (fixed); note: WP-531 preflight guard should also validate the
  seam *value*, not just presence.
- 🟡 **F-150** — executor cold-nests `devbox run` in its verify loop (obeying
  AGENTS.md literally) → 50+ Nix cold-starts/node. Fix `6347c86`: "already inside
  devbox → invoke toolchain directly" carve-out in AGENTS.md + CLAUDE.md.
  **Inert in practice** — codex ignored the guidance (still ran `devbox run` 39×);
  the real relief came from F-148 (deps present) + F-152 (kills survivable).
- 🟡 **F-151** — WP-257 plan-gate literal-preservation floor mandates **prose**
  backtick literals (`recovery summary:`) verbatim in a node goal; a paraphrasing
  planner drops them nondeterministically → PROCEED force-downgraded to REVISE,
  chain halts at the gate despite a semantically-complete plan. Fix `8a0580f`:
  de-backtick the prose literal in the goal (AC-3 still enforces it at delivery);
  genuine code/command literals stay mandated. → WP candidate: floor should skip
  prose/punctuated literals, mandate only code-like identifiers.
- 🔴 **F-152** — a step killed at `maxSeconds` (SIGKILL) mid-git leaves
  `.git/index.lock`; the retry's `git add -N .` (diff capture) hard-throws
  ("File exists") out of the `executeStep` activity → Temporal retries forever,
  each ~20m attempt re-hitting the lock. Fix `8274c1f`: `clearStaleIndexLock`
  before every diff-capture `add -N .` (single-writer workspace → leftover lock
  is always stale).
- 🟡 **F-153** — AC-3's check command pins `test/chain/read-trace.test.ts`, but the
  loose goal let the executor add its E2E test to `test/cli/chain-trace.test.ts`,
  so the check exited 0 **without running the delivered test**. The family-diverse
  judge (gemini ≠ codex) caught it and escalated — a genuine true-positive
  (F-82/F-83 AC-file-pin class). → WP candidate: AC verify commands should run the
  test *directory*/suite, or the goal must pin the exact test path.
- 🔴 **F-154** — `chikory chain approve` on an **out-of-rubric** ESCALATE resumes
  `status=RUNNING` and re-judges instead of force-sealing (agent-loop.ts:968-988).
  When the delivery is already complete, the resumed step produces an empty diff →
  the judge re-escalates → **infinite approve loop**; the operator cannot seal a
  node whose rubric passed but which carries a persistent advisory concern. A code
  fix can't rescue an in-flight run (Temporal pins the workflow's code). → WP
  candidate: approve on an out-of-rubric ESCALATE (rubric passed) should offer a
  force-seal-SUCCESS, not only resume+re-judge.

## Judge behaviour

Family-diverse throughout (codex executor, gemini-3.1-pro judge via `openai-compat`
proxy). One genuine true-positive: the N-C AC-3 verification-gap catch (F-153) —
the judge refused to rubber-stamp a green rubric when the check hadn't exercised the
new test. Thesis-affirming Agent-as-a-Judge behaviour. No false positives; the seam
FAILED on N-B is a drill, not a catch.

## Verdict on the thesis

🟢 **rung-1 (chain self-heal) is proven.** A real `chikory chain` force-failed its
middle node and recovered to SUCCESS via the default evidence-enriched replan, read
from the journal. The chain not sealing is downstream of two harness frictions
(F-153 AC-file-pin, F-154 approve loop) on a bonus observability node whose delivery
is independently verified correct — not a failure of the self-heal path.

The six-launch saga is itself the finding: a headline chain run surfaced a full
stack of executor/harness reliability gaps (F-148/149/150/151/152/153/154) that
`run`-mode dogfoods never exercised. Five are fixed; F-153/F-154 are open WP
candidates.
