# Dogfood-001 — WP-202 (Memory Pointer store) through Chikory itself

**WP**: WP-143 · **Date**: 2026-06-11 · **Task spec**: [`examples/dogfood/dogfood-001.yaml`](../../examples/dogfood/dogfood-001.yaml)

> MVP exit-gate #1: Chikory v0.1 implements one real Phase 2 work package
> end-to-end, with the judge gating intermediate steps. This report records
> what worked, judge interventions, cost, and the friction list that feeds P2
> priorities.

## Setup — zero secrets

The machine has no provider API keys; every agent CLI on it is
OAuth/subscription-authenticated (claude, codex, gemini). The run used
locally-authenticated CLIs only:

- **Executor**: a wrapped agent CLI on its own subscription auth — run 1 used
  `claude-code` (`claude -p`, file-ops tool allowlist), runs 2–4 used `codex`
  (`codex exec`, workspace-write sandbox) after Claude's session limit hit.
- **Judge**: a locally-authenticated CLI behind
  [`scripts/cli-judge-proxy.mjs`](../../scripts/cli-judge-proxy.mjs) — a
  ~150-line local OpenAI-compat `/v1/chat/completions` shim with `codex` and
  `gemini` backends. The router's `openai-compat` provider (WP-102, the
  open-models escape hatch) talks to it via
  `OPENAI_COMPAT_BASE_URL=http://127.0.0.1:8787`. Family diversity holds for
  real in every run: claude executor / GPT judge in run 1, GPT executor /
  Gemini (`gemini-3.1-pro-preview`) judge in runs 2–4 (invariant #2).

```sh
node scripts/cli-judge-proxy.mjs 8787 gemini &
devbox run temporal-dev &
OPENAI_COMPAT_BASE_URL=http://127.0.0.1:8787 pnpm chikory run examples/dogfood/dogfood-001.yaml --watch
```

## The task

Implement the P1 slice of the Memory Pointer Pattern (CM-3): a
`MemoryPointerStore` that keeps large tool outputs out of agent context —
content ≤ `inlineMaxBytes` rides inline, larger content becomes an
`ArtifactRef` in the blob store. Acceptance criteria executed *by the judge*
(JD-4): the new vitest suite, strict typecheck, lint.

## What happened — four runs, every gate exercised

### Run 1 — `run-5b781c3d` · claude-code executor · FAILED (executor outage)

Step 1 produced real code ($1.86, 810k input tokens), then the Claude
subscription hit its session limit mid-run; steps 1–2 sealed FAILED with the
limit message as the failure reason. The judge (GPT-5 via codex, cadence 2)
reviewed the step-1 diff anyway and **raised a genuine concern**: the
exported `MemoryPointerStoreOptions` and `MemoryPointerStore` interfaces
lacked JSDoc despite the instruction requiring it → ESCALATE. The run parked
AWAITING_APPROVAL at zero compute; `chikory approve --reject` sealed an
explicit, resumable FAILED. No spin, no silent budget burn (CG-1 held).

```
run run-5b781c3d… · FAILED · 2 steps · $1.86 / $5.00 · executor claude-code(anthropic) · judge openai-compat
 1   You've hit your session limit · res… 810k/10k   $1.86   ✗ step FAILED
 2   You've hit your session limit · res… 0/0        $0.00   ⚠ ESCALATE
        judge: "…exported interfaces lack their own JSDoc blocks…"
```

### Run 2 — `run-805c66a7` · codex executor · CANCELLED (found a real bug)

Every codex step died in &lt;120 ms with `Error: No such file or directory`.
**Dogfooding caught a real CLI bug**: the default `--data-dir .chikory` flowed
*relative* into `StepInput.workspaceDir`; the codex adapter passes that to
`codex -C`, which re-resolves it against its own cwd (already the workspace)
— a path that doesn't exist. claude-code never noticed (no `-C` flag), so
WP-141's integration tests (absolute temp dirs) couldn't see it either. Fixed
in `b644b05` (CLI resolves dataDir at parse time). Meanwhile the machinery
behaved exactly as designed: the Gemini judge correctly passed AC-2/AC-3
(typecheck/lint pass on the untouched tree) and failed AC-1, the 3-consecutive-
failures loop-breaker ESCALATEd, and `chikory cancel` sealed CANCELLED
cleanly from the parked state.

### Run 3 — `run-6837b7c5` · codex executor · FAILED (judge HALT guard)

Relaunched — but on a stale build (`tsc` had silently not re-emitted; the
fix wasn't in `dist/`). Same instant failures. This run proved the last
untested gate: after AC-1 failed three consecutive judge verdicts, the
deterministic verdict rules fired **HALT** ("criterion AC-1 failed 3+
consecutive verdicts → goal drift / budget-waste guard") and sealed FAILED —
the run never burned a dollar ($0.00 spent over 6 no-op steps).

### Run 4 — `run-d11c6a77` · codex executor · **SUCCESS**

With the fix actually built, the run completed end-to-end in 4m 1s:

```
run run-d11c6a77… · SUCCESS · 2 steps · $0.00 / $5.00 · 4m 1s · executor codex(openai) · judge openai-compat
 1   Implemented Memory Pointer Store: -… 1272k/5.6k   $0.00
 2   Memory Pointer Store is implemented… 181k/1.8k    $0.00   ✓ PROCEED (3/3 criteria)
totals: decisions 2 · judge passes 1 ($0.00, 0.0%) · rollbacks 0 · escalations 0
```

Step 1 implemented the module + tests (156-line diff: `src/memory/
pointer-store.ts`, `test/memory/pointer-store.test.ts`, `index.ts` exports,
JSDoc on every exported symbol). Step 2 verified and tightened. The judge
pass (Gemini 3.1 Pro behind the shim, 19 s, 6.5 KB evidence) **executed all
three acceptance checks itself** — vitest (4 tests), strict typecheck, lint,
all exit 0 — filled the rubric (no unrelated deletions, no secrets, scope
matches instruction), and the deterministic verdict rules sealed PROCEED →
SUCCESS on a `lastGood` checkpoint (`…@5`, commit `dfb282f7`). The
implementation lives on the run-private branch
`chikory/run-run-d11c6a77-…` in the run workspace; WP-202 proper lands it
in P2.

## Judge interventions

1. **Run 1, ESCALATE**: flagged missing JSDoc on exported symbols in a diff
   produced moments before the executor died — a true positive on real code,
   across model families (GPT judging Claude's work).
2. **Runs 2–4, criteria discipline**: with an empty diff the judge refused to
   pass AC-1 while correctly passing AC-2/AC-3 — no rubber-stamping, no
   hallucinated success (JD-4: the judge ran the checks itself).
3. **Run 3, HALT**: the flip-flop/stuck-criterion guard ended a doomed run
   deterministically. Code computed the verdict, not the LLM (JD-7).

## Cost

| Run | Steps | Spend | Outcome |
|---|---|---|---|
| 1 (claude) | 2 | $1.86 | FAILED — executor session limit; judge still reviewed the diff |
| 2 (codex) | 3 | $0.00 | CANCELLED — adapter bug found, fixed in `b644b05` |
| 3 (codex) | 6 | $0.00 | FAILED — judge HALT guard, zero waste |
| 4 (codex) | 2 | $0.00 | **SUCCESS** — 2 steps, 1 judge pass, 3/3 criteria |

Judge passes cost $0.00 on the wire (subscription-backed CLIs; token counts
journaled). The `costEstimated` flag and pricing-table path were not
exercised for the proxy model — noted under friction.

## Friction list (→ P2 priorities)

- **F-1 — provider-env validation assumes API keys.** CONTRACTS.md §9 rule 3
  requires an env key for every provider in `routing.stages`, including
  stages a wrapped-CLI executor never routes through the router. The dogfood
  spec had to label executor stages `openai-compat` (while feeding the claude
  CLI a claude model id) to pass validation. Fix: require keys only for
  router-called stages (judge + failover) when the executor is a wrapped CLI.
- **F-2 — no first-class CLI-backed judge.** The judge can only speak
  provider REST APIs; users whose machines hold only OAuth-authenticated CLIs
  (this user, most individual devs) need the proxy shim. P2 candidate
  alongside WP-216 (jules/antigravity executor adapters): judge adapters that
  drive `codex exec` / `gemini` headless with structured-output parsing.
- **F-3 — `devbox run` inside a fresh workspace clone costs ~80 s of env
  init** against the judge's 120 s per-check cap. Checks had to call bare
  `pnpm` (inherited from the worker's devbox env). Fix options: per-criterion
  `timeout`, or a one-time workspace warm-up hook in `prepareRun`.
- **F-4 — devbox scripts don't forward CLI args**, so `devbox run chikory --
  run …` silently drops everything after the script name; the quickstart had
  to go through a root `package.json` passthrough script (`pnpm chikory …`).

- **F-5 — test dirs masked a path bug.** WP-141's integration tests run in
  absolute temp dirs, so the relative `--data-dir` default never met the
  codex `-C` re-resolution (run 2's bug). Lesson: at least one CLI test
  should run with the *default* relative data dir from a scratch cwd.
- **F-6 — executor availability is a first-class failure mode.** A
  subscription session limit killed run 1 mid-task. The runner degraded
  correctly (explicit FAILED steps, escalation, resumable seal), but P2
  should consider executor failover (retry the step on a different adapter
  family) — the routing policy already has the vocabulary for it.
- **F-7 — judge model identity is opaque behind the shim.** The journal
  records `openai-compat/gemini-3.1-pro-preview`, but nothing attests which
  model actually answered. First-class CLI judge adapters (F-2) should
  journal the backend CLI + its reported model/version.

## Verdict on the thesis

The dogfood goal was "the judge catches at least one genuine issue before it
lands" (plan.md §dogfood proof). Four runs delivered more than that:

- **A cross-family judge made a true-positive catch on real code** (run 1:
  GPT flagged missing JSDoc in Claude's diff) and **refused to rubber-stamp
  empty work** (runs 2–3: AC-1 held at fail while trivially-true criteria
  passed — because the judge runs the checks, not the executor).
- **Every gate fired on a real run, not just in tests**: ESCALATE → human
  reject (run 1), loop-breaker → cancel (run 2), deterministic HALT on a
  stuck criterion at $0.00 burned (run 3), PROCEED → SUCCESS on a verified
  checkpoint (run 4).
- **Dogfooding paid for itself immediately**: two real bugs found and fixed
  (relative data-dir path breaking the codex adapter; multi-line summaries
  breaking the trace table) plus a seven-item friction list that now feeds
  P2 priorities — F-1/F-2 (CLI-auth as a first-class citizen) being the
  loudest, since this user's machine holds no API keys at all.
- **Total spend to implement a real work package under full gating: $1.86**
  (all of it run 1's claude steps; the codex/gemini runs rode subscriptions).

Exit-gate #1 is met: Chikory v0.1 ran a real P2 work package through its own
durable, judged loop, and the journal/trace reconstructs every decision
after the fact.
