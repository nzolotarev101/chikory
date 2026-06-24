# dogfood-051 — WP-207: pacing telemetry (context-window pressure now journals)

- **WP:** WP-207 (wire `decideContextWindowPacing` into the live loop + journal a durable replay-safe `pacing` entry each step + surface it in `chikory trace`) — FA-3 / SE-2.
- **Date:** 2026-06-23
- **Spec:** `examples/dogfood/dogfood-051.yaml` (`dogfood-051-wp207-pacing-telemetry`)
- **Run-id:** `run-663a1baa-1a78-406f-91c5-bd0afa2fdcaa`
- **Landed commit:** _uncommitted on the working tree_ (harvest byte-IDENTICAL to the run workspace — see §Independent verification; left for the operator to commit per F-51/WP-249 hygiene, ideally its own commit with a `Ref: run-id:` trailer).
- **Runtime:** HEAD at launch `54a2c41`
- **Gate verdict (pre-launch):** ✅✅✅ PROCEED
- **Verdict:** 🟢 **SUCCESS in 1 step — clean one-shot, delivery verified independently.**

## Vibe check (plain English)

For 50 dogfoods the #1 recurring data point in every report has been the same: each
step reads **hundreds of thousands of input tokens** to produce a tiny diff, yet
`chikory trace` showed **zero** context-window pressure. The pure decision that judges
that pressure — `decideContextWindowPacing(usage, policy)` → `continue` / `compact` /
`park` — has existed and been unit-tested since dogfood-031, but it was **never wired
into the live agent loop** and the `"pacing"` journal kind it would emit was emitted by
**nothing** (it fell to the trace renderer's `default` case). This run closes that gap:
the loop now feeds **real per-step token usage** into the pure decision and writes a
**durable, replay-safe `pacing` journal entry every step**, and `chikory trace` prints a
`pacing events N` count plus a per-entry `pacing <action> — <pct>% window` line. It is
the **first live observability on the context-rot problem the whole product exists to
fight** — the identical "compute-but-never-journal" gap WP-245 (seam telemetry, dogfood-050)
just closed for the judge-catch. The `codex`/`gpt-5.5` executor wrote all five files
correctly in one step.

## Trace excerpt

```
run run-663a1baa-1a78-406f-91c5-bd0afa2fdcaa · SUCCESS · 1 steps · $2.85 / $5.00 · 6m 46s · executor codex(openai) · judge openai-compat
 #   step                                 tokens(in/out)   cost     verdict
 1   Implemented WP-207 pacing telemetry… 2178k/12k        $2.84    ✓ PROCEED (1/1 criteria)
totals: decisions 1 · judge passes 1 ($0.01, 0.3%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 1 · feedback frequency 1/1 steps
        issues found 0 · changes made 1 (issues:changes 0:1)
        components over time: s0 j@0
```

| Metric | Value |
| --- | --- |
| Terminal state | 🟢 SUCCESS (1 step, `max_steps` 8) |
| Total cost | **$2.8487** exact (`$2.85` header) / $5.00 budget = **57.0%** |
| Step 1 cost / tokens | $2.8398 · **2178k in / 12k out** · 6m 31s · **48 tool calls** · diff 10094 bytes |
| Judge pass #1 | `openai-compat/gemini-3.1-pro-preview` · **$0.0089** · 11836 evidence bytes · 15s · ✓ PROCEED (1/1) |
| Judge share | **0.3%** (cap was 50%) |
| Duration | 6m 46s |
| Family diversity | 🟢 `codex`/**openai** (`gpt-5.5`) executor vs Google `gemini-3.1-pro-preview` judge |
| Checkpoint | `run-663a1baa-…@3` · commit `d199b1610fa8` · lastGood true |
| Probe step (F-11) | none — no empty-diff step this run |

**Acronyms / terms:** *WP* = work package (a unit on `plan.md` §6). *AC* = acceptance
criterion (the machine-graded `check` the judge re-runs). *Pacing decision* =
`decideContextWindowPacing(usage, policy)`, the pure function (landed dogfood-031) that
returns `continue` / `compact` / `park` over **projected context-window pressure**
(`utilization` = how full the window is, `projectedTokens` = what the next step is
forecast to push it to). *`appendOnce`* = the journal's idempotent write keyed on an
index, so a Temporal **replay** never double-writes the same entry. *Family diversity* =
executor and judge from structurally different model families (bias mitigation, a core
thesis invariant). *Context rot* = model quality degrading as the window fills — the
pillar this telemetry makes observable.

## Delivery quality (human review, post-landing)

🟢 **The landed code is correct and matches the spec line-by-line across all five files.**

- `src/runner/activities.ts` — new `recordPacingEvent(input)` activity on
  `createRunnerActivities`, modeled byte-for-byte on the dogfood-050 `recordSeamEvent`:
  `openJournal(deps, input.runId)`, `journal.appendOnce({ field: "pacingEventIndex", value },
  { kind: "pacing", payload: { pacingEventIndex, atStep, action, projectedTokens,
  remainingTokens, utilization }, costDeltaUsd: 0, artifactRefs: [] })`, `journal.close()`
  in a `finally`. JSDoc cites WP-207 / FA-3 / SE-2. `appendOnce` keyed on `pacingEventIndex`
  makes it idempotent under Temporal replay — the same invariant `recordSeamEvent` /
  `recordBudgetEvent` have. ✓
- `src/workflow/agent-loop.ts` — the wire: imports `decideContextWindowPacing` + the type
  `ContextWindowPacingPolicy` from `"../runner/pacing.js"`; module-level
  `DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000` and
  `DEFAULT_PACING_POLICY = { compactAtFraction: 0.8 }`; `let pacingEventIndex = 0;` next to
  `seamEventIndex`; and right after the per-step token-accounting block, it builds usage from
  the **real** accumulated counts (`currentInputTokens: spentTokens`, `currentOutputTokens: 0`,
  `estimatedNextStepTokens: recordTokens`), calls the **real** `decideContextWindowPacing`
  (grep-pinned, so the executor can't fake the action), and journals every step. The
  judge/checkpoint/compaction ordering that follows is untouched. ✓
- `src/cli/trace.ts` — (a) `const pacingEvents = entries.filter((e) => e.kind === "pacing").length;`
  and an additive ` · pacing events ${pacingEvents}` appended to the `injections … ·
  checkpoints …${seamSummary}` sub-line **only when `pacingEvents > 0`** (the no-pacing path
  stays byte-identical — the WP-218/WP-245 additive convention); (b) a `case "pacing":` in
  `formatEntryLine` rendering `pacing <action> — <round(util*100)>% window (<formatTokens(proj)> proj)`,
  same payload-cast style as the sibling cases. No other totals line touched. ✓
- `test/runner/pacing-journal.test.ts` (NEW, Temporal-free) — `new Journal(":memory:")`,
  `createRun`, `appendOnce` the same `pacing` entry **twice** with the same
  `{ field: "pacingEventIndex", value: 0 }` key, asserts
  `expect(journal.entries("pacing")).toHaveLength(1)` (idempotency under replay) and that the
  single entry's `action` (`"compact"`) + `utilization` (`0.9`) round-trip. ✓
- `test/cli/trace.test.ts` (+2 cases) — a journal with a `pacing` entry renders
  `pacing events 1`; a journal with no `pacing` entry does **not** render `pacing events`; and
  `formatEntryLine` renders `pacing compact — 90% window (180k proj)`. ✓

**One benign delivery deviation (not a defect):** the executor **relocated
`stepIndex += 1;` upward** (above the `recordTokens` computation, from its original spot
after `recentSummaries.push`) so that the new `atStep: stepIndex - 1` reads a correct
**0-based** step index. This is behavior-safe and was the right call: every other
`stepIndex - 1` read in the loop (the judge-cadence block at `agent-loop.ts:380-466`) was
already **post-increment**, so moving the increment a few lines earlier changes nothing for
existing code — only the new pacing block sits between the old and new positions, and it
reads the intended value. The full SDK suite (incl. the real-Temporal `verdict-gating` ARMED
and `crash-recovery` paths) is green, confirming the reorder is safe. The judge passed
`scope_matches_instruction ✓`.

**Independent verification (not the run's own green):**

- `dogfood-verify.sh` §3 re-ran AC-1 against the working tree: **PASS, exit 0** — the six
  grep-pins (`pacing events 1`, `toHaveLength(1)`, `recordPacingEvent` ×2 sources,
  `decideContextWindowPacing` in the loop, `"pacing"` payload literal) + `vitest` 22/22 +
  `tsc --noEmit` + `eslint .` all clean.
- §5 byte-diff: all **5** changed files **IDENTICAL** to the run workspace — the harvest did
  not diverge from what ran.
- Full SDK suite re-run by hand: **🟢 454 passed | 19 skipped (473)**, 25.07s — crucially
  including `verdict-gating.test.ts` ("seedBadDiff ARMED" 1338ms + the four ESCALATE/ROLLBACK
  cases) and `crash-recovery.test.ts` (21.96s). These exercise the **real** agent loop, which
  now calls `activities.recordPacingEvent` on every step — they still pass, confirming the new
  activity is **registered in the real Temporal harness**, not just unit-mocked.
- **Scope discipline:** the run touched exactly **5 files** — the five the goal names, nothing
  out of scope (`git status --short`); judge rubric `scope_matches_instruction ✓`.

## New friction

🟢 **No new friction from the run mechanics themselves.** Cost telemetry non-zero and sane
($2.8398 step, $0.0089 judge, both models priced); no filler/probe step (F-11 did not recur,
`s0 j@0`); the judge executed its check (`exited 0`); rubric justifications sane; family
diversity real (`codex`/openai `gpt-5.5` vs Google `gemini-3.1-pro-preview`); single
checkpoint `lastGood true`; no duplicate journal entries. The one-shot SUCCESS is honest data —
a cross-file vertical (activity + workflow wire + renderer + 2 tests) the executor got right
first try, including the replay-safe idempotency key and the 0-based `atStep` reorder.

**F-53 → folds into WP-207 (minor residual, 🟢).** The pacing telemetry is **unit-proven**
(`pacing-journal.test.ts` proves `appendOnce` idempotency + payload round-trip; the renderer
tests prove the additive totals line + per-entry format) but it has **not yet been observed
live** — this run's **own** `chikory trace` shows **no** `pacing events` line, because the
runtime that executed the run was HEAD (`54a2c41`), which predates this very wiring. The
feature exists only in the produced diff, not in the runtime that produced it — the **identical
shape as F-52** (seam telemetry unobserved-live). The cleanest closure is **not** a fresh
scaffold run: the **next** dogfood run (executed after this lands and the SDK rebuilds) is
**automatically the first live observation** — confirm its trace reads `pacing events N` with
`N > 0`; or add a one-line `journal.entries("pacing")` non-empty assertion to the
`verdict-gating` ARMED / agent-loop integration test. Tracked as a WP-207 follow-up, not a new
headline.

**Token economics (baseline data for WP-203 / WP-207):** **2178k input / 12k output** for a
10.1 KB diff over **48 tool calls** — a **new series high** (prior highs: 793k dogfood-037,
770k dogfood-050, 757k dogfood-045). This is the standing #1 data point, and it is exactly the
pressure this run now instruments: the loop read **2.178M input tokens** to land a 5-file diff,
and — ironically — until this landed, `chikory trace` surfaced none of it. The new
`pacing events N` count + per-entry `% window` line are the first step toward making this
visible per run.

## Verdict on the thesis

🟢 **Net-positive, on the most-cited unsolved pillar (context-rot), pays down real
observability debt — not scaffold, not a re-proof.** dogfood-046/048/050 settled the
judge-catch saga; this run pivots cleanly onto context-rot and gives `chikory trace` its
**first live read on context-window pressure**: a real run's trace will now show
`pacing events N` and a durable, replay-safe `pacing` journal entry carrying the `action` +
projected/remaining tokens + utilization. The WP-245 seam-telemetry / WP-243 park-seam
journaled-event precedent was followed exactly — same `appendOnce` idempotency invariant, same
additive-renderer discipline (byte-identical no-pacing path).

**Residuals carried forward:**

- **WP-207 journaling+wiring half → DONE in code** (pacing decision wired into the live loop +
  journaled per step + surfaced as `pacing events N`). **F-53** (unobserved live) folds in as a
  minor follow-up. The **remaining** WP-207 work — *acting* on the decision to tune
  compaction/checkpoint **cadence** — depends on the live compaction-execution trigger
  (**WP-203 S2 runtime**), which is itself blocked on the WP-202 store and is a non-pure LLM-call
  hand-design (TASK-PROTOCOL §4), i.e. operator-landed, not a dogfood headline.
- **F-52 → WP-245** — seam telemetry still owes its own live observation (same class as F-53).
- **F-51 → WP-249** — harvest-commit hygiene; this run's delivery is again **uncommitted** —
  when committed it should land in its own commit with a `Ref: run-id:` trailer.
- **F-50 → WP-248** — graded gate enforces behaviour + assertions but not all spec prose (the
  benign `stepIndex` reorder here is an example the rubric passed over — correctly, as it is
  behavior-safe).
