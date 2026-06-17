# Dogfooding guide — running plan.md work packages through Chikory

This is the complete operating manual for executing Phase 2+ work packages
(`plan.md` §6+) **through Chikory itself**: how to set up, how to write the
task spec for a WP (every field explained), how to launch, supervise, and
recover a run, and how to land the result as a normal PR.

Proven path: dogfood-001 (`docs/reports/dogfood-001.md`) implemented WP-202's
first slice this way — 2 steps, 1 judge pass, 3/3 judge-executed checks,
SUCCESS in 4 minutes. Dogfood-002 (`docs/reports/dogfood-002.md`) repeated it
for WP-201 slice 1 — first-attempt SUCCESS, zero new harness code.
Dogfood-003 (`docs/reports/dogfood-003.md`) had the engine modify its own
runner loop (WP-217) — third first-attempt SUCCESS, and the landed trigger
fired in the run that delivered it. Dogfood-004
(`docs/reports/dogfood-004.md`) landed WP-218 slice 1 (honest cost meter) —
fourth first-attempt SUCCESS, the first spec designed to *falsify* the old
behavior (cadence > max_steps, so only the WP-217 milestone trigger could
seal), and the delivered warning now flags that very run's trace.
Dogfood-005 (`docs/reports/dogfood-005.md`) delivered WP-220
(`chikory land`) — fifth first-attempt SUCCESS, the first fully *priced*
campaign ($2.14/$5.00 metered by the WP-218 table), and the deliverable
was verified by landing its own run into a clean clone. Dogfood-006
(`docs/reports/dogfood-006.md`) delivered WP-222 slice 1 (executor env
scrub) — sixth first-attempt SUCCESS, the first campaign with **no new
friction numbers**, and the bug being fixed fired inside the run's own
executor steps exactly as the spec predicted. Dogfood-007
(`docs/reports/dogfood-007.md`) delivered WP-223 (watch renders journal
transitions) — seventh first-attempt SUCCESS, closing F-15 by construction
(three clean full-suite runs post-fix) and confirming F-14 closure (zero
shim noise in the executor transcript, the acceptance test dogfood-006
set). Dogfood-008 (`docs/reports/dogfood-008.md`) delivered WP-224
(`chikory land --verify` + git-stderr capture) — eighth first-attempt
SUCCESS, the **second campaign with no new friction**, closing F-17 (land
never verified) and F-18 (git stderr leak): `land --verify` now reruns
build/lint/typecheck/test against the fresh commit and exits nonzero on
red. F-11's completion-probe tax recurred at a new record 25.4 % cost
share (cheap productive step → proportionally larger wasted probe).
Dogfood-009 (`docs/reports/dogfood-009.md`) delivered WP-225 (de-flake the
WP-217 milestone test) — ninth first-attempt SUCCESS, the **third campaign
with no new friction**, closing F-19 (the `agent-loop.test.ts` waitFor race
that could spuriously fail a judge-executed check, now gated on the durable
verdict; 8/8 host runs). F-11's probe tax recurred at a new record *low*
5.8 % cost share — the probe step skipped the suite re-run — so the tax now
spans 5.8 %–25.4 % across eight data points; the spread, not the magnitude,
is the WP-221 argument. Dogfood-010 (`docs/reports/dogfood-010.md`)
delivered WP-209 slice 1 (the issues-found:changes-made process metric in
`chikory trace`, SE-3's concrete half) — tenth first-attempt SUCCESS, the
**fourth campaign with no new friction**, hitting the prescribed footer
string byte-for-byte under a tight two-file scope. F-11's probe tax recurred
mid-spread at 16.1 % (the probe re-ran the full suite), confirming the tax
tracks executor discretion across a 5.8 %–25.4 % range over nine data
points. Dogfood-011 (`docs/reports/dogfood-011.md`) delivered WP-209 slice 2
(the components-over-time timeline in `chikory trace`, SE-3's temporal half —
both SE-3 footer halves now render) — eleventh first-attempt SUCCESS, the
**fifth campaign with no new friction**, hitting the prescribed
`components over time: s0 s1 j@1` footer string byte-for-byte under a tight
two-file scope. F-11's probe tax set a new record *high* of 34.3 % (the probe
re-ran the full suite while the productive step 1 was cheap, $0.58), widening
the spread to **5.8 %–34.3 %** over ten data points. Dogfood-012
(`docs/reports/dogfood-012.md`) opened WP-208 with slice 1 (the pure
`notificationsFor` derivation — `JournalEntry[]` + `NotificationPolicy` →
ordered notification messages; delivery + call-site deferred) — twelfth
first-attempt SUCCESS, the **sixth campaign with no new friction**, hitting
the prescribed escalate/milestone/terminal message strings and policy-filter
behavior byte-for-byte under a strict two-NEW-file scope, proving the loop
generalizes past the now-exhausted WP-209 trace-footer vein. F-11's probe tax
recurred at 25.1 % (212k input tokens, full-suite re-run), within the
established 5.8 %–34.3 % spread over eleven data points. Dogfood-013
(`docs/reports/dogfood-013.md`) added WP-208 slice 2 (the pure `slackPayloadFor`
formatter — `Notification` → Slack `{ text }` with a `🚨`/`✅`/`🏁` trigger
prefix; webhook POST + call-site deferred) — thirteenth first-attempt SUCCESS,
the **seventh campaign with no new friction**, hitting the prescribed emoji
lookup and payload strings byte-for-byte under a strict two-NEW-file scope.
F-11's probe tax set a **new record high of 35.1 %** (220k input tokens,
full-suite re-run) — set from below, by the cheapest productive step yet
($0.51), widening the spread to **5.8 %–35.1 %** over twelve data points. Dogfood-014
(`docs/reports/dogfood-014.md`) added the slice-3 pure half (`desktopPayloadFor`
— `Notification` → `{ title, body }`) — fourteenth first-attempt SUCCESS, and
the **first run to modify an existing tracked file** (additive, beside
`slackPayloadFor`) rather than create two new ones. That first surfaced **F-20**:
the harvest tool silently dropped the modified files (non-interactive conflict
skip) while reporting success — root-caused and fixed the same session
(reconciliation guard + `harvest-audit`, which confirmed no past silent losses).
F-11 was a mid-spread 24.1 %. **Then the contract wall fell by hand**: WP-219
ADR-005 was accepted and its slice-1 contracts (`Plan`/chain types +
`claimsComplete`/`budgetTokens`) landed — unblocking the dogfoodable chain
implementation slices. Dogfood-015
(`docs/reports/dogfood-015.md`) delivered that pure half — `readyNodes(plan,
completed)`, the chain executor's dependency-resolution core — the **first
slice to consume the ADR-005 contracts** (its own AC-2 kept the 77-test
conformance suite green inside the run), and the cheapest campaign yet ($0.39).
Its one new friction, **F-21**, is again in the *landing*, not the output: the
harvested NEW files (`src/chain/`) were left untracked and the operator's
commit shipped only the review docs under a "readyNodes" message — a "feat"
commit with none of the feature's code (→ WP-226: harvest stages what it
applies; fixed before the next campaign). Dogfood-016
(`docs/reports/dogfood-016.md`) delivered the other S3 pure precondition,
`hasDependencyCycle(plan)`, with the prescribed Kahn traversal and four focused
tests — sixteenth first-attempt SUCCESS. It also proved WP-226 live: both new
files were harvested byte-identically and staged. Three surrounding issues
surfaced: parallel Devbox startup races (F-22, operational rule added), the
terminal-boundary remainder of the F-15 observer race (F-23 → WP-227), and the
env-prefixed explicit `dogfood-verify` command aborting Vitest under Devbox
0.17.0 (F-24, command form fixed). F-11 was 7.6 %. Dogfood-017
(`docs/reports/dogfood-017.md`) was the **first FAILED campaign — and the
clearest thesis win**: WP-227 had already been hand-landed (`26b9964`) so the
spec ran redundantly, the executor narrated completion over an empty diff, every
acceptance check and rubric item passed, and the structurally-different judge
still ESCALATEd on the diff-vs-claim mismatch. It surfaced F-25 (retire
superseded specs; launch baseline-satisfied precheck → WP-228), F-26 (executor
empty-diff completion claim → raises WP-221), and F-27 (the `--watch` ESCALATE
line drops the judge reasoning → WP-229). Dogfood-018
(`docs/reports/dogfood-018.md`) delivered WP-229 cleanly — `followRun` now
renders `judge escalated: <reason>` on the watch stream before the
AWAITING_APPROVAL line; diff byte-for-byte to spec, 3/3 AC + 4/4 rubric PROCEED,
harvested byte-identically. **F-27 closed.** It surfaced F-28 (specs
over-prescribed to the keystroke under-test the thesis — see §3) and F-11
recurred at 34.8 % of run cost (top of the range). Dogfood-019
(`docs/reports/dogfood-019.md`) delivered WP-221's pure trigger half —
`isCompletionMilestone(record)` ORs `claimsComplete` into the WP-217 empty-diff
trigger, behavior preserved — its eighteenth first-attempt SUCCESS. **But human
review caught F-29**: the new test's fixtures violate the `ArtifactRef` contract
(7 real `TS2353` errors) yet shipped green, because `typecheck` compiles only
`src/**` and Vitest skips type-checking. A SUCCESS run again surfaced a
plan-changing gap (dogfood-002's lesson). Dogfood-020
(`docs/reports/dogfood-020.md`) delivered WP-230 — `typecheck` now runs a second
`tsc -p tsconfig.test.json` pass so `test/**` is type-checked, verified to trip
on a bad fixture (`TS2353`). **F-29 closed.** It surfaced **F-30** (the same
spec was launched twice ~11 min apart, ~$1 wasted — operator ceremony, no WP).
Dogfood-021 (`docs/reports/dogfood-021.md`) delivered **WP-221 Slice B** — the
runner now reads the executor's `CHIKORY_TASK_COMPLETE` marker via pure
`claimsCompleteFromSummary` → `StepRecord.claimsComplete`, so the productive step
is judged directly and the F-11 probe step retires. Dogfood-022
(`docs/reports/dogfood-022.md`) delivered **WP-219 S2 Slice 1** — the pure
goal-planner prompt half (`planner/prompt.ts`, mirroring `judge/prompt.ts`) — but
its headline is in the trace: as the **first real run on post-Slice-B code where
the executor emits the marker**, it sealed SUCCESS in **ONE step with no
empty-diff probe step** (`components over time: s0 j@0`, vs the `s0 s1 j@1` F-11
signature of all twenty predecessors). **F-11 is CLOSED — by observation, not
just in code.** Twenty-first first-attempt SUCCESS, no new friction, single clean
launch (F-30 did not recur). The one watch-item: the productive step cost $1.26
on **969k input tokens** (campaign high) — with the probe gone, input-side cost
(WP-203 compaction / WP-207 pacing) is the next reliability lever. Dogfood-023
(`docs/reports/dogfood-023.md`) delivered **WP-219 S2 Slice 2 — the pure
plan-assembly half** (`planner/assemble.ts` `buildPlan(reply, input, opts): Plan`
+ `BuildPlanOptions`, mirroring `buildVerdict`: three structural checks →
the frozen `Plan`), completing S2's pure surface. Twenty-second first-attempt
SUCCESS, the F-11-closed `s0 j@0` shape held for a second straight run, no new
friction, single clean launch. Bright spot on the cost watch-item: input tokens
fell to **451k** (lowest of the last four runs, ~half the 969k high) for a
comparably small change — the 022 "climbing tokens" worry is **noise, not a
ratchet**. Dogfood-024 (`docs/reports/dogfood-024.md`) delivered **WP-219 S2b —
the pure plan meta-judge prompt half** (`planner/meta-judge-prompt.ts`:
`PLAN_JUDGE_SYSTEM_PROMPT` + `PLAN_VERDICT_RESPONSE_SCHEMA` +
`buildPlanJudgeMessages`, mirroring `judge/prompt.ts`); dogfood-025
(`docs/reports/dogfood-025.md`) delivered **its pure verdict-assembly half**
(`planner/meta-judge-verdict.ts`: `buildPlanVerdict`, mirroring `buildVerdict`,
folding `planCoverageGaps` in as a deterministic coverage override that
downgrades `PROCEED`→`REVISE` when a goal criterion is uncovered). **WP-219's
entire pure surface is now landed** — both the S2 planner and the S2b plan
meta-judge mirror the executor judge symbol-for-symbol; everything left in
WP-219 is non-pure / hand-design (the `decompose` wrapper + plan-judge harness,
TASK-PROTOCOL §4). Dogfood-026 (`docs/reports/dogfood-026.md`) then delivered **WP-203 S4 — the
pure compaction-trace renderer** (`formatEntryLine` gains a `case "compaction"`
rendering `tokensBefore→tokensAfter` + digest presence), the WP-209
trace-renderer pattern; **WP-203's pure trace surface is now complete** and the
compaction JIF entry is legible in `chikory trace --watch`. All three runs
sealed SUCCESS in one step, no probe (F-11-closed shape, now five straight); no
new friction. The input-token series ran a clean sawtooth across the six
adjacent pure slices (862k → 969k → 451k → 976k → 467k → 807k), the smallest
diff of the set drawing a mid-high 807k — cost is **noisy, not monotonic**, a
variance/ceiling lever (WP-203/WP-207), not a runaway trend. Dogfood-027
(`docs/reports/dogfood-027.md`) then delivered **WP-228 S1 — the pure
launch-baseline-precheck decision** (`evaluateBaselinePrecheck`, the
`buildVerdict`/`buildPlanVerdict` analog: partitions acceptance-check exit codes
→ `{ satisfied, passedIds, failedIds, summary }`, dogfood-017 F-25), a sixth
straight one-step no-probe SUCCESS, no new friction; input tokens 527k (low
band), the largest diff of the recent set drawing one of the smallest input
counts — cost tracks neither diff size nor run order. The non-pure
check-execution + warn/`--force` launch wiring is the hand-design follow-up.
Dogfood-028 (`docs/reports/dogfood-028.md`) then delivered **WP-202 / CM-3 — the
pure Memory Pointer decision + reference renderer** (`shouldPointerize(bytes,
policy)` + `formatPointerReference(ref)` in a new `src/runner/memory-pointer.ts`,
the `buildVerdict`/`evaluateBaselinePrecheck` analog over the frozen
`ArtifactRef`): a **seventh** straight one-step no-probe SUCCESS, no new
friction; input tokens 410k, a new series low (021–028: 862k → 969k → 451k →
976k → 467k → 807k → 527k → 410k) — cost stays noisy, not monotonic. The
non-pure interception + `store.put` + injection wiring is the hand-design
follow-up. Dogfood-029 (`docs/reports/dogfood-029.md`) then delivered **WP-203 S2
— the pure compaction digest-prompt half** (`DIGEST_SYSTEM_PROMPT` +
`buildDigestMessages(toDigest): Message[]` in a new
`src/runner/compaction-prompt.ts`, the `planner/prompt.ts`/`judge/prompt.ts`
analog over the frozen `CompactionPlan.toDigest` + `Message`, type-only `Message`,
no schema/contract change): an **eighth** straight one-step no-probe SUCCESS, no
new friction; input tokens 462k, low band (021–029: 862k → 969k → 451k → 976k →
467k → 807k → 527k → 410k → 462k) — cost stays noisy, not monotonic. **WP-203's
entire pure surface is now exhausted** (S4 trace + S2 digest-prompt); the digest
wiring (router fold → `store.put` behind a Memory Pointer → journal
`CompactionResult`) stays non-pure hand-design, blocked on the WP-202 store.
Next: with the TS pure surface exhausted, dogfood-030 takes **WP-201 Python-SDK
parity — the pure compaction digest-prompt half** (`DIGEST_SYSTEM_PROMPT` +
`build_digest_messages(to_digest) -> list[Message]` in a new
`packages/sdk-py/src/chikory/compaction_prompt.py`, the Python parity of
dogfood-029; mirrors the TS `compaction-prompt.ts` source-of-truth, `Message`
already ported, no contract change) — dual-SDK parity (vendor-neutral launch
requirement) is the standing dogfoodable thread.

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

Run Devbox commands **sequentially**. Concurrent `devbox run` startup races
on `.devbox/gen/scripts/.cmd.sh` under Devbox 0.17.0 (dogfood-016 F-22).

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
`examples/dogfood/dogfood-<NNN>.yaml`, numbered sequentially and paired 1:1
with its report `docs/reports/dogfood-<NNN>.md` (index + full naming rules:
[`examples/dogfood/README.md`](../examples/dogfood/README.md)). Ready-to-run
examples: [`dogfood-002.yaml`](../examples/dogfood/dogfood-002.yaml) (ran
SUCCESS), [`dogfood-003.yaml`](../examples/dogfood/dogfood-003.yaml) (next
up). Schema
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
- **Specify the *what*, not the *how* (dogfood-018 F-28).** Name files,
  symbol signatures, the behavior, and the tests with their assertions — then
  stop. Do **not** transcribe the literal code body (exact cast text, exact
  variable names, exact one-line expressions). A goal that dictates the change
  keystroke-by-keystroke collapses the executor's job to transcription: the
  run no longer tests agent judgment and the judge can only confirm code the
  human already wrote (dogfood-018 produced a diff byte-for-byte identical to
  its goal; dogfood-017's redundant-spec failure was the same drift taken to
  its limit). Leave a real decision in every spec so the run is genuine thesis
  evidence — autonomy exercised, judge grading something independent.

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
  report $0.00 on the wire, so the gate is inert there; estimated-cost runs
  meter against the pricing table since WP-218. $5–20 fits a 1–3-step WP
  slice — dogfood-005, the first fully priced campaign, metered $2.14 for
  a 2-step, 3-file CLI feature.
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
- Since WP-217 (landed `ef4b16f`), a SUCCESS step with an empty diff
  triggers the judge immediately regardless of cadence — a finished run
  seals without waiting for the boundary. Cadence is now the *backstop*
  for runs that keep producing diffs, not the only path to a verdict.
- Small slice (1–3 steps): `cadence` slightly above the expected step count
  (e.g. 3–4) is enough — completion triggers the seal.
- Longer run: `cadence: 3` (default) balances cost vs drift window. Remember
  the HALT guard counts *verdicts*, so cadence × 3 steps is how long a
  criterion may stay red before the run is killed.
- **Dogfooding new trigger/loop behavior? Make the spec falsifying**
  (dogfood-003 F-12): configure it so the *old* code observably could not
  produce the outcome — e.g. dogfood-003 ran `cadence: 2`, completion landed
  on step 2, and the cadence boundary fired at the same instant, so the live
  run never isolated the feature it shipped. `cadence` > `max_steps` would
  have made the milestone trigger the only possible sealing path.

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
OPENAI_COMPAT_BASE_URL=http://127.0.0.1:8787 pnpm chikory run examples/dogfood/dogfood-003.yaml --watch
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

Land it per TASK-PROTOCOL (one WP = one branch = one PR). Since WP-220
(dogfood-005) this is one command:

```sh
pnpm chikory land <run-id> --verify [--branch wp-201-python-parity] [--repo <dir>]
# → branch + ONE squashed `feat: land <run-id>` commit (body cites run-id,
#   workspace, verification commands), prints branch/sha/forensics line.
# --verify (since WP-224, dogfood-008): reruns devbox build/lint/typecheck/test
#   against the fresh commit, stops on first red, KEEPS the commit, exits 1.
# Requires a clean target tree; fails actionably on missing workspace or empty diff.
```

Since WP-224 (dogfood-008) `land --verify` reruns the four `devbox run
build/lint/typecheck/test` commands against the fresh commit (F-17 closed)
and the `git()` helper now captures + surfaces git stderr instead of
leaking `Switched to a new branch …` lines (F-18 closed). Use `--verify`
as the default landing path; the commit is kept even on a red check so you
can inspect it (`git -C <repo> show <sha>`). Without `--verify`, `land`
still only applies + commits — verify by hand:

```sh
devbox run build && devbox run lint && devbox run typecheck && devbox run test
```

Also per TASK-PROTOCOL §7: keep the journal as an artifact (don't delete
`.chikory/runs/<run-id>` — `journal.db` + `artifacts/` are the audit trail),
and write observed friction into `docs/reports/` — dogfood reports drive
reprioritization at phase boundaries.

**Keep the harvest commit pure** (dogfood-003 F-13): the commit citing the
run-id must contain the run's diff and nothing else — `git show <landed>`
should equal the run's diff artifact. Hand-written tooling, docs, or specs
go in separate commits. `ef4b16f` broke this (harvest script + devbox task
rode along with WP-217's delivery) and `2a4dd21` repeated it (WP-218's
diff + the dogfood-004 review docs in one commit); `chikory land`
(dogfood-005) makes the pure commit mechanical — use it.

### 6.1 Post-run review — mandatory, and scripted

Every terminal run gets the full review: independent re-verification of the
delivery, anomaly hunt, numbered report (`docs/reports/dogfood-<NNN>.md`,
friction ids global across reports), plan/REQUIREMENTS/DOGFOODING updates,
and the next spec readied. The whole procedure is encoded as a Claude Code
skill — run `/dogfood-review <run-id>` from the repo root
([`.claude/skills/dogfood-review/SKILL.md`](../.claude/skills/dogfood-review/SKILL.md)).
The mechanical half (trace, per-step evidence, acceptance-check re-runs,
harvest byte-diff, cost-share + the F-11 probe %) is scripted —
`RUN_ID=<run-id> devbox run dogfood-verify` emits a single evidence block;
the checks are read from the run's own journal so they always match the run.
The script writes nothing — judgment (diff-vs-goal, anomaly hunt, report,
doc updates) stays human. A SUCCESS run still gets reviewed: dogfood-002 was
a first-attempt SUCCESS and produced three plan-changing findings
(F-8…F-10 → WP-217…WP-220).

## 7. Troubleshooting

| Symptom | Cause → fix |
|---|---|
| `Invalid task spec: provider 'x' … missing env var Y` | Parse-time key validation. Export the key, or use the §3.8 routing workaround for keyless CLI runs. |
| `Is the Temporal dev server up?` | It isn't. `devbox run temporal-dev`. |
| Steps fail instantly, `executor exited with code 1` | Read the failure: `pnpm chikory trace <run-id> --step 1`. Check the executor binary works headless in your env (`codex exec`/`claude -p` smoke test). |
| Steps fail with a session/usage-limit message | Subscription executor ran dry (dogfood run 1). Reject the escalation, switch `executor` to the other CLI (or API-key auth), relaunch. |
| Judge checks time out | 120 s/check cap. Bare `pnpm` not `devbox run` (§3.4); split slow suites into a focused test file per criterion. |
| Judge verdict is ESCALATE with `judge raised concerns` | The rubric/concerns fired (e.g. scope creep, deleted tests). `trace --step <n>` shows the full form; approve or reject deliberately. |
| CLI behaves like yesterday’s code (e.g. a just-harvested trace feature missing from `chikory trace`) | Stale `dist/`. `devbox run build`. `harvest.sh` now rebuilds before verification (dogfood-004 F-16); the dogfood script builds *pre-run*, so post-harvest forensics always need the rebuild. |
| `chikory land` succeeded but the landed feature is invisible / verification not run | Pass `--verify` (since WP-224, dogfood-008): it reruns `devbox run build/lint/typecheck/test` against the fresh commit and exits 1 on the first red check (commit kept for inspection). Bare `land` (no flag) still only applies + commits — run the four commands by hand. The stray `Switched to a new branch …` lines are gone (F-18 fixed): git stderr is now captured and only surfaced inside `land failed: …` on real errors. |
| `pnpm chikory: command not found` | Bin link lost: `rm node_modules/.pnpm-workspace-state-v1.json && devbox run -- pnpm install`. |
| Parallel `devbox run` commands fail with `.devbox/gen/scripts/.cmd.sh: No such file or directory` | Devbox 0.17.0 concurrent-startup race (dogfood-016 **F-22**). Run every Devbox command sequentially; do not parallelize test/typecheck/lint invocations. |
| `dogfood-verify` shows Vitest `undefined` failures although the same tests pass directly | Do not prefix `devbox run` with an env assignment under Devbox 0.17.0 (dogfood-016 **F-24**). For an explicit run use `devbox run -- bash scripts/dogfood-verify.sh <run-id>`; for the newest run use `devbox run dogfood-verify`. |
| Proxy run dies with router FAILED on judge pass | Shim not running / wrong port — restart `cli-judge-proxy.mjs` and check `OPENAI_COMPAT_BASE_URL`. |
| `[cli-judge:…] FAILED … 404/500` *during executor steps* | Not the judge: the executor inherited `OPENAI_COMPAT_BASE_URL` and its in-workspace test run un-skipped `providers.integration.test.ts`, which pings the live shim (dogfood-004 F-14; recurred dogfood-005/006). **Fixed by WP-222 slice 1** (dogfood-006, landed `18fae43`): executor children now see only their own family key. **Closure confirmed by dogfood-007** — zero shim noise in `run-22b337a9`'s executor transcript. Seeing this symptom now is a regression — file it. |
| A `feat:` commit's diff is only docs — the harvested CODE (new files) is missing | The untracked-new-file commit gap (dogfood-015 **F-21**). **Fixed by WP-226**: harvest now stages every applied file after reconciliation. Dogfood-016 proved the path with both new files staged. |
| `devbox run harvest` says `Successfully applied changes` but the feature is missing / files unchanged | The pre-fix modified-file blind spot (dogfood-014 **F-20**): the old harvest skipped a file whose host version *differed* from the run's final version, which is exactly the normal case for an edit-in-place. **Fixed** (commit `0c20694`): harvest now applies the workspace's final version by intent and a **reconciliation pass** hard-errors (exit 1) on any unapplied change — it can no longer report success having applied nothing. To check past runs for silent drops: `devbox run harvest-audit` (every run's final file content vs git history). Reminder: `devbox run harvest` defaults to the **newest** run (devbox doesn't forward args) — for a specific run use `devbox run -- bash scripts/harvest.sh <run-id>`. |
| A full-suite run fails because `cli.test.ts` misses `AWAITING_APPROVAL` immediately before terminal FAILED | F-15's terminal-boundary remainder (dogfood-016 **F-23**, → WP-227): `followRun` can append a transition after its journal scan and then return terminal status without a final drain. Focused reruns may pass. Dogfood-017 adds the final drain and deterministic regression test. |
| A full-suite or AC run fails on `agent-loop.test.ts > incomplete empty-diff verdict keeps RUNNING…` with `expected undefined to deeply equal { kind: 'PROCEED', … }` | Pre-existing test-harness race (dogfood-007 F-19, fix WP-225): the test's `waitFor` gates on the judge-wire hit count, not on the verdict being journaled, so `lastVerdict` can still be `undefined` at assert time (flapped 2/13 host invocations). Re-run the file in isolation; unrelated to any CLI diff. One-line fix: gate the predicate on `report.lastVerdict !== undefined`. |
| A run produces a ~empty diff, the executor still claims SUCCESS, and the judge ESCALATEs "diff missing the required changes" | The spec was **redundant — its WP already landed by another path** before launch (dogfood-017 **F-25**: WP-227 hand-landed `26b9964` four hours before the spec ran). The executor had no work and narrated the spec as done over an empty diff (F-26); the judge correctly caught the mismatch. **Operating rule: retire/supersede a dogfood spec the moment its WP lands by any other path** — check `git log`/HEAD before launching. WP-228 adds a launch-time precheck that runs the acceptance checks against the clean baseline and warns if they already pass; its pure decision half is landed (`evaluateBaselinePrecheck`, `src/cli/precheck.ts`, dogfood-027 `run-f97a0e63`), the non-pure check-execution + warn/`--force` launch wiring is the hand-design follow-up — until it lands, the manual `git log`/HEAD check before launch is still the guard. |
| `devbox run dogfood` ends with `exit status 1` / `[ELIFECYCLE] Command failed` after you reject an escalation | Not a crash. A deliberate `chikory approve … --reject` seals the run **FAILED**, so `chikory run --watch` exits non-zero and devbox propagates it, then cleanly tears down the judge-proxy and Temporal (dogfood-017). A failed run *should* exit non-zero; the worktree stays clean. Distinguish from a real crash by the `terminal FAILED — judge escalation rejected: …` line above the teardown. |
| Two `.chikory/runs/` dirs for the same spec, both SUCCESS, both byte-identical to the working tree | You launched the spec twice (dogfood-020 **F-30**: `run-f24af22c` and `run-3575ba23`, ~11 min apart, ~$1 of duplicate spend). `chikory run` does not guard against a second launch of a spec whose prior run already delivered (and WP-228's baseline precheck won't catch it — neither run is committed to HEAD, so each clones a baseline that legitimately fails the checks). **Discipline: launch once, watch to terminal, then `/dogfood-review`.** Review the newest run; the older duplicate is harmless audit noise — keep it. |
| A run's tests pass and `typecheck` is clean, but a test fixture has the wrong shape for a real type | **Fixed by WP-230** (dogfood-020): `typecheck` now type-checks `test/**` via a second `tsc -p tsconfig.test.json` pass, so a wrong-shaped fixture fails the gate. If you still suspect a gap, the manual check below still works. The original gap (dogfood-019 **F-29**): The `typecheck` AC (`tsc --noEmit`) compiles only `src/**` (`tsconfig.json` `include`), and Vitest transpiles tests via esbuild **without** type-checking — so type errors *in test code* are invisible to every dogfood signal (dogfood-019 **F-29**: `judge-trigger.test.ts` built `ArtifactRef` fixtures as `{uri,sha256,bytes}` vs the real `{id,kind,bytes,summary}` — 7 `TS2353` errors, all green). To check a suspect test: add it to a temp tsconfig that `extends ./tsconfig.json`, sets `compilerOptions.rootDir: "."`, and includes both `src/**/*` and the test file, then `pnpm --filter @chikory/sdk exec tsc --noEmit -p <that-config>`. **WP-230** makes a test-inclusive typecheck a standing AC. |
| Live `--watch` shows `verdict ⚠ ESCALATE` and `run is AWAITING_APPROVAL` but no reason | **Fixed by WP-229** (dogfood-018, `run-59115f35`): `followRun` now prints `judge escalated: <reason>` immediately before the AWAITING_APPROVAL line whenever the ESCALATE verdict carries a non-empty `escalateReason`. If you still see no reason, the verdict had an empty `escalateReason` (the line is suppressed by design) — fall back to `pnpm chikory trace <run-id> --step <n>` for the full judge form, or read the `verdict` entry in `.chikory/runs/<run-id>/journal.db`. |

## 8. Known P1 limitations (so you don't fight them)

- **No planner**: every step gets the full `goal` as its instruction, plus
  the last 5 step summaries, judge feedback, and acceptance criteria. Scope
  goals accordingly (§3.2).
- **Single repo**, no `inject`, no `branch`, no suspend-for-days HITL UX, no
  pacing — all P2 (WP-214, -212, -205, -206, -207).
- **Subscription-auth runs can report $0.00 cost** → rely on `max_steps`
  and the HALT guard when the meter is blind. WP-218 slice 1 (dogfood-004)
  prices the documented zero-secrets path (`gpt-5.5`,
  `gemini-3.1-pro-preview`, …) and makes blindness loud: `chikory trace`
  flags `UNPRICED` steps and appends `⚠ cost meter blind (unpriced
  tokens)` to the run header whenever `costEstimated` ∧ cost=$0 ∧
  tokens>0. Token-denominated budgets (`budget_tokens`) remain — the
  contracts slice of WP-218.
- **Completion no longer costs a probe step (F-11 CLOSED, dogfood-022)** —
  historically WP-217 (landed `ef4b16f`) fired the judge on an empty-diff
  SUCCESS, but the executor first had to *spend* one empty-diff step
  rediscovering "nothing to do" (the F-11 tax, **5.8 %–35.1 %** across twenty
  priced campaigns dogfood-002…021). WP-221 closes it: the executor ends its
  productive step's summary with `CHIKORY_TASK_COMPLETE`, the runner reads it
  (pure `claimsCompleteFromSummary` → `StepRecord.claimsComplete`), and
  `isCompletionMilestone` fires the judge off-cadence **on the productive step
  itself**. Confirmed live by dogfood-022 (`run-499218ef`): the first
  marker-emitting run sealed SUCCESS in one step, `components over time: s0 j@0`,
  no probe. So a well-scoped goal that the executor finishes in one productive
  step now seals in one step — no trailing no-op.
- Executor tool sandboxes are real but different: claude-code is
  file-ops-only (can't run tests itself — the judge does), codex has
  workspace-write (can run tests). Both are fine: SUCCESS is judge-verified
  either way.
