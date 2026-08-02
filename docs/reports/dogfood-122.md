# dogfood-122 (five-task baseline range, CHAIN relaunch) — WP-302 + WP-304: the campaign died of a full disk, and two of its five nodes were paid to redo landed work

**Plain:** The relaunch never got near its goal. Its first two nodes were told to write two benchmark
tasks that were already finished and committed a day earlier, so they were paid to make a four-line
cosmetic edit and were graded a success for it. Its third node then spent five and a half hours
trying to score the benchmark, hit a Gemini quota wall, waited four hours for it to reopen exactly as
designed, and was killed by a database error with no message beyond "unable to open database file" —
on a laptop that was 98% full. Nothing was salvageable. Seven harness defects were hand-fixed in this
sitting, one of them the reason the whole rung-4 benchmark could never have passed anyway.

- **WP:** WP-302 (brownfield task authoring) + WP-304 (baseline runs and publication)
- **Date:** 2026-08-01 (America/Toronto; journal timestamps below are UTC)
- **Spec:** [`examples/dogfood/dogfood-121-wp302-wp304-five-task-baseline-range.yaml`](../../examples/dogfood/dogfood-121-wp302-wp304-five-task-baseline-range.yaml) (the dogfood-121 spec, amended and relaunched)
- **Chain:** `chain-ebecd792-3907-48da-ab65-8679fd4b5c78`
- **Plan:** `plan-bece62dc-19ff-44ea-b3ae-0aa1b84eeae7` → `-r1` (one replan)
- **Base HEAD:** `f475bbb`
- **Outcome:** ⛔ FAILED · 5-node plan · 3/5 nodes sealed · 4 node incarnations · 7 steps ·
  8 judge passes · 5h 39m · **$0.6545 / $60.00** ($0.3611 plan phase + $0.2934 nodes; all judge
  spend — the CLI-OAuth executor meters $0)
- **Ladder:** P3 rung 4 **attempted, not reached.** No arm ran to completion, no `summary.json`
  exists, no comparison bundle.

## Trace

| When (UTC) | Node | Steps | Cost | What happened |
|---|---|---:|---:|---|
| 18:17:06 | plan | — | $0.3611 | gate **REVISE** then **PROCEED**, 5 nodes |
| 18:17:06 | `N-1` | 2 | $0.1421 | 🟢 **SUCCESS** (PROCEED) in 5m 24s — but see below: its oracle was green on entry |
| 18:22:30 | `N-2` | 1 | $0.0463 | ⛔ FAILED (ESCALATE) in 2m 25s — burned the only replan |
| 18:24:56 | `N-2-r1` | 1 | $0.0370 | 🟢 **SUCCESS** (PROCEED) in 4m 11s — oracle also green on entry |
| 18:29:07 | `N-3` | — | — | step 0, 42m: launched **four concurrent** benchmark suites |
| 19:10:54 | `N-3` | — | — | Gemini quota wall: `Individual quota reached … Resets in 4h6m22s` |
| 19:11:22 | `N-3` | — | — | **WP-553 parked `sleepMs 14768000`** (4h 06m) — as designed ✅ |
| 23:17:30 | `N-3` | — | — | clean resume from the park; step 2 launches a fifth suite |
| 23:56:14 | `N-3` | 3 | $0.0680 | fifth suite's `brownfield-002` seals; `brownfield-003` starts |
| 23:56:15 | chain | — | — | ⛔ `chikory: unable to open database file`, exit 1, chain left **un-sealed** |

`N-4` (raw Claude Code arm) and `N-5` (comparison bundle) never started.

## Salvage: none

`scripts/harvest.sh` refused the chain (`is RUNNING; only SUCCESS chains can be harvested`), which is
correct. There was nothing to take:

- `N-1`'s entire diff is **4 removed lines** in `benchmarks/tasks/brownfield-004.yaml` plus 9 lines
  of report text — cosmetic edits to a file that already existed.
- `N-2-r1`'s diff is the same shape on `brownfield-005`.
- `N-3` produced **two empty diffs**; all of its real output went to `benchmarks/results/`, which is
  gitignored by design.
- **No arm ever produced a `summary.json`.** Five suite attempts, every one stalled at
  `brownfield-003`, 1.3–1.7 G of clones each.

## What actually went wrong

### 🔴 F-237 — two nodes were paid to redo work that was already on HEAD

`brownfield-004.yaml`, `brownfield-005.yaml` and both evidence reports landed in **`1bec8bb`**, one
day before the launch. AC-3, AC-4 and AC-5 were therefore **green on `f475bbb`**, and no step either
node could take would ever turn them red. Both sealed SUCCESS over cosmetic diffs.

The guard for exactly this existed: `evaluateBaselinePrecheck` (WP-228 / F-25) — unit-tested, exported
from `src/index.ts`, and **called from nowhere in production**. Same inert-code shape as F-136 and the
WP-533 `is_error` gate. The launcher's own `--preflight` refuses a spec whose ACs are all green on
HEAD; a chain NODE had no equivalent.

### 🔴 F-236 — the volume was 98% full at launch, and nothing checked

11 GiB free when a five-node chain launched, whose middle nodes clone five real OSS targets and
install their `node_modules` per suite attempt. There was no disk preflight and no way to reclaim
run workspaces.

**A `du` caveat worth recording**, because it cost time here: `.chikory` measured **95 G**, but
deleting 157 run workspaces freed only **~9 GiB**. On APFS the workspaces are copy-on-write clones
that share physical blocks, so `du` counts every clone at full logical size. There were no local
Time Machine snapshots. Trust `df`, not `du`.

### 🔴 F-235 — the fatal error named neither the file nor the reason

`chikory: unable to open database file` — no path, no errno, no operation. Three different SQLite
records (run journal, chain store, endpoint ledger) are opened from a **relative** `.chikory` root
(`DEFAULT_DATA_DIR`), so the message could not distinguish them and the crash site is *still*
unidentified. Disk exhaustion remains the leading candidate; the defect is that this cannot be
settled from the evidence.

### 🔴 F-239 — one node ran four benchmark suites at once

Five results dirs under `benchmarks/results/p3-rung-4/`, four with overlapping lifetimes
(`20260731-183211`, `-184642`, `-185635`, `-185819`), each cloning three real targets. Nothing
prevented it. This is also the best available explanation for the base-verification reds below: four
simultaneous `npx -y pnpm install` runs contending for one store.

### 🔴 F-238 — every base verification blamed the parser

Both scored tasks recorded
`baseVerification: { green: false, reason: "Unparseable suite output: could not find test summary", testsPassed: 0 }`.
`verifyBaseGreen` checked `parseTestSummary` **before** the exit code and discarded both the code and
the output, so an install failure, a missing package manager and a timeout were indistinguishable
from genuinely odd output. Since AC-7/AC-8 require `green === true` on all five tasks, this made
rung 4 unreachable behind a message that pointed at the wrong component.

### 🟡 F-241 — base verification inherited the 120 s judge-check cap

`verifyBaseGreen` used `DEFAULT_CHECK_TIMEOUT_MS` (120 s) — the cap for a single judge assertion — for
a job that installs a real target's dependencies and runs its entire suite.

**Measured, not assumed:** every task's own `base_verification_command`, re-run against a fresh clone
of its pin, finishes in **9–28 s**. So the cap is *not* what reddened this run, and I am not claiming
it was. It is a real latent defect — no margin for a cold store or contention — and it is fixed. The
observed reds are best explained by F-239's four concurrent installs.

### 🔴 F-242 — brownfield-001's base could never verify (found by WP-558, within the hour)

The very first use of the new reason text named a blocker that had been invisible:

```
brownfield-001: Verification command failed with exit code 1 before producing a test summary —
  YN0028: The lockfile would have been modified by this install, which is explicitly forbidden.
```

`yarn install --immutable && yarn test` used the **ambient** yarn. The target carries a Yarn
**Classic** lockfile (`# yarn lockfile v1`), declares no `packageManager` and ships no `.yarnrc.yml`,
so Yarn Berry 3.6.4 tried to convert it and refused. The task could never be scored, and AC-7/AC-8
require all five. Under the old message this read as `Unparseable suite output`.

### 🔴 F-243 — a HOME-level `~/.yarnrc.yml` silently redefined `yarn` in every task workspace

Pinning the version was not enough. `~/.yarnrc.yml` on this machine declares
`yarnPath: .yarn/releases/yarn-3.6.4.cjs`, and Yarn 1's launcher honours it from **any** directory:

```
npx -y yarn@1.22.22 --version          → 3.6.4      (!)
YARN_IGNORE_PATH=1 npx -y yarn@1.22.22 --version → 1.22.22
```

This is the toolchain analogue of F-199 (which scrubs host credentials): host *configuration* was
reaching into a benchmark task and changing which package manager ran. Also worth noting — the
ambient `yarn` resolved to `/opt/homebrew/bin/yarn`, a **host** binary, which CLAUDE.md forbids.

## Part 3 gate — base verification, re-measured on all five tasks

Each task's own `base_verification_command`, against a fresh clone of its declared pin, $0 LLM:

| Task | Target | Result | Tests | Wall |
|---|---|---|---:|---:|
| brownfield-001 | ecyrbe/zodios | 🟢 green | 117 | 9 s |
| brownfield-002 | gitify-app/gitify | 🟢 green | 1128 | 18 s |
| brownfield-003 | colinhacks/zod | 🟢 green | 3680 | 21 s |
| brownfield-004 | react-hook-form | 🟢 green | 1208 | 11 s |
| brownfield-005 | trpc/trpc | 🟢 green | 22 | 28 s |

**5/5.** brownfield-001 was red until F-242 + F-243 were fixed. The precondition AC-7/AC-8 rest on now
holds, and the whole corpus verifies in **87 s** — which is itself the strongest evidence that the
five 1.3–1.7 G suite attempts were being destroyed by contention, not by slowness.

### 🔴 F-240 — a chain whose node was terminated could never seal

The chain sat at `status=RUNNING, ended_at=NULL`. `decideChainOrphanRepair` declines whenever a
dispatched node has no sealed outcome — without checking whether that node's own workflow still
exists. Here both workflows were still `Running` server-side (only the local worker died), so the
decline was correct and re-attaching was the real recovery. But once the workflows are terminated —
the honest action for an abandoned campaign — the chain becomes **permanently unsealable**: the
in-flight guard declines under every liveness state, and there is no decision left to deliver.

### ✅ WP-553 is live-proven (the F-197 signature, banked)

Step 0 hit `Individual quota reached. Please upgrade your subscription to increase your limits.
Resets in 4h6m22s`; the runner journaled `limit_observation` + `limit_signal`, parked
`sleepMs 14768000` (= 4h 06m 08s, the compact `4h6m22s` parsed correctly — F-234 held), and resumed
cleanly at 23:17:30Z. Journal `chain-ebecd792-…-node-N-3/journal.db`, entries **1, 2, 12**. The
quota wall cost nothing but time and did not consume a strike.

## Hand-fixes landed this sitting

| WP | Friction | What changed |
|---|---|---|
| WP-558 | F-238 | `verifyBaseGreen` decides on the exit code BEFORE parsing, and carries the code plus a bounded output tail into `reason` |
| WP-559 | F-235 | `openDatabase()` wraps all three SQLite opens; failures name the record kind, the absolute path, free space when low, and keep the original message as `cause` |
| WP-560 | F-236 | `scripts/dogfood.sh` refuses at $0 below 40 GiB (chain) / 15 GiB (run); overrides `CHIKORY_ALLOW_LOW_DISK=1`, `CHIKORY_MIN_FREE_GIB` |
| WP-561 | F-237 | `agentLoop` runs the acceptance checks before step 0 and seals SUCCESS without spending a step when they all pass; `evaluateBaselinePrecheck` moved to `src/util/` (a `workflow→cli` import is a layering violation) |
| WP-562 | F-239 | `chikory-bench run` takes an exclusive lock on its results root; a second suite exits non-zero naming the live holder |
| WP-563 | F-240 | The orphan repair probes the in-flight node's OWN workflow; an abandoned node is sealed FAILED and the chain seal becomes resumable |
| WP-564 | F-241 | Base verification gets `DEFAULT_BASE_VERIFY_TIMEOUT_MS` (45 min) and a `--base-verify-minutes` flag |
| — | F-242 | `brownfield-001` pins its own package manager: `npx -y yarn@1.22.22 … --frozen-lockfile` |
| WP-565 | F-243 | Base verification sets `YARN_IGNORE_PATH=1`, so a HOME-level `yarnPath` cannot re-exec a different package manager inside a task |

Also added: `scripts/prune-runs.sh` + `devbox run prune-runs` — reclaims run workspaces, never
journals or artifacts, dry-run by default.

**Two of these fixes were themselves wrong first, and the suite caught both** — worth recording,
because both are the "a fix that isn't exercised is a guess" pattern:

- **WP-561's first cut sealed on ANY run**, which broke three integration tests. A **negative**
  criterion (`no CORRUPTED-BY-SEAM marker in step-1.txt`) is green on an empty base by construction,
  so the gate read "already done" and sealed before the seam could arm. It is now scoped to chain
  nodes (`spec.chainLink`), where F-237 actually bit and where nothing else guards the spend. The
  limitation is recorded in the code: the complete check belongs at the **plan gate**, which can
  compare a node's assigned criteria against the chain base before anyone is paid.
- **WP-559's first cut called `resolve(":memory:")`**, turning libsqlite's in-memory sentinel into a
  literal `./:memory:` file — every in-memory journal would have become a shared, persistent one.
  Caught by the WP-203 compaction-journal test; sentinels now pass through unresolved.

**Verification:** `devbox run test` exit 0 — **1205** TS / **147** harness / py green; `devbox run
lint` clean; **20/20** launch-guard preflight cases.

The chain was then sealed by hand: both Temporal workflows terminated, then WP-563's repair wrote the
terminal entry. `chikory chain trace` now reads `FAILED · sealed 3/5`, with `N-3 · FAILED · verdict
HALT`. **WP-563 was required to do it** — the pre-fix code declined under every liveness state.

## Verdict on the campaign shape

dogfood-121's five-node chain is the wrong shape for rung 4 and is **not** being relaunched:

- `N-1`/`N-2` are already done and can only be re-graded, never re-earned.
- `N-3`/`N-4` ask an LLM executor, inside a step loop with no resume, to supervise a multi-hour,
  disk-heavy, quota-bound benchmark. It responded by starting the job five times.

**Next:** the operator runs both arms by hand via `scripts/bench-run.sh` (sequential, single-flight,
outside the agent loop), and dogfood-123 covers only the publication bundle — AC-1 as the regression
guard and AC-2 as its own oracle. AC-3…AC-8 describe work the operator will have done.

`examples/dogfood/dogfood-123-wp304-rung4-publication-bundle.yaml` is armed and sorts last, so the
launcher glob resolves to it. **It must not be launched until both arms exist on disk** — AC-2 now
also asserts the published summaries are **byte-faithful** to
`benchmarks/results/p3-rung-4/{chikory,raw-claude-code}/summary.json`, so the node cannot invent,
round, or "correct" an arm it did not run (trap A).

```
# 1. arms, by hand, sequentially — hours, real quota
devbox run -- bash scripts/bench-run.sh --out benchmarks/results/p3-rung-4/chikory
devbox run -- bash scripts/bench-run.sh --adapter command --cmd '<claude-code template>' \
  --out benchmarks/results/p3-rung-4/raw-claude-code
# 2. then, and only then
CHIKORY_PREFLIGHT_ONLY=1 devbox run run-dogfood
devbox run run-dogfood
```

## Check next run (F-197 — behaviour these fixes cannot prove in their own run)

- **WP-561:** a node whose acceptance checks all pass on entry seals SUCCESS with
  `already satisfied before step 0` and **zero** `step` entries in its journal.
- **WP-562:** a second concurrent `chikory-bench run` against one results root exits non-zero naming
  the holder's pid.
- **WP-563:** already proven live on this chain (see above).
- **WP-558/WP-564:** a red base verification names an exit code and real output, never
  "Unparseable suite output: could not find test summary".
