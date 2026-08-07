# dogfood-123 — P3 rung-4 publication bundle (WP-304)

**WP:** WP-304 (baseline runs and publication) · **Date:** 2026-08-06 ·
**Spec:** `examples/dogfood/dogfood-123-wp304-rung4-publication-bundle.yaml` ·
**Run:** `run-3e2a6791-cab1-46c7-bc5b-b3d0730b92c5` · **Landed:** this review's commit ·
**Ladder:** P3-rung-4 (WP-530 moat ladder) — **CLIMBED**

## Plain lead

Chikory now has its first published head-to-head benchmark result: on five real
brownfield repair tasks, the Chikory arm satisfied 19 of 19 requirements and raw
Claude Code satisfied 18 of 19 (16 once dependent requirements are zeroed). The run
that assembled the bundle worked — one step, five cents, both acceptance checks
green — but the bundle it produced had two publication defects a human found and the
judge did not: a trace link pointing at a directory that gets deleted, and two
version numbers in the prose copied from a superseded run. Both are fixed on disk.

## Trace

| field | value |
|---|---|
| terminal | 🟢 SUCCESS · 1 step · 3m 20s |
| cost | **$0.0457** of $15.00 budget (0.3%) — judge share **100.0%** |
| executor | `gemini-cli` (gemini family) · 2,343 in / 1,401 out tokens · `costUsd: 0`, `costEstimated: true` |
| judge | `openai-compat` / `gpt-5.6-sol xhigh` · 1 pass · $0.0457 · 33 s · 15,077 evidence bytes |
| verdict | ✓ PROCEED (2/2 criteria, 6/6 rubric) @ step 1 |
| checkpoint | `run-3e2a6791…@5` · commit `d4488810b3b7` · `lastGood: true` |
| rollbacks / escalations / resumes | 0 / 0 / 0 |
| pacing | 1 event · `continue` · 75% window · 4,902 projected tokens |
| agent rotation | none — no member was walled (expected on a 3-minute run, per spec) |
| diff | 4 files, +374 lines, 14,448 bytes |

**Agent classes (WP-566…WP-576) — live check, per the spec's own instructions:**
`park-until-reset` count **0** ✅ · `🔄 agent rotation` lines **0** (correct: no wall hit) ·
all 6 class members probed green at $0 pre-launch.

## Delivery quality (human review, post-landing)

**What landed** — exactly the 4 files the goal named, nothing else:

```
A benchmarks/publications/p3-rung-4/chikory-summary.json          (68 lines)
A benchmarks/publications/p3-rung-4/comparison.json              (155 lines)
A benchmarks/publications/p3-rung-4/raw-claude-code-summary.json  (68 lines)
A benchmarks/publications/p3-rung-4/report.md                     (83 lines)
```

**Independently verified ✅**

- **Byte-faithfulness (trap A).** Both published summaries are byte-identical to
  `benchmarks/results/p3-rung-4/{chikory,raw-claude-code}/summary.json` on the host.
  Verified by `diff`, not by trusting the run.
- **Every number in `report.md` traces to the summaries.** 19/19, 18/19, 16/19, all
  five per-task rows, both wall-clock totals, both timestamp windows — all exact.
- **Wilson intervals recomputed by hand** at z = 1.959963984540054:
  19/19 → [0.8317, 1.000] ✅ · 18/19 → [0.7536, 0.9906] ✅ · 16/19 → [0.6243, 0.9448] ✅.
  The report leads with the interval, not the point estimate, as the goal required.
- **The brownfield-001 delta is real.** Chikory's arm shipped `zod` 3.22.4 → 4.4.3
  (R1/R2/R3 all `check exit 0`); the baseline left `zod` at 3.22.4, R1 exited 1, and
  dependency-adjustment zeroed R2/R3 → 2/3 satisfied, 0/3 dependency-satisfied.
  Confirmed in both arms' per-task `grading.grades`, not from the report's prose.
- **Scope discipline.** `git diff chikory-base..HEAD` in the workspace is exactly the
  4 publication files. No harness edit, no dependency, no `command`-adapter rebuild.
- **Suite.** 1299 TS (23 skipped) · 179 harness · 84 py — all green after this
  review's fixes (was 177 harness pre-fix; +2 new F-261 tests).

**Defects the run's own green did not catch** — see friction F-261/F-263 below.

## New friction

### 🔴 F-261 — a published trace link pointed inside a directory that gets deleted

**Evidence.** `comparison.json` as delivered:

```
"rawResultsDir": "/Users/nikitazolotarev/repos/chikory/.chikory/runs/
                  run-3e2a6791-cab1-46c7-bc5b-b3d0730b92c5/workspace/
                  benchmarks/results/p3-rung-4/chikory"
```

`benchmarks/harness/src/results.ts` built the field as `dirname(resolve(reference))`.
The executor ran `compare` inside its own run workspace, so both arms' trace links are
(a) absolute host paths meaningless off this machine and (b) inside
`.chikory/runs/<run-id>/workspace`, which `scripts/prune-runs.sh` deletes. The field's
own doc comment says it exists because "every published number links to its raw trace" —
a link that dies at the next prune does not do that.

A second half: the pointer names a *parent* holding **7** chikory suite runs and **2**
baseline suite runs, with nothing saying which one produced the published `summary.json`.

**Disposition: HAND-FIXED THIS SITTING → WP-588.**
`publishableRawResultsDir()` (`benchmarks/harness/src/results.ts:226-264`) now throws on
any reference under a `.chikory/runs` segment and otherwise emits a **repo-relative**
path. `comparison.json` regenerated from the host's durable paths
(`benchmarks/results/p3-rung-4/{chikory,raw-claude-code}`). `report.md` gained an
"Exact suite runs behind these numbers" table naming both timestamped directories.
2 new tests in `benchmarks/harness/test/results.test.ts:249-283`; harness 177 → 179 green.

### 🟠 F-262 — AC-2 proved the field EXISTED, never that it RESOLVED

**Evidence.** AC-2's only assertion about the traceability field was
`typeof x.rawResultsDir === "string" && x.rawResultsDir.length > 0`. It passed on a
string that points at a directory scheduled for deletion. This is exactly the weak-oracle
shape the dogfood-113 lesson names: a check that proves a symbol exists cannot prove it
computes the right answer.

**Disposition: track-B note, folded into the next spec's ACs.** Any AC asserting a
path-shaped field must `existsSync` it, assert it is **relative**, and assert it is not
under `.chikory/`. Recorded in DOGFOODING §8.

### 🟠 F-263 — the report's prose cited versions from a superseded, unpublished run

**Evidence.** Delivered `report.md`, brownfield-001 detail: "transitive `typescript`
(5.5.4) and `@types/node` (20.14.9) updates". Neither string occurs anywhere under
`benchmarks/results/p3-rung-4/chikory/20260806-203753-chikory` — the suite run the
published `summary.json` actually describes, whose final `package.json` reads
`typescript 5.7.3` / `@types/node 20.17.19`. Both values occur only under
`.../20260805-234219-chikory`, a **different, superseded, unpublished attempt**.

Trap A guarded the JSON (byte-faithfulness, enforced) but nothing guarded the prose,
so a fabricated-adjacent number reached the publication artifact through a green run.

**Disposition: HAND-FIXED THIS SITTING.** Corrected to the published arm's real
transition (`zod` 3.22.4 → 4.4.3, `typescript` 5.2.2 → 5.7.3, `@types/node` 20.8.9 →
20.17.19), verified against that arm's `workspace/package.json`. The F-261 provenance
table now pins which suite run every number comes from.

### 🔴 F-264 — the judge's scope rubric is blind to gitignored writes

**Evidence.** The spec's write boundary was "`benchmarks/publications/p3-rung-4/` and,
only if narrowly required, `benchmarks/harness/`". The run wrote **2.1 GiB across 95,068
files** into `benchmarks/results/` inside its workspace — including 2 `node_modules`
trees — and the judge scored `scope_matches_instruction ✓ "Every changed file is one of
the four required artifacts"`. Both statements are true at once, because the rubric reads
the **git diff**, and `benchmarks/results/` is gitignored in its entirety.

Root cause is the spec, not the executor: AC-2 reads `../results/p3-rung-4/**` from
*inside the workspace*, but the workspace is a clone of HEAD and that tree is gitignored,
so the oracle could only be satisfied by importing 39 GiB of host state into the sandbox.
The executor did the only thing available (transcript: "Waiting for the copy task
(`task-28`)… rsync (`task-53`)…"). Free disk went 13 GiB → 12 GiB against a 10 GiB
preflight floor, and the workspace is retained as the audit trail.

**Disposition: → WP-589 (queued).** Two halves: (1) the judge's write-boundary check must
consider ignored paths, not just the diff — a `writeSet` (WP-545) that only binds tracked
files is not a boundary; (2) `chikory-bench compare` should take arm summaries as operator
inputs resolvable outside the sandbox so no spec ever has to import gitignored evidence.

### 🟡 F-265 — the gemini-cli adapter records no tool calls at all

**Evidence.** Step record: `"toolCalls": 0`, `"tokens": {"input": 2343, "output": 1401}`,
`durationMs: 162040`. The 5,605-byte transcript is assistant `<message>` blocks only. In
those 162 seconds the executor rsynced 95k files, ran `chikory-bench compare`, and ran two
test suites — none of it appears anywhere. The token counts are implausible for the work
and feed the pacing governor (which projected 4,902 tokens and reported 75% window).

For a project whose stated constraint is "minimal abstraction + maximal observability",
the audit trail of the rung-4 publication run contains zero evidence of what was executed.

**Disposition: → WP-590 (queued).** Parse the `gemini-cli` stream for tool invocations and
record them as `toolCalls` + transcript entries; re-check the token accounting against a
known-size step. Note `costUsd: 0` is *correct* here (subscription-linked metering,
declared in the capability record) — the gap is tool/command evidence, not price.

### ℹ️ F-266 — the progression gate pointed at the retired P2 ladder

**Evidence.** `scripts/dogfood-progression.sh:183,187` printed "the next WP-265 ladder
rung (plan.md §6 queue)". WP-265 is the P2 horizon ladder, retired at rung 5 / dogfood-096;
the active ladder is WP-530 (P3 moat ladder, plan.md §7). A reviewer following the gate's
own instruction would queue the wrong headline.

**Disposition: HAND-FIXED THIS SITTING.** Both verdict lines and the two header comments
now name the **current phase** ladder (P3 = WP-530, §7). Re-ran: ✅ PROGRESSING with the
corrected pointer.

## KPI table (DOGFOODING §1.4)

| KPI | this run | trailing-3 (121–123) | target / gate |
|---|---|---|---|
| max horizon survived | 1 step / 3m 20s | 10 steps | 24h+ met at P2 (dogfood-096) |
| kill→resume count | 0 | 3 | — |
| judge true-positives pre-land | 0 | 2 | — |
| trailing-3 meta:product headline ratio | product | **0/3 meta** | cap ≤1 meta per 3 ✅ |
| per-step reliability (runs ≥5 steps) | n/a (1 step) | 94.5% (9 rollbacks / 164 steps) | 99%+ |
| current-phase ladder rung | **4** | 4 | P3 exit = rung 5 |
| cost | $0.0457 / $15.00 (0.3%) | $1.59 total | — |

## Verdict on the thesis

**P3-rung-4 is climbed, and the number is favourable but not yet conclusive.** Chikory's
arm beat raw Claude Code on the one task that separated them (`brownfield-001`, a real
zod v3→v4 major upgrade), and the win is attributable to the thesis mechanism: the
in-loop judge issued a ROLLBACK on the first attempt and the run recovered. On the other
four tasks the arms tie at 4/4.

The honest reading is the interval, which is why the goal demanded it: **[83.2%, 100.0%]
vs [75.4%, 99.1%]** on I-SR. Those overlap. Five tasks and 19 requirements cannot separate
two arms at 95% confidence, and the published report is right to lead with ranges. Rung-5
(the exit gate) needs a corpus that can.

The run itself is the second lesson. It was cheap, fast, and both oracles were green — and
it still shipped a dead trace link and a wrong version number, because the ACs asserted
*shape* where they needed to assert *resolution*, and the judge's scope rubric cannot see
past `git diff`. A publication bundle is exactly the artifact where "green" is worth least.
