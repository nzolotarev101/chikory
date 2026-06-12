# Dogfooding guide — running plan.md work packages through Chikory

This is the complete operating manual for executing Phase 2+ work packages
(`plan.md` §6+) **through Chikory itself**: how to set up, how to write the
task spec for a WP (every field explained), how to launch, supervise, and
recover a run, and how to land the result as a normal PR.

Proven path: dogfood-001 (`docs/reports/dogfood-001.md`) implemented WP-202's
first slice this way — 2 steps, 1 judge pass, 3/3 judge-executed checks,
SUCCESS in 4 minutes. Dogfood-002 (`docs/reports/dogfood-002.md`) repeated it
for WP-201 slice 1 — first-attempt SUCCESS, zero new harness code.

Related docs: [`docs/spec/task-spec.md`](spec/task-spec.md) (schema
reference) · [`docs/TASK-PROTOCOL.md`](TASK-PROTOCOL.md) (WP etiquette, §7 is
dogfood-specific) · [`docs/components/cli.md`](components/cli.md) (command
reference).

---

## 1. When to dogfood a WP

| WP tag | Dogfood? |
|---|---|
| 🟢 Mechanical | **Yes — ideal.** Pattern-following with machine-checkable output (WP-201 Python parity, WP-208 notifications, WP-209 process metrics, WP-216 adapters). |
| 🟡 Builder | **Yes**, sliced. One run = one well-specified slice with checkable criteria. If the WP needs a contracts change (`types.ts`), do that part by hand first — contracts PRs need architect review (TASK-PROTOCOL §4). |
| 🔴 Architect | **Not as one run.** Do the design by hand (ADR/component doc update), then dogfood the implementation slices that fall out of it. |

Rule of thumb from dogfood-001: a run converges fastest when the goal is
completable in **1–3 executor steps** (one step ≈ one focused agent session,
≤10 min, ≤25 turns). Bigger WPs → several runs, one slice each.

## 2. One-time setup

Everything runs via devbox (CLAUDE.md hard rule). From the repo root:

```sh
devbox shell                         # pinned toolchain (node, pnpm, temporal-cli)
devbox run bootstrap                 # pnpm install + python sync
devbox run build                     # compiles the chikory CLI to dist/
devbox run temporal-dev              # durable-execution substrate — leave running (own terminal)
```

> **Rebuild after every SDK change**: `pnpm chikory` runs from `dist/`, not
> `src/`. Stale dist = running yesterday's CLI (this bit us in dogfood-001
> run 3). When in doubt: `devbox run build`.

### 2.1 Executor auth (the agent that writes code)

Executors are wrapped CLIs running on whatever auth they already have — no
Chikory-side keys needed:

| `executor.adapter` | Binary | Auth | Notes |
|---|---|---|---|
| `claude-code` | `claude` | Anthropic subscription OAuth or `ANTHROPIC_API_KEY` | File-ops tool allowlist; exact cost on the wire. Subscription **session limits are a real failure mode** (killed dogfood run 1) — the run degrades safely, but prefer API-key auth for long runs. |
| `codex` | `codex` | ChatGPT OAuth or `OPENAI_API_KEY` | `workspace-write` sandbox; cost estimated from pricing table (`costEstimated: true`). |

### 2.2 Judge auth (the gate — a *different* model family)

The judge calls an LLM directly through the router. Two paths:

**Path A — API key** (simplest if you have one). Export the key for the
judge's family and route the judge stage at it:

```sh
export GEMINI_API_KEY=…        # or OPENAI_API_KEY / ANTHROPIC_API_KEY
```

**Path B — zero secrets** (locally-authenticated CLIs only; what dogfood-001
used). A local shim exposes the `codex` or `gemini` CLI as an OpenAI-compat
endpoint through the router's existing `openai-compat` seam:

```sh
node scripts/cli-judge-proxy.mjs 8787 gemini &     # backends: gemini | codex
export OPENAI_COMPAT_BASE_URL=http://127.0.0.1:8787
```

Pick the judge backend from a **different family than the executor**
(invariant #2): codex executor → `gemini` judge backend; claude-code
executor → `codex` or `gemini`. Path B has one routing quirk — see §3.8.

## 3. Writing the task spec — every field

Convention (TASK-PROTOCOL §7): the spec lives at
`examples/dogfood/wp-<n>.yaml`. A ready-to-run example ships at
[`examples/dogfood/wp-201.yaml`](../examples/dogfood/wp-201.yaml). Schema
reference with all validation rules: [`docs/spec/task-spec.md`](spec/task-spec.md).

### 3.1 `name` (required)

Short slug for the run, e.g. `wp-201-python-parity-contracts`. Appears in
nothing load-bearing yet; keep it greppable.

### 3.2 `goal` (required) — the most important field

This exact text is the executor's instruction **on every step** (P1 has no
planner; the loop re-sends the goal with accumulated context). Write it like
a complete, self-contained brief to a competent engineer who has the repo
open and `AGENTS.md` read:

- **Name every file path** to create/modify (`packages/sdk-py/src/...`).
- **Spell out the public API** — exported names, signatures, defaults. The
  judge holds the diff against this text; vagueness produces escalations.
- **Name the conventions** that apply (strict TS / ruff, named exports, .js
  import extensions, JSDoc on exports, no new dependencies).
- **State what NOT to touch** if the WP is near shared files.
- Scope it to 1–3 steps' worth of work (§1). If you can't describe the
  change in one paragraph of concrete instructions, split the WP into
  multiple runs.

### 3.3 `repos` (required, exactly 1 in P1)

```yaml
repos:
  - url: /absolute/path/to/repo   # local path or git URL
    ref: main                     # optional branch/commit; default = default branch
    writable: true                # at least one repo must be writable
```

`prepareRun` **clones** this into a private workspace
(`.chikory/runs/<run-id>/workspace`) on a run-private branch
(`chikory/run-<run-id>`) — your checkout is never touched, and only
**committed** state is cloned (commit before launching). Use an absolute
path for local repos. Multi-repo is P2 (WP-214).

### 3.4 `acceptance_criteria` (required) — what the judge enforces

```yaml
acceptance_criteria:
  - id: AC-1                        # stable, unique; verdicts reference it
    description: the new test suite passes
    check: pnpm install --prefer-offline --silent && pnpm --filter @chikory/sdk exec vitest run test/foo.test.ts
  - id: AC-2
    description: strict typecheck still passes
    check: pnpm --filter @chikory/sdk typecheck
  - id: AC-3
    description: public API matches the goal's signatures
    # no check → judged from diff evidence only
```

How checks behave — this is the heart of the gate (JD-4):

- The **judge executes each `check`** with `sh -c` in the run **workspace**
  (the clone), at every judge pass. Exit 0 = pass. The executor's claims are
  never trusted.
- **120-second wall-clock cap per check** (`DEFAULT_CHECK_TIMEOUT_MS`).
  Budget accordingly: the workspace is a fresh clone, so the first check
  must include dependency install (`pnpm install --prefer-offline` ≈ 15 s
  warm). Subsequent passes are fast (`node_modules` persists).
- **Call toolchain binaries directly (`pnpm`, `pytest`, `uv`), not
  `devbox run`.** Checks inherit the worker's environment, which already *is*
  the devbox environment when you launch via `devbox run -- pnpm chikory …`
  — whereas `devbox run` inside a fresh clone pays ~80 s of env init against
  the 120 s cap (dogfood friction F-3).
- A criterion can fail honestly for a while (work in progress). But a
  criterion failing **3 consecutive judge verdicts → deterministic HALT**
  (goal-drift guard, seals FAILED). Set `cadence` so the work has time to
  land between passes (§3.7).
- **Run-level SUCCESS = PROCEED verdict + every criterion passing.** A run
  cannot succeed with a failing check.
- Prefer machine-checkable criteria (OB-3). Description-only criteria are
  judged from the diff by the rubric — fine for API-shape assertions, weak
  for behavior.

### 3.5 `budget_usd` (required) and `max_steps` (default 100)

- `budget_usd` — hard cap (CG-2). Pre-step gate estimates the next step at
  1.5× the rolling mean of the last 5 step costs; a breach **suspends** the
  run on its last checkpoint (zero compute) until
  `chikory resume <run-id> --add-budget <usd>`. Subscription-auth runs
  report $0.00 on the wire, so the gate is inert there; with API keys, $5–20
  fits a 1–3-step WP slice (dogfood: $1.86 total across four runs).
- `max_steps` — absolute step ceiling; reaching it seals FAILED. For a
  scoped slice, 6–10 is plenty; the default 100 just delays the inevitable
  on a drifting run.

### 3.6 `executor` (required)

```yaml
executor:
  adapter: codex        # registered adapter: claude-code | codex
  family: openai        # the adapter's model family — used for judge-diversity enforcement
```

`family` must be the executor's **true** family (claude-code → `anthropic`,
codex → `openai`); it's what invariant #2 is checked against.

### 3.7 `judge` (required)

```yaml
judge:
  family: gemini          # must differ from executor.family (or allow_same_family: true + loud warning)
  cadence: 2              # judge every N steps (default 3)
  max_cost_share: 0.5     # warn when judge spend exceeds this fraction of run cost
  # model: gemini-2.5-pro # optional; defaults from routing.stages.judge
  # scoring_method: pointwise   # default; pairwise is P2 (WP-210)
```

Choosing `cadence`: each pass costs a judge LLM call + all check commands.
- Small slice (1–3 steps): `cadence: 2` — first verdict early, and a
  finished step 2 can seal SUCCESS immediately.
- Longer run: `cadence: 3` (default) balances cost vs drift window. Remember
  the HALT guard counts *verdicts*, so cadence × 3 steps is how long a
  criterion may stay red before the run is killed.

### 3.8 `routing` (optional — read this if using the zero-secrets path)

Omitted → `defaultPolicy(executor.family)`: light model for plan, heavy for
code/review, different-family heavy model for judge. **With API keys, omit
it** and just make sure the keys for both families are exported (validation
fails fast naming any missing variable).

With the **zero-secrets shim** you currently need an explicit block, because
parse-time validation demands an env key for every provider that appears in
`routing.stages` — even stages a wrapped-CLI executor never routes through
the router (known wart, friction F-1; fix planned in P2):

```yaml
routing:
  stages:
    # plan/review are unused by CLI executors in P1; code.model feeds the executor CLI (-m flag).
    plan:   { provider: openai-compat, model: gpt-5.5 }
    code:   { provider: openai-compat, model: gpt-5.5 }            # ← a model id the EXECUTOR CLI accepts
    review: { provider: openai-compat, model: gpt-5.5 }
    judge:  { provider: openai-compat, model: gemini-3.1-pro-preview }  # ← passed to the shim's backend CLI (-m)
```

Only `OPENAI_COMPAT_BASE_URL` needs to be set; the `openai-compat` labels on
executor stages are the documented workaround. `judge.family` is then
`openai-compat` — real diversity is whatever model family backs the shim, so
keep it different from the executor's (and pick `judge.model` to match the
backend: a Gemini model id for the `gemini` backend, etc.).

### 3.9 P2-reserved blocks

`pacing` (WP-207) and `notifications` (WP-208) parse but do nothing yet.

## 4. Launch checklist

```sh
# 0. preconditions
git status                  # commit everything the run should see — the workspace clones HEAD
devbox run build            # dist/ is what runs
devbox run temporal-dev     # running in its own terminal
node scripts/cli-judge-proxy.mjs 8787 gemini &   # zero-secrets path only

# 1. launch (from the repo root; --watch streams journal entries live)
OPENAI_COMPAT_BASE_URL=http://127.0.0.1:8787 pnpm chikory run examples/dogfood/wp-201.yaml --watch
```

`run` validates the spec (actionable errors: missing env vars are named),
hosts the Temporal worker in-process, prints the `run-id`, and follows the
run to its terminal state. **Exit code mirrors the run**: 0 = SUCCESS,
1 = FAILED/CANCELLED. Ctrl-C only detaches your terminal — the run state is
durable; reattach with `chikory resume <run-id>`.

## 5. Supervising a live run

```sh
pnpm chikory status                       # list all local runs
pnpm chikory status <run-id>              # step, spend vs budget, last verdict, checkpoints
pnpm chikory trace <run-id>               # full trajectory (works mid-run and offline)
pnpm chikory trace <run-id> --step 2      # one step: diff/transcript refs, judge form, rationale
```

States you will encounter and what to do:

| You see | Meaning | Action |
|---|---|---|
| `AWAITING_APPROVAL` | Judge ESCALATEd, or 3 consecutive executor failures (loop-breaker) | Read the rationale in `trace`, then `pnpm chikory approve <run-id>` to continue or `… approve <run-id> --reject "<reason>"` to seal FAILED |
| `SUSPENDED` | Budget gate tripped | `pnpm chikory resume <run-id> --add-budget 10` |
| `ROLLBACK` verdict in trace | Judge reverted the workspace to the last PROCEED-ed checkpoint; its rationale rides into the next step as feedback | Nothing — the loop self-corrects; watch the next verdict |
| Worker/laptop died | Run state is in Temporal + journal | `pnpm chikory resume <run-id>` — journaled steps are never re-executed, zero duplicate spend |
| Hopeless run | — | `pnpm chikory cancel <run-id>` (graceful, final checkpoint written) |

Mid-run guidance injection (`chikory inject`) is P2 (WP-212) — today your
levers are approve/reject, budget, and cancel.

## 6. Harvesting the result

The work lives in the run workspace, on a run-private branch:

```sh
ws=.chikory/runs/<run-id>/workspace        # a full clone of your repo
git -C $ws log --oneline main..HEAD        # 'chikory: step <n>' checkpoint commits
```

Land it per TASK-PROTOCOL (one WP = one branch = one PR):

```sh
git checkout -b wp-201-python-parity
git -C $ws diff chikory-base..HEAD | git apply   # squash the run's net diff onto your branch
devbox run lint && devbox run typecheck && devbox run test
git add -A && git commit  # conventional message; PR description cites the run-id + verification commands
```

Also per TASK-PROTOCOL §7: keep the journal as an artifact (don't delete
`.chikory/runs/<run-id>` — `journal.db` + `artifacts/` are the audit trail),
and write observed friction into `docs/reports/` — dogfood reports drive
reprioritization at phase boundaries.

## 7. Troubleshooting

| Symptom | Cause → fix |
|---|---|
| `Invalid task spec: provider 'x' … missing env var Y` | Parse-time key validation. Export the key, or use the §3.8 routing workaround for keyless CLI runs. |
| `Is the Temporal dev server up?` | It isn't. `devbox run temporal-dev`. |
| Steps fail instantly, `executor exited with code 1` | Read the failure: `pnpm chikory trace <run-id> --step 1`. Check the executor binary works headless in your env (`codex exec`/`claude -p` smoke test). |
| Steps fail with a session/usage-limit message | Subscription executor ran dry (dogfood run 1). Reject the escalation, switch `executor` to the other CLI (or API-key auth), relaunch. |
| Judge checks time out | 120 s/check cap. Bare `pnpm` not `devbox run` (§3.4); split slow suites into a focused test file per criterion. |
| Judge verdict is ESCALATE with `judge raised concerns` | The rubric/concerns fired (e.g. scope creep, deleted tests). `trace --step <n>` shows the full form; approve or reject deliberately. |
| CLI behaves like yesterday's code | Stale `dist/`. `devbox run build`. |
| `pnpm chikory: command not found` | Bin link lost: `rm node_modules/.pnpm-workspace-state-v1.json && devbox run -- pnpm install`. |
| Proxy run dies with router FAILED on judge pass | Shim not running / wrong port — restart `cli-judge-proxy.mjs` and check `OPENAI_COMPAT_BASE_URL`. |

## 8. Known P1 limitations (so you don't fight them)

- **No planner**: every step gets the full `goal` as its instruction, plus
  the last 5 step summaries, judge feedback, and acceptance criteria. Scope
  goals accordingly (§3.2).
- **Single repo**, no `inject`, no `branch`, no suspend-for-days HITL UX, no
  pacing — all P2 (WP-214, -212, -205, -206, -207).
- **Subscription-auth runs report $0.00 cost** → budget gate inert; rely on
  `max_steps` and the HALT guard instead. The zero-secrets routing path is
  $0 even with the codex estimator (openai-compat defaults to $0; unknown
  models price at $0) — dogfood-002 F-9; token-denominated budgets are
  WP-218.
- **The judge fires only on cadence** — an executor that finishes early
  still burns filler steps until the next cadence boundary (dogfood-002
  F-8: a no-op step cost 155k tokens). With `cadence: 2`, scope the goal so
  the work genuinely needs ~2 steps; off-cadence judge-on-completion is
  WP-217.
- Executor tool sandboxes are real but different: claude-code is
  file-ops-only (can't run tests itself — the judge does), codex has
  workspace-write (can run tests). Both are fine: SUCCESS is judge-verified
  either way.
