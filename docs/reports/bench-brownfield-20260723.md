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

**F-163 — judge/grader reproducibility gap → node-engine mismatch (LANDED by hand 2026-07-23).**
- Original symptom: brownfield-002 R2 — the in-loop judge reported the `vitest run`
  check green while the harness grader re-ran it red on an
  `An update to Root inside a test was not wrapped in act(...)` warning in
  `src/renderer/hooks/useNotifications.test.tsx`. A judge PROCEED over a benchmark-FAIL.
- **Root cause (a) — empirically nailed, NOT flaky:** re-ran R2 on the UNTOUCHED
  pinned base ref (`a061eaa1`) three times in devbox → deterministically RED every
  time. The `act()` line is stderr noise; the real failure is `renderHook(() =>
  useAccountsStore())` returning `result.current === null` across the whole suite:
  **354/1128 tests fail, incl. 107 snapshot-serialization drifts.** R1's own grade
  detail carried the tell — `[WARN] Unsupported engine: wanted {"node":">=24"}
  (current v22.22.3)` + `react 19.2.7`. gitify pins **node ≥24**; the Chikory devbox
  pins **`nodejs@22`** (`devbox.json`). React-19's test renderer never commits under
  the unsupported engine. So R2 ("full suite green") can pass for **no** agent — the
  AC is invalid in this environment, and the whole task is unscoreable here.
- **Root cause (b) — real parity gap in code:** the two check runners diverged —
  the in-loop judge (`packages/sdk-ts/src/judge/evidence.ts`) ran checks via
  `/bin/sh` + `scrubExecutorEnv` + a process-group deadline; the harness grader
  (`benchmarks/harness/src/grade.ts`) used bare `bash -c` + full inherited env +
  plain SIGKILL. Any provider-var/shell/kill difference could flip a verdict.
- **Resolution (landed, uncommitted):**
  - **Parity:** `grade.ts runCheck` now reuses the SDK's `runBounded` +
    `scrubExecutorEnv` over `/bin/sh` — byte-identical to the in-loop judge. New
    grader test proves `$GEMINI_API_KEY` is scrubbed from the check env.
  - **Quarantine:** new task `status: blocked` (+ required `blocked_reason`) —
    fully-pinned tasks the env can't grade reproducibly; the suite ALWAYS skips
    them (never scored), regardless of `skipDrafts`. brownfield-002 marked blocked
    with the node≥24 reason. `bench validate` = 3 valid; `bench list` shows
    `blocked (not runnable)`.
  - Harness 34 tests + SDK 969 tests green; typecheck + lint clean.
- **Spawns WP-534** (per-target node provisioning) — run each target repo's checks
  under the node engine its `package.json` demands, not the fixed devbox pin. Until
  then brownfield-002 stays blocked. Corpus effectively **2 runnable brownfield
  tasks** (001, 003) — compounds the rung-4 ≥5-task shortfall below.

## Notes (non-friction)

- **Rung-4 not reachable anyway:** needs ≥5 pinned brownfield tasks; the corpus has
  3, and F-163 blocks brownfield-002 → **2 runnable** (001, 003). Re-running the
  valid suite is rung-4 *prep*, not a climb; the corpus gap is now the binding limit.
- **Disk:** `benchmarks/results/` = 13 GB local (each run copies the full repo +
  `node_modules` into the run workspace). Gitignored; housekeeping only.

## Verdict on the thesis

The Agent-as-a-Judge inner loop functioned (checks executed, family diverse), but
this run proves two control-plane gaps the thesis depends on: (1) the operator
could not select the intended executor family at all — a vendor-neutrality hole
now closed by WP-216, and (2) a judge PROCEED that the outcome grader then failed
(F-163) — the reproducibility the "judge = real quality gate" claim rests on. F-163
is now closed two ways: the two check runners execute identically (parity), and a
target the env cannot grade is `blocked`, not silently red-graded. The deeper cause
was mundane and worth stating: a **node-engine mismatch** (target ≥24 vs devbox 22)
made an entire benchmark AC invalid — a reminder that "judge = quality gate" is only
as sound as the environment the checks run in. WP-534 (per-target node) closes that.
