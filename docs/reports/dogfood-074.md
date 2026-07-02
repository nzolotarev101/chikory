# dogfood-074 — WP-264 LANDED (the judge-check runner now REAPS the check's whole process tree at the timeout cap — F-78 closed) — clean spec-faithful one-shot; the LAST prescribed-diff headline before the WP-265 horizon ladder

- **WP:** WP-264 — port the WP-255(a) process-group kill (`runBounded`, `src/executors/process.ts`: `spawn(detached:true)` + `process.kill(-pid)` SIGTERM→SIGKILL) to `runCheck` (`src/judge/evidence.ts`), so a judge-executed acceptance `check` whose grandchildren hold the stdout/stderr pipes (vitest tinypool workers) dies at the 120 s cap instead of running far past it — and an infra hang can no longer read as a substantive red AC. Closes dogfood-073 **F-78**. Authored AND launched correctly as a **single `chikory run`** — 3rd consecutive correct launch (the 067–071 divergence streak stays broken).
- **Date:** 2026-07-02
- **Spec:** `examples/dogfood/dogfood-074.yaml` (`dogfood-074-wp264-judge-check-tree-reap`)
- **Run-id (single run):** `run-6063231c-402e-4eda-9881-736b39cbf876`. Runtime HEAD `4112701`.
- **Landed commit:** none yet — **2 files STAGED, uncommitted** on the working tree (`packages/sdk-ts/src/judge/evidence.ts` EDIT +12/−21, `packages/sdk-ts/test/judge/check-timeout-reap.test.ts` NEW +82), byte-**IDENTICAL** to the run workspace (pack §5 both `IDENTICAL`). Left for operator review per dogfood-review §4.

## Trace (single run, 1 step)

```
run run-6063231c-… · SUCCESS · 1 step · $1.97 / $5.00 · 5m 34s · executor codex(openai) · judge gemini-3.1-pro-preview(openai-compat)

 #   step deliverable                                tokens(in/out)  step$     judge$    verdict         dur / tools
 1   EDIT runCheck→runBounded + NEW reap test        1477k/11k       $1.9591   $0.0099   ✓ PROCEED 2/2   4m50s / 48 tools

totals: 1 decision · 1 judge pass · $1.9690 total (exact sum) · judge $0.0099 (0.5%) · 0 rollbacks · 0 escalations
        budget 39.4% of $5.00 · checkpoint …@4 (43f51f1501d4) lastGood true
        no empty-diff/probe step (F-11 clean) · no wall-clock kill (4m50s ≪ 600s — F-76 did NOT recur)
        harvest 2/2 files IDENTICAL to working tree · family diversity real (codex/openai ≠ judge gemini via openai-compat shim)
```

## Delivery quality (human review, post-landing)

🟢 **Spec-faithful first-pass, exactly the two named files, every mandated symbol / substring / behavior present, and the `runBounded` signature verified against the source-of-truth.** Reviewed the diff line-by-line against the goal:

| Mandated | Delivered | ✓ |
|---|---|---|
| `import { runBounded } from "../executors/process.js";` (top, next to relative imports) | exact (`evidence.ts:14`) | 🟢 |
| `runCheck` body calls `runBounded("/bin/sh", ["-c", criterion.check!], { cwd, env: scrubExecutorEnv(process.env, []), maxSeconds: timeoutMs / 1000 })` | exact — the ms→seconds conversion is present, not raw ms | 🟢 |
| `exitCode` — `bounded.timedOut ? 1 : (bounded.exitCode ?? 1)` (timed-out ⇒ nonzero; killed-by-signal `null` ⇒ 1) | exact (`const exitCode = bounded.timedOut ? 1 : (bounded.exitCode ?? 1);`) | 🟢 |
| `output` — `bounded.stdout + bounded.stderr` + exact marker `` `\n[check timed out after ${timeoutMs}ms]` `` when timed out, then `bound(output, 64 * 1024)` | exact; marker preserved verbatim | 🟢 |
| `durationMs` — `bounded.durationMs`; `criterionId`/`command` unchanged | exact | 🟢 |
| old `execFileAsync("/bin/sh", …)` + try/catch removed; the `git()` helper's `execFileAsync` STAYS | confirmed — `execFileAsync` only on the `git()` path now | 🟢 |
| JSDoc extended with a WP-264 / dogfood-073 F-78 sentence citing the WP-255(a) port | present (`evidence.ts:67`) | 🟢 |
| NEW test drives PUBLIC `collectEvidence` (not the private `runCheck`) via `createMemoryArtifactStore`, mkdtemp+`git init` harness | exact — mirrors `new-dependency-scan-evidence.test.ts` harness | 🟢 |
| reap case: `check: "sleep 60 & sleep 60"`, `checkTimeoutMs: 1000`; assert `exitCode` ≠ 0, `output` contains `[check timed out after 1000ms]`, `durationMs` `< 10_000`; 30 s vitest timeout | exact (`check-timeout-reap.test.ts:40-63`) | 🟢 |
| green case: `check: "echo reap-ok"`; assert `exitCode` 0, contains `reap-ok`, NOT `check timed out` | exact (`:65-81`) | 🟢 |

- **`runBounded` signature verified** against `src/executors/process.ts:9-27`: `BoundedProcessOptions { cwd; env?; maxSeconds; killGraceMs? }` and `BoundedProcessResult { exitCode: number|null; stdout; stderr; timedOut; durationMs }` — the call and every field read line up exactly. The port reuses the landed, conformance-proven group-kill; no new dependency, `process.ts`/`types.ts`/`DEFAULT_CHECK_TIMEOUT_MS`/`CheckRun` untouched.
- **Reap PROVEN, not just asserted:** the AC-1 re-run's reap test settled the `sleep 60 & sleep 60` hang in **1104 ms** against the 1000 ms cap (bound `< 10_000`) — pre-fix it would hold the pipe ~60 s. The backgrounded `sleep 60 &` is exactly the pipe-holding grandchild class that made dogfood-072's AC-2 run 695.9 s; the group-kill now reaps it near the cap.
- **Scope discipline:** exactly the 2 named files (pack §4). No `process.ts`, `types.ts`, contract, or dependency change. ✓
- **AC re-run against working tree:** AC-1 PASS (5 grep-pins + scoped vitest **2 passed**, reap in 1104 ms), AC-2 PASS (tsc + eslint + full suite **576 passed | 19 skipped**). ✓
- **Harvest:** both files byte-IDENTICAL to the run workspace (pack §5). ✓
- **No F-64 paraphrase risk** — single `chikory run`, full goal verbatim to the executor; the exact `runBounded` call, the unit conversion, the marker string, and the fixture semantics all survived. Third consecutive proof that correct launch mode = zero mandate-dropping.

## New friction

Friction numbering is global + sequential; the highest prior is **F-81** (dogfood-071 review / plan.md §6 — the `parseWpStatus` schema no-op). This run surfaced **no new numbered friction** — a clean, spec-faithful, in-scope, correctly-launched single run. Two standing patterns and one data point only:

### ℹ️ Token-economics baseline (WP-203 / WP-207 data, no friction) — this run is the recent input-token high-water mark

- **1,477k input / 11k output, 48 tool calls, 4m50s, $1.9591** for a fully-prescribed 2-file port. That is **2.7× dogfood-073's 548k input** ($0.7384, 22 tools) for a comparably-sized, comparably-prescribed diff, and **2.6× the metered total** ($1.9690 vs $0.7482). Same executor (`codex`/`gpt-5.5`), same launch mode, MORE prescriptive spec — yet ~2.7× the input tokens and ~2.2× the tool calls. This is the F-77/F-80 codex-verbosity lineage made concrete again: metered input tokens on codex do **not** track task size; the executor over-explored (reading `process.ts`, the reference test harness, re-greps) despite an exhaustive goal. Baseline data for WP-203 (context rot) / WP-207 (pacing) — **not** a budget or reliability defect (budget 39.4%, no kill, all green). No WP.
- **F-76 / F-80 did NOT recur:** the step finished in 4m50s (≪ the 600 s wall-clock cap — no kill, no retry tax), and the ACs are defined with bare `pnpm exec` (not `devbox run`). The wall-clock-safety this very run lands is what would have bounded a recurrence.

### 🟡 F-58 / WP-249 reinforced — delivery STAGED, no `Run-ID:` trailer, not harvested via `chikory land --verify`

- Same standing pattern as 070–073: pack §6 `no landed commit found`. WP-249's track-B harvest-adoption remainder already owns this; no new WP.

## Verdict on the thesis

🟢 **The judge's own check runner is now wall-clock-safe. dogfood-073's diagnosis — that dogfood-072's "retry tax" was an un-reaped 695.9 s process-tree hang masquerading as a red AC — was correct, and the fix was exactly the mechanical port it predicted: the already-proven `runBounded` group-kill applied one layer down, on the judge-check path. A hang can no longer hold the gate hostage or drive a false 3-strike HALT on green code.**

- 🟢 **WP-264 landed clean.** The unit conversion (`maxSeconds: timeoutMs / 1000`), the timed-out ⇒ nonzero exit mapping, the exact `[check timed out after ${timeoutMs}ms]` marker, `scrubExecutorEnv`, and the 64 KiB `bound()` all preserved; the new test drives the public `collectEvidence` and proves the reap in 1104 ms; scope exact; harvest byte-IDENTICAL; full suite green. **WP-264 → 🟢. F-78 → closed.** Third consecutive correctly-launched single `run`.
- 🟢 **Unblocks the WP-263 residual** (reliable post-kill checks): the check-level infra-vs-substantive marking WP-263(b) asks for can now sit on a check runner that actually dies at its cap.
- ⚠️ **This was the LAST prescribed-diff headline.** The progression gate reads **⛔ STALLED** — no thesis axis (horizon, ladder rung, resume, spec looseness) has moved in 3 runs; all 74 runs remain 1–3 prescribed-diff steps, minutes long. Per the 2026-07-02 course correction (plan.md §6, binding), the next headline **IS the WP-265 horizon ladder rung 1**: a **LOOSE-spec** (outcome + ACs, no prescribed diff) run on **WP-212 `chikory inject`** — the first non-prescribed headline and the first movement on the `spec_format=loose` axis.

**WP-264 → 🟢 (F-78 closed).** **WP-263 residual unblocked** (post-kill checks now reliable; the infra-vs-substantive check-marking remainder rides WP-263(b)). **F-58/WP-249 reinforced** (STAGED, no `Run-ID:` trailer). **Progression: ⛔ STALLED — next dogfood headline is WP-265 rung 1: LOOSE-spec run on WP-212 `chikory inject` (dogfood-075, gate ✅ PROCEED recorded below).** The prescribed-diff harness-hardening era is done paying rent as the headline.
