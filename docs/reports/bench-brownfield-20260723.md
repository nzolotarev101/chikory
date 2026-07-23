# Benchmark review — brownfield suite 20260723-014235 (P3-rung-4 attempt)

- **Kind:** benchmark-suite review (not a dogfood-NNN headline) · **Date:** 2026-07-23
- **Suite output:** `benchmarks/results/20260723-014235-chikory/` (gitignored)
- **Runs:** `run-94fbc4cc…` (brownfield-001), `run-dc384e7c…` (brownfield-002), `run-322a397e…` (brownfield-003)
- **Ladder:** P3 moat ladder (WP-530 — score ≥5 pinned brownfield tasks vs a baseline); rung-4 target
- **Verdict:** 🔴 **INVALID under directive** — ran Claude executor + Gemini judge (exact opposite of the required Gemini-executes / Codex-judges setup). Fixed by landing WP-216 + config flips; re-run required.

## Plain lead

The suite scored 10/11 requirements (90.9%) and cost $4.96 — but every task ran
with **Claude Code as the executor** and **Gemini as the judge**, the reverse of
the standing directive (Gemini executes, Codex judges). The result cannot count
as a rung-4 baseline. Root cause: no Gemini executor adapter existed and the
judge proxy was pinned to `agy` (Gemini). Both are now fixed — the Antigravity
(`agy`, Gemini-family) executor adapter is built and proven against the real
binary (WP-216), and the judge proxy defaults to Codex.

## What actually ran (journal = ground truth)

| Task | Executor (journal) | Judge backend | Steps | Cost USD | Grader |
|---|---|---|---|---|---|
| brownfield-001 | 🔴 claude-code/anthropic | 🔴 agy (Gemini) | 2 | $1.8278 | 🟢 3/3 |
| brownfield-002 | 🔴 claude-code/anthropic | 🔴 agy (Gemini) | 2 | $2.5339 | 🟡 3/4 |
| brownfield-003 | 🔴 claude-code/anthropic | 🔴 agy (Gemini) | 1 | $0.5966 | 🟢 4/4 |
| **Suite** | — | — | 5 | **$4.9583** | 10/11 |

- Judge $0 (keyless Gemini CLI proxy) but executor spend real ($4.96) — all
  Claude. Under the keyless `gemini-cli` executor this is ≈$0.
- Judge executed all criterion checks (`judge-executed check … exited 0`), all
  `PROCEED`, **0 true-positive catches** (tasks were done correctly).

## New friction

**F-162 — executor/judge families were backwards vs the directive; WP-216 was inertly 🟢.**
- Evidence: all three journals `executor: {adapter:"claude-code",family:"anthropic"}`,
  `judge: openai-compat` → `devbox.json` `judge-proxy … 8787 agy`. `ExecutorAdapterName`
  was `claude-code|codex|native` — no Gemini executor existed, so `plan.md` WP-216
  (Jules/Antigravity adapters) was marked 🟢 with no adapter in code.
- Root cause A: `benchmarks/harness/src/adapter.ts` hardcoded the `claude-code`
  executor default with no override. Root cause B: `devbox.json:30` pinned the
  judge proxy to `agy`.
- **Resolution (landed 2026-07-23, uncommitted):**
  - `packages/sdk-ts/src/executors/gemini-cli.ts` — `createGeminiCliAdapter`
    (`agy`, Gemini family, print mode; `--dangerously-skip-permissions --mode
    accept-edits --add-dir <workspace> --print`). Registered `gemini-cli`→`gemini`
    in `endpoint-capability.ts`, `taskspec.ts`, and the CLI `ADAPTERS` registry.
  - Harness `--executor gemini|claude-code|codex` flag + `CHIKORY_BENCH_EXECUTOR`.
  - `devbox.json` judge-proxy `agy`→`codex`; `scripts/dogfood.sh` default backend `agy`→`codex`.
  - Fake-CLI `agy` dialect + conformance + parser tests; **real-`agy` @e2e green**
    (3-step toy task, 31s). Full SDK suite 969 pass, lint + typecheck clean.

**F-163 — in-loop judge vs harness grader environment gap (open, track-B).**
- Evidence: brownfield-002 R2 — the Gemini in-loop judge ran `pnpm exec vitest run`
  → exit 0 (PASS); the harness grader re-ran the same command → exit 1 (FAIL) on
  `An update to Root inside a test was not wrapped in act(...)` in
  `src/renderer/hooks/useNotifications.test.tsx`. The judge greenlit a benchmark-FAIL.
- Spawns: a track-B task to (a) determine whether the `act()` failure is
  pre-existing/flaky on the base ref (→ unfair AC) or env drift, and (b) parity the
  judge sandbox env with the grading env before rung-4 is scored for real. No WP yet.

## Notes (non-friction)

- **Rung-4 not reachable anyway:** needs ≥5 pinned brownfield tasks; only 3 exist
  (corpus 3/5). Re-running the valid suite is rung-4 *prep*, not a climb.
- **Disk:** `benchmarks/results/` = 13 GB local (each run copies the full repo +
  `node_modules` into the run workspace). Gitignored; housekeeping only.

## Verdict on the thesis

The Agent-as-a-Judge inner loop functioned (checks executed, family diverse), but
this run proves two control-plane gaps the thesis depends on: (1) the operator
could not select the intended executor family at all — a vendor-neutrality hole
now closed by WP-216, and (2) a judge PROCEED that the outcome grader then failed
(F-163) — the reproducibility the "judge = real quality gate" claim rests on.
