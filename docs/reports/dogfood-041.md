# Dogfood-041 — WP-219 S3 "first chain dogfood": DELIVERY SUCCESS, but the chain path was NOT exercised (F-32: launched with `chikory run`, not `chikory chain`)

**WP**: WP-219 (Goal decomposition & run chaining, ADR-005 §S3) · **Date**: 2026-06-20 · **Task spec**: [`examples/dogfood/dogfood-041.yaml`](../../examples/dogfood/dogfood-041.yaml) · **Run**: `run-a28655c9-3e5e-456a-bd90-becfdeddff2a` · **Outcome**: **SUCCESS** (judge PROCEED 3/3) — *as a single run* · **Landed**: harvested byte-`IDENTICAL`, staged + uncommitted on the working tree (pending the user's review)

> ⚠️ **The deliverable shipped; the dogfood's purpose did not.** dogfood-041 was
> written and queued as **THE FIRST CHAIN DOGFOOD** — the deliberate break from
> the 39-run pure-leaf streak, meant to launch with the new `chikory chain` verb
> so a goal *decomposes into a multi-node Plan*, gets *gated by the
> different-family plan meta-judge*, and *each node runs as its own judge-gated
> child run* through the durable `chainLoop` Temporal workflow. **None of that
> happened.** The run is a plain single `run-…` journal: **1 step**, executor
> codex drove the *entire* goal directly, no `.chikory/chains/` directory exists,
> and no `…-node-…` child runs were created. The step's `plan item` is the goal
> string **verbatim** — there was no planner, no plan meta-judge, no fold. It was
> launched with `chikory run`, not `chikory chain`. The thesis pillar this run
> existed to test (durable multi-run execution + compounding error + a real judge
> surface across dependent nodes) is **still unproven** — for the 40th straight
> time. This is **F-32**, and it is the headline of this report. The good news is
> narrow and real: the *feature* the goal asked for — the `chikory trace <chain-id>`
> CLI branch — was implemented correctly and lands clean. So the chain forensics
> *surface* now exists; it was simply built by a non-chain run, which means the
> chain machinery it serves is **still** unexercised end-to-end.

## The run

Zero-secrets setup as usual: Codex executor (OpenAI family) + Gemini judge behind
the OpenAI-compatible shim. Family diversity held (executor `openai`, judge
`gemini-3.1-pro-preview`). But note what the trace header shows — `1 steps`, a
`run-` id, `executor codex`:

```text
run run-a28655c9-3e5e-456a-bd90-becfdeddff2a · SUCCESS · 1 steps · $1.07 / $15.00 · 3m 48s · executor codex(openai) · judge openai-compat
 1   Implemented the trace CLI chain bra…  791k/6.9k  $1.06  ✓ PROCEED (3/3 criteria)
totals: decisions 1 · judge passes 1 ($0.01, 0.7%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 1 · feedback frequency 1/1 steps
        issues found 0 · changes made 1 (issues:changes 0:1)
        components over time: s0 j@0
```

A chain run would have produced a `ChainJournal` under `.chikory/chains/<chain-id>`
plus one `run-<chain-id>-node-<id>` journal per node, and `chikory trace` would
have shown a `chain … · N nodes` header. Instead this is the F-11-closed
single-run shape (`components over time: s0 j@0`) — the **seventeenth** straight
one-step run. **That streak count is itself the F-32 symptom**: the run that was
specifically designed to be the first *multi-step, multi-run* campaign greened as
yet another one-step run, because it was never launched as a chain. The streak
KPI rewarded exactly the triviality dogfood-041 set out to escape (the
dogfood-039 review already flagged retiring that KPI).

### Evidence that no chain ran

| Check | Expected for a chain | Observed | 
|---|---|---|
| Run id shape | `chain-…` + per-node `run-…-node-…` | plain `run-a28655c9…`, single 🔴 |
| `.chikory/chains/` | `ChainJournal` directory present | **does not exist** 🔴 |
| Node child runs | ≥2 `…-node-…` journals | **none** 🔴 |
| Step count | one step *per node* across runs | **1 step total** 🔴 |
| Step `plan item` | a single decomposed node goal | the **full goal verbatim** 🔴 |
| Planner / plan meta-judge | a `plan` + meta-judge verdict | **absent** (only the per-step executor judge) 🔴 |

## Delivery quality (human review, post-landing)

Setting the launch-method failure aside, the *code that landed* is correct and
in-scope. The diff is the staged working tree (`git diff --cached`), byte-`IDENTICAL`
to the run workspace (phase-0 §5), 2 files, +138/−6:

- **`packages/sdk-ts/src/cli/commands.ts`** (`cmdTrace`, +25 net) — reviewed line
  by line against the spec's goal:
  - When `journalPath(args.dataDir, args.runId)` does **not** exist, it now checks
    `chainJournalPath(args.dataDir, args.runId)`; if that is also absent it errors
    with the updated message `no journal for run or chain '<id>'` and returns 1.
  - If the chain journal exists, it opens `new ChainJournal(chainPath)`, builds the
    record via `chainRecordFrom(chainJournal)`, and on a non-null record prints
    `renderChainTrace(record, chainJournal.entries())` and returns 0 — **reusing
    the existing pure renderer** (dogfood-037), not reimplementing it. A null
    record errors `chain journal … has no chain row`. The `ChainJournal` is closed
    in a `finally`.
  - Run-journal precedence is preserved exactly: the run-journal branch is checked
    first and is unchanged, with an inline comment documenting the precedence on
    an id collision — `// A run journal is the historical 'trace <id>' target;
    keep it authoritative if an id collision ever leaves both run and chain
    journals on disk.` This satisfies the goal's "prefer the run-journal path when
    both somehow exist" instruction.
  - Imports added: `ChainJournal, chainRecordFrom` from `../chain/store.js`,
    `renderChainTrace` from `../chain/trace.js`, and `chainJournalPath` added to
    the existing `../runner/paths.js` import. Named imports only, ESM, no default.
- **`packages/sdk-ts/test/cli/trace.test.ts`** (+113) — adds a
  `describe("cmdTrace journal resolution")` with two cases over real temp data
  dirs (`mkdtempSync`/`rmSync`), driving the actual `cmdTrace` with captured
  `out`/`err`:
  1. *renders a chain trace when the id resolves to a chain journal* — builds a
     2-node `ChainJournal` (`N-1`→`N-2`, N-1 sealed SUCCESS/PROCEED), asserts the
     output contains `chain plan-cli-trace · SUCCESS · 2 nodes · 1/2 succeeded`,
     the per-node rows (`N-1 · … ✓ SUCCESS (PROCEED)`, `N-2 · … pending`), and
     does **not** contain a per-run `run … ·` header.
  2. *keeps the run trace authoritative when both journals exist* — creates both a
     run journal and a chain journal under the same id `same-id`, asserts the
     per-run trace renders (`run same-id · SUCCESS · 1 steps`, `run journal wins`)
     and the chain header does not — directly verifying the precedence comment.

`types.ts` / `schemas.ts` / the chain executor / the pure `renderChainTrace` /
any contract model were **not** touched (phase-0 §4 scope: only the two named
files, both `M`). No new dependency.

Independent checks from the phase-0 verifier, re-run against the working tree —
all green:

```text
AC-1  cd packages/sdk-ts && pnpm exec tsc --noEmit                          PASS (exit 0)
AC-2  cd packages/sdk-ts && pnpm exec vitest run test/cli/trace.test.ts     PASS (20 passed)
AC-3  cd packages/sdk-ts && pnpm exec eslint .                              PASS (exit 0)
```

The trace test file grew to 20 cases (the executor's own summary reported the
full SDK suite at 50 files / 371 pass / 19 skip). Harvest integrity held — both
changed files byte-`IDENTICAL` to the run workspace. The diff is staged and
uncommitted, left for the user's review per the skill default.

## New friction

### 🔴 F-32 — a chain-intended dogfood was launched with `chikory run` and passed as a single-run SUCCESS, with nothing flagging the mismatch

**Evidence.** dogfood-041.yaml is explicitly and repeatedly documented as a chain
dogfood ("THE FIRST CHAIN DOGFOOD", "launched with the NEW `chikory chain`
command", "the goal below is DECOMPOSED into a multi-node Plan"). The actual run
`run-a28655c9` is a single per-run journal: 1 step, plain `run-` id, no
`.chikory/chains/` directory, no `…-node-…` child runs, the step `plan item` ==
the goal verbatim (no decomposition), and only the per-step executor judge fired
(no planner, no plan meta-judge). The launcher used `chikory run <spec>` where the
spec was meant for `chikory chain <spec>`. The task-spec file format is
**identical** for `run` and `chain`, so nothing — not the CLI, not
`dogfood-verify.sh`, not the judge — detected that a chain-intended spec ran down
the single-run path. The run sealed a clean SUCCESS at full one-step cost and the
F-11 streak ticked up, perfectly camouflaging the miss.

**Why it matters.** This is the standing failure mode of the loop (DOGFOODING
§1.1 / the dogfood-review phase-5 warning) reasserting itself one layer lower:
even after the `chikory chain` launch path was hand-built *this session*
specifically to break the pure-leaf streak, the actual launch reverted to `run`,
greening the dashboard while testing none of the thesis. The chain executor
(`chainLoop`, the planner→plan-meta-judge gate, `advanceChain` fold, halt-on-FAILED)
has **never** run against a real goal. Until it does, WP-219's durable-multi-run
claim is unvalidated.

**WP it spawns → WP-232** (chain-launch verification): the review/launch tooling
must make a `run`-instead-of-`chain` launch impossible to mistake for a passed
chain run. Minimum bar: `dogfood-verify.sh` detects when a spec named/annotated
as a chain dogfood produced only a single run journal (no `ChainJournal` under
`.chikory/chains/<id>`) and flags **"chain path NOT exercised — launched as
`run`?"** rather than printing a clean green. Stronger option: a spec-level
`mode: chain` (or a `nodes:`-implying marker) that `chikory run` refuses, telling
the user to use `chikory chain`. Sits in the same family as WP-228
(baseline-precheck) and WP-231 (landing-scope audit) — mechanical guards that
stop a misleading green.

**Consequence for dogfood-041 itself.** The *delivery* (the trace-CLI branch) is
done and correct, but the *headline purpose* (first real chain execution) is
**unmet**. dogfood-041 is **not** complete as a chain dogfood. See "Ready the
next run" for the two recovery paths (re-run as a chain vs. promote this delivery
to track-B and pick a fresh chain goal).

### Other anomaly checks

- **Wasted steps**: none *within* the single run — one productive step, no
  trailing probe (F-11 stays closed). The waste is at a higher level: the entire
  chain apparatus was bypassed.
- **Cost telemetry**: exact sum **$1.0659** (step $1.0579 + judge $0.0080);
  budget used **7.1 %** of $15.00; judge share **0.7 %**. Metering nonzero and
  consistent; no `.00`-with-tokens bug, no `UNPRICED` warning. ℹ️ **The $15
  budget was sized for a multi-node chain (Σ node budgets) but a single run
  consumed only 7.1 % of it** — the budget gate was effectively inert here, a
  second-order symptom of the chain not running.
- **Token economics**: step 1 used **791k input / 6.9k output** over **32 tool
  calls** for a 7694-byte 2-file diff. High band — the one-step series now reads
  021 862k → 022 969k → 023 451k → 024 976k → 025 467k → 026 807k → 027 527k →
  028 410k → 029 462k → 030 434k → 031 375k → 033 327k → 034 594k → 035 318k →
  036 398k → 037 793k → 038 625k → 039 755k → **041 791k** (032 excluded — 2-step;
  040 not run). Still noisy, not monotonic. The 32 tool calls (vs ~28 for the
  comparable dogfood-037 renderer slice) reflect the executor reading the chain
  store + reference renderer to wire the branch. WP-203/WP-207 stay the input-side
  lever.
- **Judge behavior**: the per-step executor judge executed all three check
  commands (`tsc --noEmit`, `vitest run test/cli/trace.test.ts`, `eslint .`),
  each exited 0, PROCEED 3/3. Rubric (`tests_pass`, `no_unrelated_deletions`,
  `no_secrets_introduced`, `scope_matches_instruction`) all passed with sane
  justifications ("changes only the CLI trace implementation and its corresponding
  tests"). 9383 evidence bytes, 13 s, family diversity real (Gemini ≠ codex). ℹ️
  **No plan meta-judge ran** — the different-family plan-gating judge that is half
  the thesis was never invoked, because there was no plan to gate.
- **Human ceremony**: the launch itself is the F-32 finding — the human ran
  `chikory run` instead of `chikory chain`. No zero-step residue this run.
- **Loop integrity**: one checkpoint (`run-a28655c9@3`, commit `a3f86b0ae6cc`,
  `lastGood true`), no rollback, no resume, no duplicate journal entries.

## Verdict on the thesis

- 🟡 **The chain forensics surface now exists — built by a non-chain run.**
  `chikory trace <chain-id>` correctly loads a `ChainJournal` and renders it via
  the pure `renderChainTrace` (dogfood-037), with run-journal precedence on id
  collision. This is a real, clean deliverable and the last pure/CLI piece the
  chain executor needed to be legible. Irony noted: the tool to *read* a chain was
  shipped without ever *running* a chain.
- 🔴 **The thesis pillar is still unproven (F-32).** Durable multi-run execution,
  compounding error across dependent nodes, and a plan meta-judge catching a bad
  node before its dependents run — none of it was exercised. After 40 campaigns,
  Chikory's central claim has zero end-to-end dogfood evidence. The `chikory chain`
  launch path exists and is unit-tested, but has never driven a real goal.
- 🟢 **The F-11 single-run fix remains stable** — but its "Nth straight one-step"
  KPI is now actively harmful: it camouflaged F-32. The dogfood-039 recommendation
  to retire that KPI is reaffirmed and upgraded to urgent.
- **Process finding → WP-232.** A `run`/`chain` launch mismatch must be mechanically
  visible. Until then, every "chain dogfood" is one fat-fingered verb away from
  silently regressing to a single run. The next run **must** be an actual chain.
