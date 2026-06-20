# Dogfood-042 — WP-237 first green dependent 2-node chain

> 🟢 **The handoff worked.** Node B started from node A's sealed git tree,
> imported node A's new `formatUsd`, delivered its own diff, and the durable
> chain sealed SUCCESS 2/2. Attempt 1 exposed and fixed planner check rewriting
> (F-40). Attempt 2 survived a real Codex quota pause through durable
> ESCALATE→approve→resume, then harvested both node deltas with the new
> chain-aware `devbox run harvest` path.

**WP**: WP-237 (ADR-005 S4) · **Date**: 2026-06-20 · **Spec**: [`examples/dogfood/dogfood-042.yaml`](../../examples/dogfood/dogfood-042.yaml) · **Plan**: `plan-ed1df723-7786-453a-939a-8107b237052f` · **Chain**: `chain-1cde6ae3-d05f-438e-b818-8af76419d6ae` · **Outcome**: **SUCCESS 2/2** · **Implementation commits**: `0113e3e`, `8bfd67c` · **Harvested delivery**: `b1b825d`

## Run evidence

| Metric | Node A | Node B | Chain total |
|---|---:|---:|---:|
| Run ID | `…-node-node-a` | `…-node-node-b` | `chain-1cde6ae3-d05f-438e-b818-8af76419d6ae` |
| State | SUCCESS / PROCEED | SUCCESS / PROCEED | **SUCCESS 2/2** |
| Steps | 1 | 4 (3 quota failures + 1 productive) | 5 |
| Exact cost | $0.6988025 / $7 | $0.6741125 / $8 | **$1.372915 / $15 (9.2%)** |
| Exact tokens | 531,202 in / 3,480 out | 511,458 in / 3,479 out | **1,042,660 in / 6,959 out** |
| Judge cost | $0.00334875 | $0.0073525 | **$0.01070125 (0.8%)** |
| Duration | 115.020 s | 2,612.109 s | about **45m 28s**, dominated by the quota wait |
| Final checkpoint | `…-node-a@3` / `cecc5aed505d` | `…-node-b@12` / `1d2ba5c4c008` | chain journal sealed SUCCESS |

Planning used `gpt-5.5` (983 input / 240 output tokens, 6,929 ms) and the
different-family plan judge used `gemini-3.1-pro-preview` (758 / 82 tokens,
5,285 ms); the plan judge returned PROCEED on exactly two nodes, `node-b`
depending on `node-a`. Those host-side calls are not included in the child-run
cost total above because the current chain journal does not meter them.

### Handoff proof

- Node A checkpointed commit `cecc5aed505df385bddc794b01f75d16aeb77bdf`.
- Node B's `chikory-base^{commit}` is the exact same SHA,
  `cecc5aed505df385bddc794b01f75d16aeb77bdf`.
- Node B physically contained `packages/sdk-ts/src/chain/cost.ts` before its
  productive step, and its task journal carried
  `chainLink.parentRunId = chain-1cde6ae3-d05f-438e-b818-8af76419d6ae-node-node-a`.
- Node B's own `chikory-base..HEAD` diff contained only
  `src/chain/cost-report.ts` and `test/chain/cost-report.test.ts`; inherited
  node-A files did not contaminate its judge evidence.
- Durable artifacts exist: 16,384-byte chain DB, 24,576-byte node-A journal,
  and 40,960-byte node-B journal.

## Delivery quality (human review, post-harvest)

The harvested commit `b1b825d2e15a260f4665587dc58608e175b4f420`
contains exactly four new files and 37 lines:

- `cost.ts` exports named pure `formatUsd`, using `toFixed(2)` and returning the
  required `$1.07` shape. Four focused cases cover zero, integers, padding, and
  rounding.
- `cost-report.ts` imports `formatUsd` from `./cost.js` and exports named pure
  `formatCostShare`; the required `(0.7%)` example and 25%/100% cases pass.
- No contract/schema changes, dependency additions, default exports, or
  unrelated edits.

`devbox run harvest` auto-resolved the newest node artifact back to its chain,
applied node A then node B, reconciled **4 new / 0 modified / 0 deleted / 0
warnings**, and staged every file. Its post-harvest gate passed: build, lint,
typecheck (0 errors/warnings), **383 TS tests passed / 19 skipped**, **80 Python
tests passed**, and the chain-harvest integration test passed.

The per-node mechanical packs independently re-ran AC-1 (4 tests) and AC-2 (3
tests + TypeScript + ESLint), both exit 0. Node A's landed-scope checker reports
node B's two files as `EXTRA_IN_COMMIT`, which is expected for one cumulative
chain harvest commit. Node B's checker cannot resolve its internal predecessor
base SHA in the host repository; that is F-41 below, not a content mismatch.

## Attempts and anomaly review

### Attempt 1 — F-40 caught before handoff

Chain `chain-3cd1d09b-9bcd-47fe-af99-19b01101ab0e` failed 0/2 because the
planner copied AC-1's id but rewrote its valid pnpm/package-directory check to
invalid root-level `npm run test packages/sdk-ts/test/chain/cost.test.ts`.
Node A's correct 966-byte diff and focused test were green, but the judge
correctly observed its assigned check exit 1 three times and HALTed. WP-240
landed in `8bfd67c`: `buildPlan` now restores matching goal criteria verbatim,
and the prompt renders/forbids translating checks.

### Attempt 2 — durable quota recovery

Node A succeeded in one productive step. Node B then hit the external Codex
usage cap three times (`0` tokens, `0` tool calls, `$0.00`; transcript: try again
at 5:32 PM). The runner checkpointed every failure and emitted a runner-sourced
ESCALATE after the third. After the reset, the same child received approval and
resumed at step 4; it produced an 1,101-byte diff, passed its real check, and
sealed SUCCESS. The parent `chainLoop` then folded node B and sealed the original
chain SUCCESS. No work was discarded and no duplicate chain was launched.

## New friction

### 🔴 F-39 → WP-239 — local `dependsOn[0]` is not true long-horizon fan-in

WP-237 intentionally transfers only the first predecessor's local git tree.
Additional dependencies gate scheduling but their trees, structured fixtures,
artifact refs, and compacted notes are not merged. WP-239 is the top Phase 2
architecture priority: artifact-backed/distributed handoff, deterministic
fan-in conflicts, provenance, WP-202 refs, WP-203 notes, and non-linear harvest.

### 🟢 F-40 → WP-240 — planner mutated executable acceptance checks

Fixed in `8bfd67c` and proven by attempt 2. Matching criterion ids now preserve
the source goal criterion description and check verbatim; regression coverage
uses the exact pnpm→npm failure shape.

### 🟡 F-41 → WP-232 — single-run verifier misreads cumulative chain landing scope

`dogfood-verify.sh` has no chain mode. Against node A it calls node B's files
`EXTRA_IN_COMMIT`; against node B it errors because node B's `chikory-base` is
the predecessor's private checkpoint SHA, not a commit in host `main`. The
checks and byte reconciliation are green, but chain landed-scope evidence needs
to understand ordered child deltas. Fold this into queued WP-232 rather than
creating a second verification WP.

### 🔴 F-42 → WP-241 — child ESCALATE is silent at the chain watch surface

While node B awaited approval, `chikory chain --watch` printed no child status,
reason, or approval command; it appeared hung until the child journal was
inspected manually. Recovery required detaching, approving the child run id,
restarting the proxy, and resuming that child directly. WP-241 must project a
child's `AWAITING_APPROVAL`/failure reason into the ChainJournal and chain watch,
and provide chain-level approve/resume UX that keeps the parent worker attached.

## Verdict on the thesis

🟢 This is the first green dependent chain and the first direct compounding-error
coverage: node B compiled and tested an import that could exist only if node A's
sealed code was handed forward. Per-node judges remained isolated to each
node's own diff, both real checks passed, the chain survived a long external
pause without losing state, and chain-aware harvest reconstructed the cumulative
delivery. WP-237's local linear S4 slice is proven; WP-239 and WP-241 are now the
critical work needed to turn that proof into general long-running orchestration.
