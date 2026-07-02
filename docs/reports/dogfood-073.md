# dogfood-073 — WP-233(b) part 1 LANDED (plan-gate failure NOTICE RENDERER + the `planAndGateChain` consumer WIRE, the F-33 operator-facing fix) — clean first-pass; and the review post-mortem RE-FRAMED dogfood-072's retry tax: the judge-check runner's 120 s timeout does NOT reap the check's process tree (F-78 → WP-264)

- **WP:** WP-233(b) part 1 — the pure `renderPlanGateFailureNotice(cls: PlanGateFailureClass): string` renderer (`src/chain/plan-gate-notice.ts`) + the one-site consumer wire in `planAndGateChain` (`src/cli/chain.ts`), so a non-PROCEED plan-gate verdict now renders **"plan gate could not reach the meta-judge — INFRA fault, SAFE to re-run: …"** vs **"plan gate REJECTED the plan — NOT safe to re-run as-is: …"** instead of the raw conflated rationale. Kills the F-65-shaped orphan risk on the dogfood-072 classifier (it now has a real runtime consumer). Authored AND launched correctly as a **single `chikory run`** — 2nd consecutive correct launch (the 067–071 divergence streak stays broken).
- **Date:** 2026-07-01
- **Spec:** `examples/dogfood/dogfood-073.yaml` (`dogfood-073-wp233b-plan-gate-notice-wire`)
- **Run-id (single run):** `run-a5f8c5fe-26f8-4d33-b94b-b676039d6a8c`. Runtime HEAD `008d3fd`.
- **Landed commit:** none yet — **4 files STAGED, uncommitted** on the working tree (`packages/sdk-ts/src/chain/plan-gate-notice.ts` NEW +15, `packages/sdk-ts/src/cli/chain.ts` EDIT +5/−1, `packages/sdk-ts/src/index.ts` EDIT +1, `packages/sdk-ts/test/chain/plan-gate-notice.test.ts` NEW +61), byte-**IDENTICAL** to the run workspace (pack §5 all four `IDENTICAL`). Left for operator review per dogfood-review §4.

## Trace (single run, 1 step)

```
run run-a5f8c5fe-… · SUCCESS · 1 step · $0.75 / $5.00 · 3m 36s · executor codex(openai) · judge gemini-3.1-pro-preview(openai-compat)

 #   step deliverable                                tokens(in/out)  step$     judge$    verdict         dur / tools
 1   FULL delivery (renderer + barrel + wire + test) 548k/5.3k       $0.7384   $0.0098   ✓ PROCEED 2/2   2m54s / 22 tools

totals: 1 decision · 1 judge pass · $0.7482 total (exact sum) · judge $0.0098 (1.3%) · 0 rollbacks · 0 escalations
        budget 15.0% of $5.00 · checkpoint …@4 (fffe197f6faa) lastGood true
        no empty-diff/probe step (F-11 clean) · no wall-clock kill (2m54s ≪ 600s — F-76 did NOT recur)
        harvest 4/4 files IDENTICAL to working tree
```

## Delivery quality (human review, post-landing)

🟢 **Spec-faithful first-pass, exactly the four named files, every mandated symbol / substring / behavior present.** Reviewed the diff line-by-line against the goal:

| Mandated | Delivered | ✓ |
|---|---|---|
| `import type { PlanGateFailureClass } from "./plan-gate-failure.js";` (type-only) | exact (`plan-gate-notice.ts:1`) | 🟢 |
| infra branch STARTS WITH `"plan gate could not reach the meta-judge — INFRA fault, SAFE to re-run: "` + `cls.reason` | exact template literal (`:11`) | 🟢 |
| substantive branch STARTS WITH `"plan gate REJECTED the plan — NOT safe to re-run as-is: "` + `cls.reason` | exact (`:14`) | 🟢 |
| branch ONLY on `cls.kind` (no rationale re-sniffing), pure, no mutation | confirmed — single `if (cls.kind === "infra")`, reads only | 🟢 |
| JSDoc citing WP-233(b), F-33, consumes WP-233(a) classifier | present (`:3-8`) | 🟢 |
| barrel: ONE re-export line next to the `plan-gate-failure.js` export | `index.ts:74`, adjacent, nothing reordered | 🟢 |
| `chain.ts` wire: `classifyPlanGateFailure(gated.verdict)` → renderer, raw-rationale fallback on null, at the gate-failure return ONLY | exact 3-line replace (`chain.ts:132-135`); `phase:"plan"` branches, `FamilyDiversityError` branch, PROCEED path untouched | 🟢 |
| test composes classifier→renderer on REAL `PlanVerdict` literals (no hand-built `PlanGateFailureClass` stubs) | all 3 `it` cases build `PlanVerdict` → `classifyPlanGateFailure` → renderer | 🟢 |
| F-33 transport ESCALATE → `SAFE to re-run` + reason preserved; substantive REVISE → `NOT safe to re-run` + reason; polarity (infra ∌ `REJECTED`, substantive ∌ `could not reach the meta-judge`); no-mutation snapshot | all present (`test/chain/plan-gate-notice.test.ts:8-60`) | 🟢 |

- **Scope discipline:** exactly the 4 named files (pack §4). No `types.ts`, `meta-judge-harness.ts`, `plan-gate-failure.ts`, contract, or dependency change. ✓
- **AC re-run against working tree:** AC-1 PASS (12 grep-pins + scoped vitest **3 passed**), AC-2 PASS (tsc + eslint + full suite **574 passed | 19 skipped**). ✓
- **Harvest:** all 4 files byte-IDENTICAL to the run workspace (pack §5). ✓
- **No F-64 paraphrase risk** — single `chikory run`, full goal verbatim to the executor; the two exact operator substrings and the fallback semantics all survived. Second consecutive proof that correct launch mode = zero mandate-dropping.

## New friction

Friction numbering is global + sequential; the highest prior is F-77 (dogfood-072), so this report opens at **F-78**. F-78/F-79 are retroactive findings about dogfood-072's economics, surfaced by this review's post-mortem of the step-1 AC-2 artifact.

### 🔴 F-78 → WP-264 (new) — the judge-check 120 s timeout does NOT reap the check's process tree: dogfood-072's post-kill AC-2 check ran 695.9 s = **5.8× the cap**, and the hang read as a substantive AC failure

- **Evidence.** dogfood-072 (`run-1ac16aa8-…`) step-1 judge pass, AC-2 `test_results` artifact (`067bf41eecb0…`): the check `cd packages/sdk-ts && pnpm exec tsc --noEmit && pnpm exec eslint . && pnpm exec vitest run` logged `[exit 1, 695853ms]` with the tail `Error: Failed to terminate worker` (vitest tinypool) followed by `[check timed out after 120000ms]`. The `DEFAULT_CHECK_TIMEOUT_MS = 120_000` cap fired on time, but the check's wall clock was **695.9 s — 5.8× the cap** — because `runCheck` (`packages/sdk-ts/src/judge/evidence.ts:76-87`) uses `execFileAsync("/bin/sh", ["-c", check], { timeout })`, and Node's `timeout` kills **only the direct `/bin/sh` child**. Vitest's tinypool worker grandchildren kept the stdout/stderr pipes open, so the promise didn't settle until they died naturally. This is byte-for-byte the pre-WP-255(a) defect (`dogfood-064: step killed at 2.45× cap`) recurring on the **judge-check path** — WP-255 fixed `runBounded` (`src/executors/process.ts`: `spawn(detached:true)` + `process.kill(-pid)` group-kill) but `runCheck` never adopted it.
- **Two costs.** (1) Judge-pass wall time is unbounded in practice — a hung check holds the whole gate hostage for however long the orphan grandchildren live. (2) Worse, **an infra-hung check is indistinguishable from a genuine red AC**: dogfood-072's AC-2 "failure" was a kill artifact, not a code defect, yet it blocked the SUCCESS seal (see F-79) and — under the 3-consecutive-fails HALT rule — a recurring hang could seal a FAILED run on green code.
- **Spawns WP-264:** port the WP-255(a) tree-reap to `runCheck` — replace the `execFileAsync` call with `runBounded("/bin/sh", ["-c", check], { cwd, env: scrubExecutorEnv(…), maxSeconds: timeoutMs/1000 })`, preserving the `CheckRun` shape, the exact `[check timed out after ${timeoutMs}ms]` marker, and the `bound(output, 64 KiB)` truncation. Directly hardens every judge pass; sibling of WP-255(a). **Chosen next dogfood headline (dogfood-074).**

### 🟡 F-79 → re-scopes WP-263 (no new WP) — the "seal via judge-only pass" short-circuit WP-263 asks for ALREADY structurally exists; dogfood-072's retry tax was F-78 blocking it

- **Evidence.** `agent-loop.ts:470-478`: after ANY step (including a FAILED/killed one, at cadence 1), a judge verdict of `PROCEED` with `allCriteriaPass(verdict)` seals `SUCCESS` immediately — no further executor turn. In dogfood-072, the post-kill judge pass DID run and DID re-execute both ACs against the already-complete workspace: AC-1 ✓ (exit 0, 1.8 s), AC-2 ✗ — but AC-2's red was the F-78 hang artifact, not the code. Had AC-2 settled honestly (this run's identical AC-2 passed in ~21 s; dogfood-073's own post-step AC-2 pass took ~41 s judge-pass total), the loop would have sealed WITHOUT step 2's $0.4072/298k re-ingestion.
- **Consequence.** WP-263's originally-queued fix ("re-run the killed step's ACs before re-spending an executor turn") is largely **already the loop's behavior via the cadence judge pass**. WP-263 narrows to the residual: (a) **depends on WP-264** — the post-kill check must be reliable before the seal path can be trusted; (b) optionally, mark a check that hit the timeout as **infra-failed** (the `killed` flag is already in hand at `evidence.ts:86`) so the verdict/3-strike logic can distinguish "check infrastructure died" from "code is red" — the check-level analog of the WP-233 infra/substantive classification this very run landed for the plan gate. plan.md WP-263 row updated accordingly; WP-264 goes first.

### 🟡 F-80 (no WP) — executor ignored the goal's toolchain mandate (bare `pnpm exec`, NOT `devbox run`) and burned a failed first command on the missing `node_modules`

- **Evidence.** The goal (and F-24 lineage) mandated bare `pnpm exec` for verification. The step transcript's own summary table shows every verification ran as `devbox run -- bash -lc 'cd packages/sdk-ts && pnpm exec …'`, and the first attempt failed with `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "tsc" not found` (fresh clone, no `node_modules`) before the executor self-recovered with `pnpm install --frozen-lockfile`.
- **Why no WP.** Harmless here — commands ran sequentially (no F-22 race), the step finished in 2m54s, everything green. But it's a clean data point that **prose toolchain discipline in the goal is soft** (the executor obeys the what, improvises the how); the install-on-fresh-clone cost is already documented (DOGFOODING §3.4). Worth watching: if a future run pays real time to `devbox run` env-init loops, that becomes a spec-templating fix, not prose.

### 🟡 F-58 / WP-249 reinforced — delivery STAGED, no `Run-ID:` trailer, not harvested via `chikory land --verify`

- Same standing pattern as 070–072: pack §6 `no landed commit found`. WP-249's track-B harvest-adoption remainder already owns this; no new WP.

### ℹ️ Token-economics baseline (WP-203/WP-207 data, no friction)

- 548k input / 5.3k output for an 82-line, fully-prescribed additive diff (22 tool calls, 2m54s) — vs dogfood-072 step-2's 298k for a 0-byte re-verify. Also the F-77 corollary made concrete: this **correctly-executed** run's metered cost ($0.7482) is **1.76×** dogfood-072's entire metered total ($0.4241), because 072's real work (the killed step) went unmetered — the meter still understates kill-path runs, never healthy ones.

## Verdict on the thesis

🟢 **The loop's pure→wire cadence closed the F-33 operator-facing gap in one metered step: the dogfood-072 classifier now has a real consumer, and a plan-gate failure finally tells the operator whether re-running is safe. The review's deeper win is diagnostic: dogfood-072's "retry tax" was never a missing short-circuit — it was the judge-check runner reproducing the exact process-tree-reaping bug WP-255 fixed for executor steps, one layer down.**

- 🟢 **WP-233(b) part 1 landed clean.** Renderer polarity exact, wire surgical (one return site), fallback semantics honored, test composes the real classifier on real `PlanVerdict` literals, scope perfect, harvest byte-IDENTICAL, full suite green. Second consecutive correctly-launched single `run` — F-64 paraphrase risk stays retired when the launch mode is honored.
- 🔴 **But the judge's own check runner is not wall-clock-safe.** The 120 s cap kills `/bin/sh` and then waits — 695.9 s in the observed case — for orphaned grandchildren, and the resulting artifact-red is indistinguishable from a code-red. That single defect (a) caused 96% of dogfood-072's cost, (b) can starve the gate, and (c) can drive a false 3-strike HALT. The fix is a mechanical port of the already-proven `runBounded`.

**WP-233 stays 🟡** (part 1 of (b) landed; the Plan-persistence/resume half — WP-233(b) part 2 — remains, contract-shaped, §4). **New: F-78 → WP-264** (🔴 judge-check tree-reap — next dogfood headline). **F-79 → WP-263 re-scoped** (the seal path exists; WP-264 first, then infra-vs-substantive check-failure marking). **F-80** (🟢/🟡 executor toolchain-mandate drift, no WP). **F-58/WP-249 reinforced** (STAGED, no `Run-ID:` trailer). **Next dogfood headline: WP-264 — port the WP-255(a) process-group reap to `runCheck` so a judge-executed check dies at its cap and a hang can't masquerade as a red AC (dogfood-074, gate ✅ PROCEED).**
