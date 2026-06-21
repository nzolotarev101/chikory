# Dogfood-043 — WP-239 first artifact-backed fan-in proof

> 🟢 **Multi-predecessor fan-in works.** Two independent predecessor nodes
> (A = left, B = right) each built from the same committed baseline; the
> dependent consumer node C received **both** sealed predecessor trees through
> the WP-239 artifact-backed handoff — not a shared workspace — and compiled an
> import that could only typecheck if both parents were materialized. The
> durable chain sealed **SUCCESS 3/3** on the first attempt. Node C's judge ran
> the full AC-3 gate (report test + the canonical `fan-in-handoff.test.ts` +
> `tsc` + `eslint`) inside the inner loop and it exited 0.

**WP**: WP-239 (ADR-007, fan-in slice WP-242) · **Date**: 2026-06-21 · **Spec**: [`examples/dogfood/dogfood-043.yaml`](../../examples/dogfood/dogfood-043.yaml) · **Plan**: `plan-592e0a24-6c35-47bb-9210-b7642cdfe832` · **Chain**: `chain-6f1bf0ee-ce7a-42be-9416-4843b366cf0d` · **Outcome**: **SUCCESS 3/3** · **Runtime under test**: `919feb9` (WP-239 substrate + contracts, landed before the run) · **Harvested delivery**: staged uncommitted on the working tree (6 files)

## Run evidence

| Metric | Node A (left) | Node B (right) | Node C (report) | Chain total |
|---|---:|---:|---:|---:|
| Run ID | `…-node-node-a` | `…-node-node-b` | `…-node-node-c` | `chain-6f1bf0ee-…` |
| `dependsOn` | — | — | node-a, node-b | — |
| State | SUCCESS / PROCEED | SUCCESS / PROCEED | SUCCESS / PROCEED | **SUCCESS 3/3** |
| Steps | 1 | 1 | 1 | 3 |
| Cost | $0.27 / $6.00 | $0.25 / $6.00 | $0.26 / $8.00 | **≈ $0.78 / $20 (3.9%)** |
| Tokens (in/out) | 203k / 1.4k | 184k / 1.5k | 190k / 1.6k | **≈ 577k / 4.5k** |
| Judge cost | $0.00 (keyless) | $0.00 (keyless) | $0.00 (keyless) | **$0.00 metered** |
| Duration | 1m 4s | 1m 0s | 1m 23s | **≈ 3m 28s wall** (nodes sequential) |
| Final checkpoint | `…-node-a@3` | `…-node-b@?` | `…-node-c@3` · `70a97f5b97bc` | chain journal sealed SUCCESS |

- **Executor**: `codex` (OpenAI family). **Step judge**: `gemini-3.1-pro-preview`
  via the keyless `cli-judge-proxy` (backend `agy`). Executor ≠ judge family ✅.
- **Plan phase**: planner `gpt-5.5` (1261/377 tok, 9,684 ms); plan meta-judge
  `gemini-3.1-pro-preview` (1043/137 tok, 7,335 ms) → **PROCEED** on the exact
  required topology (A, B empty `dependsOn`; C depends on both).
- Per-node judge LLM calls: node-a `gemini` 6,521 ms (1217/267), node-b `gemini`
  6,367 ms (1242/190), node-c `gemini` 6,944 ms (1553/245).
- Judge cost is metered at $0.00 because the judge runs through the keyless CLI
  shim (no per-token billing surfaces); host-side planner/plan-judge calls are
  not folded into the chain journal cost (same as dogfood-042).

### Handoff proof (the point of the campaign)

The decisive evidence is the per-node workspace contents — what each node's
sealed tree physically contained:

| Node | Workspace fan-in files | Reading |
|---|---|---|
| A | `fan-in-left.ts` + `fan-in-left.test.ts` | left only — independent predecessor ✅ |
| B | `fan-in-right.ts` + `fan-in-right.test.ts` | right only — **did NOT inherit A's left tree** ✅ |
| C | `fan-in-left.ts` + `fan-in-right.ts` + `fan-in-report.ts` (+ all 3 tests) | **both predecessor artifacts materialized** ✅ |

- Node B's tree proves the two predecessors started from the **same committed
  baseline**, not serialized A→B (the dogfood-042 single-predecessor model
  would have leaked A's left module into B).
- Node C's tree proves WP-239 deterministically materialized **both**
  `dependsOn` parents before C ran. C imports `leftFanInFixture` from
  `./fan-in-left.js` and `rightFanInFixture` from `./fan-in-right.js`; it could
  not have typechecked otherwise.
- The canonical runtime integration test `fan-in-handoff.test.ts` (committed in
  `919feb9`) was run by node C's judge and re-run post-harvest — it passes both
  cases: *materializes both parents after their workspaces are removed* (3.3 s,
  artifact-backed, not workspace-backed) and *fails closed on an unresolved Git
  conflict* (ADR-007 conflict semantics).

## Delivery quality (human review, post-harvest)

`devbox run harvest` ran chain-aware: it resolved all three node deltas, applied
them once each in topological order (A, B, then C), reconciled the host tree,
and staged exactly **6 new files / 0 modified / 0 deleted** with **0 warnings**.
Post-harvest gate: build, lint, typecheck (0 errors), **397 TS tests passed / 19
skipped**, **82 Python tests passed**, chain-harvest integration **PASS**.

The six staged files match the goal line-by-line:

- `fan-in-left.ts` → named pure `leftFanInFixture()` returns exactly
  `left-artifact`. `fan-in-right.ts` → named pure `rightFanInFixture()` returns
  exactly `right-artifact`.
- `fan-in-report.ts` → ESM `.js` imports of both predecessors, named pure
  `formatFanInReport()` returns exactly `left-artifact + right-artifact`.
- Each module has a focused passing test. Strict TS, named exports only, no
  default exports, no I/O, no new dependencies, no out-of-scope edits.

Independent re-run of the acceptance checks against the harvested tree:

| AC | Check | Result |
|---|---|---|
| AC-1 | `vitest run test/chain/fan-in-left.test.ts` | 🟢 PASS (1 test) |
| AC-2 | `vitest run test/chain/fan-in-right.test.ts` | 🟢 PASS (1 test) |
| AC-3 | `vitest run fan-in-report + fan-in-handoff` · `tsc --noEmit` · `eslint .` | 🟢 PASS (report 1 + handoff 2 tests; tsc clean; eslint clean) |

Node C's judge form recorded `AC-3 — judge-executed check … exited 0`, rubric
`tests_pass` / `no_unrelated_deletions` / `no_secrets_introduced` /
`scope_matches_instruction` all ✓, evidence `186a021d1525 · test_results · 2192
bytes · 1 acceptance checks: 1 passed`. The judge genuinely executed the gate in
the inner loop — this is real Agent-as-a-Judge, not text grading.

## Anomaly review

- **Wasted/filler steps**: none. Each node = 1 productive step, `changes made 1`,
  no empty-diff probe step. The F-11-closed `s0 j@0` shape held for all three
  nodes (continuing the long clean streak).
- **Cost telemetry**: $0.78 total across 3 nodes, 3.9% of the $20 chain budget.
  No `$0.00`-with-tokens executor anomaly. Judge cost $0.00 is the keyless CLI
  shim by design (known; not the F-9 pricing gap).
- **Token economics**: ~190k input tokens per single-file-pair node — the Codex
  executor loads heavy repo context for trivial work. Consistent with prior runs
  (200k–790k); baseline data for WP-203/WP-207, no new WP.
- **Judge behavior**: checks executed (exit 0 logged), rubric justifications
  sane, family diversity real (executor OpenAI/codex vs judge Gemini via shim).
  No ROLLBACK/ESCALATE — correct, the work was clean.
- **WP-242 writeSet enforcement**: the three nodes have disjoint write sets
  (left / right / report), so the overlap-serialization path was not triggered;
  the fan-in topology is exactly what that guard protects, but this run did not
  stress a conflicting-writer case.
- **Loop integrity**: no duplicate journal entries, no re-executed steps,
  checkpoint/lastGood consistent per node, halt-on-FAILED never engaged (no
  failures).

## New friction

**No new numbered friction.** This was a clean first-attempt validation of an
already-landed substrate — the intended outcome.

One **recurring** gap was leaned on, already tracked: **F-41 → WP-232**
(`dogfood-verify.sh` has no chain mode). For a fan-in chain the single-run
verifier is even less usable — proving the result required manually tracing all
three node runs, inspecting each node's workspace to confirm independent
baselines + dual materialization, and running `devbox run harvest` by hand
before the acceptance checks could run against the host tree. This reinforces
WP-232's priority but spawns no new WP.

## Verdict on the thesis

🟢 **The hardest chain primitive so far is proven.** dogfood-042 proved linear
single-predecessor handoff (B sees A). dogfood-043 proves **true fan-in**: two
*independent* predecessors converging into one consumer through artifact-backed
transport, with the predecessors provably isolated from each other and both
deterministically materialized into the consumer. The judge gated the canonical
conflict/ordering runtime test inside the loop, and chain-aware harvest
reconstructed the non-linear delivery. WP-239 (and its WP-242 write-boundary
slice) is dogfood-proven. The remaining critical-path gap is now **WP-241 /
F-42** — chain-visible child approval/resume UX — the last orchestration seam
before general long-running multi-node chains.
