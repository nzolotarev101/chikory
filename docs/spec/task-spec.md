# task.yaml — Task Specification: Complete Field Reference

User-facing YAML form of `TaskSpec` ([CONTRACTS.md §2](CONTRACTS.md)). Parsed and
validated by `packages/sdk-ts/src/taskspec.ts`; full validation rules in CONTRACTS.md §9.

---

## Top-level fields

### `name` (required, string)

Short slug — appears in journal entries and `chikory status` output. No
load-bearing semantics yet; keep it greppable.

```yaml
name: wp-201-python-contracts-parity
```

---

### `goal` (required, string)

**The most important field.** By default, this exact text is the executor's
instruction on **every step** (P1 has no planner; the loop re-sends `goal` with
accumulated context each turn). When `bounded_work_unit.work_chunks` is set, the
durable loop instead hands the current chunk's `directive` as that step's
instruction/context goal, while the judge still evaluates the run against this
top-level goal and the acceptance criteria. Write it like a complete brief to a
competent engineer who has the repo open and `AGENTS.md` read:

- Name every file path to create or modify.
- Spell out the public API: exported names, signatures, defaults.
- Name the conventions that apply (strict TS, ruff, named exports, JSDoc on exports, no new deps).
- State what NOT to touch if the WP is near shared files.
- Scope to 1–3 steps' worth of work. If you can't describe it in one concrete paragraph, split the run.

The judge holds the diff against this text; vague goals produce escalations.
Multi-line YAML block scalar (` > ` or ` | `) is normal.

---

### `repos` (required, list, at least 1)

```yaml
repos:
  - url: /absolute/path/to/service-api      # local absolute path OR git HTTPS/SSH URL
    ref: main                              # optional branch, tag, or commit hash; default = repo's default branch
    writable: true                         # at least one repo must be writable (§9 rule 2)
  - url: /absolute/path/to/service-worker
    writable: true
  - url: git@github.com:org/reference.git
    ref: docs-v1
    writable: false                        # read-only context repo
```

`prepareRun` **clones** each entry into `.chikory/runs/<run-id>/workspace` on a
run-private branch `chikory/run-<run-id>` for writable repos. Your checkout is
never touched. Only **committed** state is cloned — commit before launching. Use
an absolute path for local repos.

Workspace layout is compatibility-preserving:

- Single-repo specs keep the historical root checkout:
  `.chikory/runs/<run-id>/workspace` is the repo.
- Multi-repo specs use deterministic subdirectories derived from each repo URL
  basename, lowercased and sanitized. For example, `/src/service-api` becomes
  `.chikory/runs/<run-id>/workspace/service-api`. Duplicate names receive
  numeric suffixes such as `service-api-2`.

Each checkpoint commits **all writable repos**. Multi-repo checkpoint journal
entries include `perRepoCommits`, keyed by the resolved workspace repo name, so
resume/rollback/trace/status can identify every writable repo's checkpoint
commit. Read-only repos are cloned for context but are not checkpoint-committed.

| Sub-field | Valid values | Notes |
|---|---|---|
| `url` | absolute path or git URL | `file://` prefix optional for local paths |
| `ref` | any git ref | Defaults to repo's HEAD |
| `writable` | `true` \| `false` | At least one must be `true` |

---

### `acceptance_criteria` (required, list, at least 1)

```yaml
acceptance_criteria:
  - id: AC-1                    # stable identifier; verdicts reference it
    description: test suite passes
    check: pnpm --filter @chikory/sdk exec vitest run
  - id: AC-2
    description: strict typecheck
    check: pnpm --filter @chikory/sdk typecheck
  - id: AC-3
    description: worker repo smoke test
    repo: service-worker        # optional: run check from that repo subdir
    check: test -f worker.txt
  - id: AC-4
    description: API shape matches goal (binary rubric, no shell check)
    # omit check → judge evaluates from diff only
```

#### How checks work (JD-4)

The **judge** (not the executor) runs each `check` via `sh -c` in the run
workspace at every judge pass. Exit 0 = pass; non-zero = fail. Executor
claims are never trusted.

- **120-second wall-clock cap per check** (`DEFAULT_CHECK_TIMEOUT_MS`). The
  workspace is a fresh clone on first pass — include dependency install in the
  first check if needed (`pnpm install --prefer-offline` ≈ 15 s warm; subsequent
  passes reuse `node_modules`).
- **Call toolchain binaries directly** (`pnpm`, `uv`, `pytest`, `ruff`,
  `pyright`). Checks inherit the worker's environment, which already *is* the
  devbox environment when you launch via `devbox run -- pnpm chikory …`. Using
  `devbox run` inside the workspace clone pays ~80 s of env init against the
  120 s cap (dogfood friction F-3).
- **HALT guard**: a criterion failing **3 consecutive judge verdicts** triggers
  deterministic HALT → sealed FAILED (goal-drift guard). The loop does not
  wait for the LLM to decide; code computes the verdict (JD-7).
- **SUCCESS = PROCEED verdict + every criterion passing.** A run cannot succeed
  with any failing check.
- **Multi-repo targeting**: set `repo` to a resolved workspace repo name to run
  that criterion with `cwd` set to the repo subdirectory. Omit `repo` to run from
  the workspace root. Single-repo runs resolve the only repo as `"."`, so legacy
  checks continue to run exactly as before.
- Prefer machine-checkable criteria (OB-3). Description-only criteria are
  judged from the diff — fine for shape assertions, weak for behavior.

| Sub-field | Required | Notes |
|---|---|---|
| `id` | yes | Must be unique within the spec |
| `description` | yes | Human-readable; read by the judge as rubric context |
| `check` | no | Shell command; omit for evidence-only judgment |
| `repo` | no | Resolved workspace repo name whose checkout should be the check cwd |

---

### `budget_usd` (required, number > 0)

Hard cost cap (CG-2). Pre-step gate estimates the next step at 1.5× the
rolling mean of the last 5 step costs; a projected breach **suspends** the run
on its last checkpoint (zero compute) until:

```sh
pnpm chikory resume <run-id> --add-budget <usd>
```

Subscription-auth runs (`claude-code` / `codex` on OAuth) report `$0.00` on
the wire, so the gate is inert there. With API keys, `$5–20` fits a scoped
1–3-step slice (dogfood-001: `$1.86` total across four runs).

---

### `max_steps` (optional, integer ≥ 1, default `100`)

Absolute step ceiling. Reaching it seals FAILED. For a scoped slice, 6–10 is
plenty; the default 100 just delays the inevitable on a drifting run. The HALT
guard (3 consecutive failing verdicts) will usually fire first.

---

### `step_limits` (optional block — per-step executor bounds)

```yaml
step_limits:
  max_seconds: 840   # wall-clock cap per step; ceiling 840 (Temporal activity timeout)
  max_turns: 50      # tool-call/turn cap per step (adapter default: claude-code 25)
  max_cost_usd: 2    # per-step spend cap (adapter-dependent)
```

All fields optional; anything unset falls back to the runner default
(`max_seconds: 600`) or the adapter default. Raise `max_turns` for long
brownfield tasks: dogfood-111 (WP-533 live proof) showed the 25-turn default
forces a 3–6 h task into restart churn — every capped step re-reads ~1.1 M
input tokens of context. A capped step is a SUCCESSFUL bounded invocation
(the judge gates the work); the caps exist to bound spend per step, not to
signal failure. `max_seconds` > 840 is rejected at parse time — the
executeStep activity's 15-minute `startToCloseTimeout` would kill the step
before the runner could reap and journal it.

---

## `executor` block (required)

```yaml
executor:
  adapter: codex        # which executor adapter to use
  family: openai        # the adapter's true model family — for invariant #2
```

### `executor.adapter`

The registered adapter name. Two adapters ship in P1:

| Value | Binary | Auth | Cost reporting | Notes |
|---|---|---|---|---|
| `claude-code` | `claude` (Claude Code CLI) | Anthropic subscription OAuth **or** `ANTHROPIC_API_KEY` | Exact (`total_cost_usd` from CLI) | Default tool allowlist: `Read,Edit,Write,Glob,Grep`; max 25 turns/step. Subscription **session limits are a real failure mode** (killed dogfood run 1) — prefer API-key auth for long runs. |
| `codex` | `codex` (Codex CLI) | ChatGPT subscription OAuth **or** `OPENAI_API_KEY` | Estimated from pricing table (`costEstimated: true`) | `workspace-write` sandbox; `--ephemeral` (no session files). No `--max-turns` equivalent — bounded by `maxSeconds` and prompt scope. |

> **Can claude-code be the judge?** **No — not in P1.** The judge calls an LLM
> through the router (REST API or `openai-compat` shim). There is no
> CLI-backed judge adapter yet. This is friction F-2; first-class CLI-auth
> judge adapters are a P2 target (WP-216). Today, the executor and judge must
> use different mechanisms: CLI adapter for the executor, REST/shim for the
> judge.

### `executor.family`

The adapter's **true structural model family** — used only for invariant #2
enforcement (judge must differ). Must match the adapter's actual lineage:

| Adapter | Correct `family` | Reason |
|---|---|---|
| `claude-code` | `anthropic` | Drives Claude models |
| `codex` | `openai` | Drives GPT models |

Do not set `openai-compat` here. That label is for the `openai-compat` router
transport seam, not for CLI-executor adapters.

---

## `judge` block (required)

```yaml
judge:
  family: openai-compat      # must differ from executor.family
  cadence: 2                 # judge every N steps (default 3)
  max_cost_share: 0.5        # warn when judge spend > this fraction of run cost
  # model: gemini-3.1-pro-preview  # optional override; defaults from routing.stages.judge
  # scoring_method: pointwise      # default; pairwise is P2
  # allow_same_family: true        # bypass invariant #2 (loud warning on every pass)
```

### `judge.family`

Which LLM family the judge calls through the router. **Must differ from
`executor.family`** (invariant #2: same-family judge shares the executor's
blind spots, negating bias mitigation). Options:

| Value | How judge gets its LLM | Env var required | Notes |
|---|---|---|---|
| `anthropic` | Router → Anthropic REST API | `ANTHROPIC_API_KEY` | Use when executor is `codex` or (future) a Gemini adapter |
| `openai` | Router → OpenAI REST API | `OPENAI_API_KEY` | Use when executor is `claude-code` or a Gemini adapter |
| `gemini` | Router → Google Gemini REST API | `GEMINI_API_KEY` | Use when executor is `claude-code` or `codex` |
| `openai-compat` | Router → any `POST $OPENAI_COMPAT_BASE_URL/v1/chat/completions` | `OPENAI_COMPAT_BASE_URL` | **Zero-secrets path**: point at `scripts/cli-judge-proxy.mjs` which backs to `codex` or `gemini` CLI. `openai-compat` is treated as a distinct family from `anthropic`, `openai`, and `gemini` — invariant #2 passes by label, but real diversity comes from the shim's backend (pick a backend from a different family than the executor). |

**Valid executor → judge combinations:**

| `executor.adapter` | `executor.family` | Valid `judge.family` |
|---|---|---|
| `claude-code` | `anthropic` | `openai`, `gemini`, `openai-compat` |
| `codex` | `openai` | `anthropic`, `gemini`, `openai-compat` |

Invalid: `judge.family` equals `executor.family` → `TaskSpecValidationError` (unless `allow_same_family: true`).

> **`openai-compat` as judge family with a Gemini shim backend + codex executor**: technically valid by label (`openai-compat` ≠ `openai`). But if you back the shim with `codex` (same OpenAI family as the executor), the invariant passes on paper while the real model diversity is gone. Use a Gemini backend when the executor is codex, and vice versa.

### `judge.cadence`

Judge fires every N completed steps (default `3`). Trade-offs:

| Cadence | Good for | Risk |
|---|---|---|
| `1` | Short runs where every step must be gated | Expensive; HALT guard counts verdicts, so criterion can flip at step 3 |
| `2` | 1–3-step WP slices (dogfood default) | First verdict early; can seal SUCCESS immediately after step 2 |
| `3` | Longer runs (default) | Balances cost vs drift window; HALT fires at step 9 for a stuck criterion |

HALT fires at `cadence × 3` steps for a criterion that never passes.

### `judge.max_cost_share`

Float `(0, 1]`. Warns (does not halt) when judge cumulative cost exceeds this
fraction of total run cost. Default: no limit. `0.5` = warn if judge uses more
than half the budget.

### `judge.model`

Optional override; defaults to `routing.stages.judge.model`. Only needed to
break the model-routing coupling without touching the routing block.

### `judge.allow_same_family`

Boolean, default `false`. Set `true` only in tests or when no diverse-family
judge is available. Every judge pass emits a loud console warning.

---

## `routing` block (optional)

Omit `routing` entirely if you have API keys for both families — `defaultPolicy(executor.family)`
auto-selects:

| Executor family | Default code model | Default judge model |
|---|---|---|
| `anthropic` | `claude-fable-5` | `gemini-2.5-pro` |
| `openai` | `gpt-5.2` | `claude-fable-5` |
| `gemini` | `gemini-2.5-pro` | `claude-fable-5` |

When you need explicit routing (zero-secrets shim or non-default models):

```yaml
routing:
  stages:
    plan:   { provider: <provider>, model: <model-id> }
    code:   { provider: <provider>, model: <model-id> }
    review: { provider: <provider>, model: <model-id> }
    judge:  { provider: <provider>, model: <model-id> }
  failover:
    judge:
      - { provider: <provider>, model: <model-id> }   # tried in order if primary fails
```

### `routing.stages.<stage>.provider`

| Value | Adapter used | Env var required |
|---|---|---|
| `anthropic` | Anthropic REST | `ANTHROPIC_API_KEY` |
| `openai` | OpenAI REST | `OPENAI_API_KEY` |
| `gemini` | Gemini REST | `GEMINI_API_KEY` |
| `openai-compat` | Any OpenAI-compat server | `OPENAI_COMPAT_BASE_URL` |

**Validation**: every provider appearing in `routing.stages` or `routing.failover`
must have its env var set at parse time — validation fails immediately naming
the missing variable. This applies even to `plan`/`code`/`review` stages that
CLI executors never route through the router.

**Zero-secrets workaround (F-1)**: with the `openai-compat` shim, label all
stages `openai-compat` to avoid needing a real API key for stages the executor
skips. This is a known wart; P2 will validate only router-called stages.

### `routing.stages.<stage>.model`

The model id string passed to the provider. For `openai-compat` the string is
forwarded verbatim to the shim's backend CLI as `-m <model>`, so use a model
id the backend CLI accepts.

**Known-priced models** (pricing table in `packages/sdk-ts/src/pricing.ts`):

| Provider | Model id | Tier |
|---|---|---|
| `anthropic` | `claude-fable-5` | heavy |
| `anthropic` | `claude-opus-4-8` | heavy |
| `anthropic` | `claude-sonnet-4-6` | medium |
| `anthropic` | `claude-haiku-4-5` / `claude-haiku-4-5-20251001` | light |
| `openai` | `gpt-5.2` | heavy |
| `openai` | `gpt-5.2-mini` | light |
| `gemini` | `gemini-2.5-pro` | heavy |
| `gemini` | `gemini-2.5-flash` | light |
| `openai-compat` | any string | unknown → `$0` (use `RouterOptions.pricing` to override) |

> For `openai-compat` executor stages: `code.model` is what gets passed as
> `-m` to the executor CLI (codex or other). `gpt-5.5` works for codex
> (subscription tier model); use whatever model id the CLI accepts. For the
> judge stage with a Gemini shim backend: `gemini-3.1-pro-preview` (not
> `gemini-3.1-pro` — that model id returned `ModelNotFoundError` in
> dogfood-001; the `-preview` suffix is required).

### Stage semantics by executor type

| Stage | CLI executor (claude-code / codex) | Router-based executor (future) |
|---|---|---|
| `plan` | **Unused** — CLI adapter writes code directly | Router calls plan model |
| `code` | `model` fed as `-m` flag to the CLI | Router calls code model |
| `review` | **Unused** | Router calls review model |
| `judge` | **Always router-called** — judge is never a CLI in P1 | Same |

### Resolved endpoint capabilities

At parse/run start, Chikory resolves the configured stages into endpoint
capability descriptors. This is the model used by validation, journaling, and
trace output.

| Config surface | Effective capability source |
|---|---|
| `routing.stages.plan` | Provider descriptor for `plan` plus any `failover.plan` providers |
| `routing.stages.code` with `executor.adapter: claude-code` or `codex` | Executor descriptor for the CLI adapter; `routing.stages.code.model` still feeds the CLI `-m`/model flag |
| `routing.stages.code` with `executor.adapter: native` | Native executor descriptor; inner turns delegate to the router |
| `routing.stages.review` | Provider descriptor for `review` plus any `failover.review` providers |
| `routing.stages.judge` | Provider descriptor for `judge` plus any `failover.judge` providers |

Descriptors record auth mode, token-limit semantics, cost linkage, and
structural model family. Known CLI adapters resolve to their true family
(`claude-code` → `anthropic`, `codex` → `openai`), so validation rejects
same-family judge/executor pairings even if stale YAML labels claim otherwise.

Run journals include one `capability` entry at start. `chikory trace` renders it
as an `endpoints plan ... · code ... · review ... · judge ...` summary when
present; older journals without the entry keep the previous trace shape.

## `bounded_work_unit` block (optional)

Opt-in durable-loop pacing for a single `chikory run`. Absent = default
one-shot behavior. With only `min_durable_steps`, the WP-269 path is unchanged:
the loop defers premature completion and re-enters with the normal forced
increment directive until the floor is met and the judge confirms the criteria.

```yaml
bounded_work_unit:
  min_durable_steps: 3
  directive: Continue one bounded increment before claiming done.
  work_chunks:
    - name: parser
      directive: Implement only the parser increment.
    - name: cli
      directive: Wire only the CLI increment.
    - name: regression-test
      directive: Add only the focused regression test.
```

| Field | Required | Notes |
|---|---|---|
| `min_durable_steps` | yes | Minimum sealed checkpoints before SUCCESS is allowed |
| `directive` | no | Floor-only forced-step directive; ignored when the next `work_chunks` entry exists |
| `work_chunks` | no | Ordered list of named per-step directives; absent or empty preserves the WP-269 floor-only path |

Each chunk is handed out once, in order. Completion is not allowed while any
configured chunk remains unconsumed, even if the executor claims completion
early and the judge confirms the current diff. No `StepRecord`, `JournalEntry`,
or `Checkpoint` shape changes are made for chunking.

---

## `horizon` block (optional — WP-310 pacing governor)

Wall-clock pace budgeting for the limit-pacing governor. Plain terms: tells
the run how long its work is allowed to take, so quota throttling never slows
it past its own deadline. Absent = no deadline pressure — the governor only
prevents mid-window quota exhaustion (rolling-5h / weekly subscription
windows) and otherwise permits full-headroom spend.

```yaml
horizon:
  deadline: "2026-07-20T00:00:00Z"    # ISO-8601 finish-by target
  expected_duration_ms: 432000000     # optional coarse operator estimate
```

| Field | Required | Notes |
|---|---|---|
| `deadline` | no | ISO-8601 datetime; sets the required pace floor — the governor never throttles the run below the pace this deadline demands (`paceConflict` is journaled loudly when deadline > quota) |
| `expected_duration_ms` | no | Coarse estimate; refines the required pace before step history exists |

Related host-side test seams (never in the YAML, the `CHIKORY_PARK_*`
convention): `CHIKORY_QUOTA_WINDOWS` (JSON `[{window, durationMs,
capacityTokens}]`) replaces the endpoint's declared quota windows with
compressed ones of known capacity, so weekly-window throttle/predict-limit are
provable inside one run; `CHIKORY_QUOTA_STATE` forces a complete burn state
into `readQuotaState` for integration tests.

---

## P2-reserved blocks (parse but do nothing yet)

```yaml
pacing:
  mode: auto     # WP-207 — automatic cadence tuning

notifications:
  on: [escalate, milestone]
  slack_webhook_env: CHIKORY_SLACK_URL   # WP-208
```

---

## Complete example — zero-secrets (codex executor, Gemini shim judge)

```yaml
name: wp-201-python-contracts-parity
goal: >
  Port the frozen Chikory core contracts to the Python SDK (WP-201, first
  slice). Rewrite packages/sdk-py/src/chikory/types.py so its pydantic models
  mirror docs/spec/CONTRACTS.md §1–7 exactly as frozen in
  packages/sdk-ts/src/types.ts. Field names stay camelCase on the wire
  (use alias generators). Add packages/sdk-py/tests/test_contracts.py
  that round-trips every fixture in fixtures/contracts/ (valid parse + round-
  trip; invalid raises ValidationError). Keep imports, ruff, pyright green.
  No new dependencies. AGENTS.md conventions: Python 3.11+, fully
  type-annotated, async-first, ruff-clean.

repos:
  - url: /Users/you/repos/chikory
    writable: true

acceptance_criteria:
  - id: AC-1
    description: contract fixture round-trip tests pass
    check: cd packages/sdk-py && uv sync --quiet && uv run pytest tests/ -q
  - id: AC-2
    description: pyright is clean
    check: cd packages/sdk-py && uv run pyright
  - id: AC-3
    description: ruff lint and format are clean
    check: ruff check packages/sdk-py && ruff format --check packages/sdk-py

budget_usd: 5
max_steps: 8

executor:
  adapter: codex          # codex CLI on ChatGPT OAuth or OPENAI_API_KEY
  family: openai

judge:
  family: openai-compat   # shim → gemini CLI (different family from openai executor)
  cadence: 2
  max_cost_share: 0.5

# Zero-secrets routing block. Launch shim first:
#   node scripts/cli-judge-proxy.mjs 8787 gemini &
#   OPENAI_COMPAT_BASE_URL=http://127.0.0.1:8787 pnpm chikory run <spec.yaml> --watch
routing:
  stages:
    plan:   { provider: openai-compat, model: gpt-5.5 }            # unused by codex
    code:   { provider: openai-compat, model: gpt-5.5 }            # → codex -m gpt-5.5
    review: { provider: openai-compat, model: gpt-5.5 }            # unused by codex
    judge:  { provider: openai-compat, model: gemini-3.1-pro-preview }  # → shim → gemini CLI
```

## Complete example — multi-repo workspace

```yaml
name: wp-214-two-service-change
goal: >
  Update the API and worker together. In service-api, add the new health payload
  shape. In service-worker, consume that payload without changing the public
  queue contract. Use reference-docs only for context. Keep both writable repos'
  test suites green.

repos:
  - url: /Users/you/repos/service-api
    writable: true
  - url: /Users/you/repos/service-worker
    writable: true
  - url: /Users/you/repos/reference-docs
    ref: main
    writable: false

acceptance_criteria:
  - id: AC-1
    description: API tests pass
    repo: service-api
    check: pnpm test
  - id: AC-2
    description: worker tests pass
    repo: service-worker
    check: pnpm test
  - id: AC-3
    description: cross-repo handoff file exists in the worker checkout
    repo: service-worker
    check: test -f src/health-consumer.ts
  - id: AC-4
    description: root-level workspace still contains both writable repos
    check: test -d service-api && test -d service-worker

budget_usd: 10
max_steps: 8

executor:
  adapter: codex
  family: openai

judge:
  family: openai-compat
  cadence: 2

routing:
  stages:
    plan:   { provider: openai-compat, model: gpt-5.5 }
    code:   { provider: openai-compat, model: gpt-5.5 }
    review: { provider: openai-compat, model: gpt-5.5 }
    judge:  { provider: openai-compat, model: gemini-3.1-pro-preview }
```

## Complete example — API keys (claude-code executor, Gemini REST judge)

```yaml
name: wp-201-python-contracts-parity
goal: >
  ...same goal text...

repos:
  - url: /Users/you/repos/chikory
    writable: true

acceptance_criteria:
  - id: AC-1
    description: contract fixture round-trip tests pass
    check: cd packages/sdk-py && uv sync --quiet && uv run pytest tests/ -q
  - id: AC-2
    description: pyright is clean
    check: cd packages/sdk-py && uv run pyright

budget_usd: 10
max_steps: 8

executor:
  adapter: claude-code    # claude CLI on Anthropic subscription OAuth or ANTHROPIC_API_KEY
  family: anthropic

judge:
  family: gemini          # Gemini REST API (GEMINI_API_KEY)
  cadence: 2

# routing: omit entirely — defaultPolicy(anthropic) auto-picks gemini judge
# export ANTHROPIC_API_KEY=… GEMINI_API_KEY=…
```
