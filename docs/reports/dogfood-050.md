# dogfood-050 — WP-245: seam telemetry (the bad-diff judge-catch now journals)

- **WP:** WP-245 (journal + surface the bad-diff seam firing — seam telemetry) — F-47.
- **Date:** 2026-06-23
- **Spec:** `examples/dogfood/dogfood-050.yaml` (`dogfood-050-wp245-seam-telemetry`)
- **Run-id:** `run-55eb5422-57f4-41b6-bec1-d91e24408b96`
- **Landed commit:** _uncommitted on the working tree_ (harvest byte-IDENTICAL to the run workspace — see §Independent verification; left for the operator to commit per F-51/WP-249 hygiene).
- **Runtime:** HEAD at launch `a4e9665`
- **Gate verdict (pre-launch):** ✅ PROCEED
- **Verdict:** 🟢 **SUCCESS in 1 step — clean one-shot, delivery verified independently.**

## Vibe check (plain English)

The deterministic "bad-diff" judge-catch seam (WP-244) — the mechanism that
overwrites a correct file with a wrong-but-compiling one *after* the executor finishes
so the real-time judge is forced to catch it — used to fire **silently**: it flipped an
in-memory flag and wrote the bad file but **wrote nothing to the journal**. So
`chikory trace` showed `injections 0` (an *unrelated* counter for operator-guidance
prompt injections) and the most important catch in the whole product was invisible —
proving dogfood-046/048 were *seeded* catches (not a natural in-progress→fix two-step)
required hand byte-diffing three artifact blobs. This run makes the seam emit a
**durable, replay-safe `seam` journal entry** and makes `chikory trace` print
`seams fired N`. The `codex`/`gpt-5.5` executor wrote all seven files correctly on the
first try (the six the spec named + the entailed `schemas.ts` Zod-enum mirror); the
catch machinery is now self-documenting in the trace.

## Trace excerpt

```
run run-55eb5422-57f4-41b6-bec1-d91e24408b96 · SUCCESS · 1 steps · $1.03 / $5.00 · 3m 59s · executor codex(openai) · judge openai-compat
 #   step                                 tokens(in/out)   cost     verdict
 1   Implemented WP-245 / F-47 seam tele… 770k/6.5k        $1.03    ✓ PROCEED (1/1 criteria)
totals: decisions 1 · judge passes 1 ($0.01, 0.7%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 1 · feedback frequency 1/1 steps
        issues found 0 · changes made 1 (issues:changes 0:1)
```

| Metric | Value |
| --- | --- |
| Terminal state | 🟢 SUCCESS (1 step, `max_steps` 8) |
| Total cost | **$1.0340** exact (`$1.03` header) / $5.00 budget = **20.6%** |
| Step 1 cost / tokens | $1.0264 · **770k in / 6.5k out** · 3m 43s · **30 tool calls** · diff 7403 bytes |
| Judge pass #1 | `openai-compat/gemini-3.1-pro-preview` · **$0.0076** · 9153 evidence bytes · 16s · ✓ PROCEED (1/1) |
| Judge share | **0.7%** (cap was 50%) |
| Duration | 3m 59s |
| Family diversity | 🟢 `codex`/**openai** executor vs Google `gemini-3.1-pro-preview` judge |
| Checkpoint | `run-55eb5422-…@3` · commit `dc62119ef563` · lastGood true |
| Probe step (F-11) | none — no empty-diff step this run |

**Acronyms / terms:** *WP* = work package (a unit on `plan.md` §6). *AC* = acceptance
criterion (the machine-graded `check` the judge re-runs). *Seam* = the
`debug.seedBadDiff` injection that deterministically corrupts a file after the executor
finishes, forcing the judge to catch a regression on demand. *`appendOnce`* = the
journal's idempotent write keyed on an index, so a Temporal **replay** never
double-writes the same entry. *Family diversity* = executor and judge from structurally
different model families (bias mitigation, a core thesis invariant). *Probe step (F-11)*
= a wasted empty-diff step that still costs tokens.

## Delivery quality (human review, post-landing)

🟢 **The landed code is correct and matches the spec line-by-line across all seven files**
(the spec named six; the seventh, `schemas.ts`, is the trivially-entailed runtime-schema
mirror of the new union member — see below).

- `src/types.ts:328` — `"seam"` added to the `JournalEntryKind` union, in the per-run
  group right after `"terminal"`. Additive only; nothing else in the union changed. ✓
- `src/schemas.ts:378` — `"seam"` added to the `JournalEntryKindSchema` **Zod enum**
  (the runtime mirror of the union). **Not named in the spec, but trivially entailed and
  actually required**: `journal.appendOnce({ kind: "seam", … })` validates against this
  Zod enum at runtime, so without it the seam write would throw. The executor correctly
  inferred it; the judge allowed it under `scope_matches_instruction ✓`. A spec-authoring
  lesson (name the schema mirror when adding a `JournalEntryKind`), not a defect. ✓
- `src/runner/activities.ts:757` — new `recordSeamEvent(input)` activity, modeled
  byte-for-byte on `recordBudgetEvent`: `openJournal(deps, input.runId)`,
  `journal.appendOnce({ field: "seamEventIndex", value }, { kind: "seam", payload: { seamEventIndex, atStep, path, byteCount }, costDeltaUsd: 0, artifactRefs: [] })`,
  `journal.close()` in a `finally`. JSDoc cites WP-245 / F-47. The payload carries the
  bad-diff content's **byte count**, never the content (CM-3 keeps payloads <8KB). ✓
- `src/workflow/agent-loop.ts:104` — `let seamEventIndex = 0;` next to the existing
  `budgetEventIndex`/`badDiffInjected` counters; `:325` — the `recordSeamEvent` call
  sits **inside** the existing `if (!badDiffInjected && spec.debug?.seedBadDiff?.atStep === stepIndex)`
  guard, right after `seedBadDiff`, so it fires exactly once. `byteCount` =
  `spec.debug.seedBadDiff.content.length`. The seam-fire condition and the `seedBadDiff`
  activity are untouched. ✓
- `src/cli/trace.ts:170,204` — `const seams = entries.filter((e) => e.kind === "seam").length;`
  and an additive ` · seams fired ${seams}` appended to the `injections … · checkpoints …`
  sub-line **only when `seams > 0`** — the no-seam path stays byte-identical (the WP-218
  additive-telemetry convention). No other totals line touched. ✓
- `test/runner/seam-journal.test.ts` (NEW, 53 lines, Temporal-free) — constructs a
  `new Journal(":memory:")`, `createRun`, `appendOnce` the same `seam` entry **twice**
  with the same `{ field: "seamEventIndex", value: 0 }` key, asserts
  `expect(journal.entries("seam")).toHaveLength(1)` (idempotency under replay) and that
  the single entry's `byteCount` round-trips (`18`). ✓
- `test/cli/trace.test.ts` (+16 lines, +1 case) — a journal with a `seam` entry renders
  `seams fired 1`; a journal with no `seam` entry does **not** render `seams fired`. ✓

**Independent verification (not the run's own green):**

- `dogfood-verify.sh` §3 re-ran AC-1 against the working tree: **PASS, exit 0** — the five
  grep-pins (`seams fired 1`, `toHaveLength(1)`, `recordSeamEvent` ×2 sources, `"seam"`
  payload literal) + `vitest` 20/20 + `tsc --noEmit` + `eslint .` all clean.
- §5 byte-diff: all **7** changed files **IDENTICAL** to the run workspace — the harvest
  did not diverge from what ran.
- Full SDK suite re-run by hand: **🟢 451 passed | 19 skipped (470)**, 19.49s — crucially
  including `verdict-gating.test.ts` **"seedBadDiff ARMED"** (1100ms) and
  `crash-recovery.test.ts` (16.5s). The ARMED test exercises the seam-fire guard, which
  now calls `recordSeamEvent` — it still passes, confirming the new activity is registered
  in the real Temporal harness, not just unit-mocked.
- **Scope discipline:** the run touched exactly **7 files** — the 6 the goal names plus
  the entailed `schemas.ts` Zod-enum mirror (judge rubric `scope_matches_instruction ✓`);
  `git status --short` shows only those 7, nothing out of scope.

## New friction

🟢 **No new friction from the run mechanics themselves.** Cost telemetry non-zero and
sane ($1.0264 step, $0.0076 judge, both models priced); no filler/probe step (F-11 did
not recur); the judge executed its check (`exited 0`); rubric justifications sane;
family diversity real (`codex`/openai vs Google `gemini-3.1-pro-preview`); single
checkpoint `lastGood true`; no duplicate journal entries. The one-shot SUCCESS is honest
data — a cross-file vertical (7 files, replay-safe idempotency + additive renderer) the
executor got right first try.

**F-52 → folds into WP-245 (minor residual, 🟢).** The seam telemetry is **unit-proven**
(the new `seam-journal.test.ts` proves the journal-write idempotency + payload
round-trip, and the ARMED Temporal test confirms the activity is registered) but it has
**not yet been observed live** — no run has produced a `chikory trace` actually printing
`seams fired 1`, because this dogfood **instruments** the seam, it does not **arm** it
(`injections 0`, `seams fired 0` on its own trace, by design). The cleanest closure is
*not* a fresh scaffold-hosted armed re-run (the dogfood-046/047/048 anti-pattern the
loop is steering away from): the next time an armed seam dogfood runs for an independent
product reason, confirm its trace reads `seams fired 1`; or add a one-line assertion to
`verdict-gating.test.ts` "seedBadDiff ARMED" that `journal.entries("seam")` is non-empty
after the seam fires. Tracked as a WP-245 follow-up, not a new headline.

**Token economics (baseline data for WP-203/WP-207):** **770k input / 6.5k output** for
a 7.4KB cross-file diff over **30 tool calls** — the series high (prior: 387k dogfood-049,
525k dogfood-046, 757k dogfood-045, 793k dogfood-037), consistent with a 6-file edit
needing more repo reads than a single pure function. This is the standing #1 data point:
every run reads hundreds of thousands of input tokens for tiny diffs, and **nothing in
`chikory trace` surfaces context-window pressure** — which is exactly what the chosen
next headline (WP-207 pacing telemetry, dogfood-051) pays down.

## Verdict on the thesis

🟢 **Net-positive, on-pillar, pays down real observability debt on the judge-catch
pillar — not a re-proof of a settled mechanism.** dogfood-046/048 already proved the
true-positive catch (per-run and chain-level); this run did **not** re-prove it. It made
the catch **self-documenting**: a real run's `chikory trace` will now show `seams fired N`
and a durable `seam` journal entry, so "was the catch a *seeded* deterministic
regression?" is answerable from telemetry instead of three-blob byte-archaeology. The
WP-243 park-seam precedent (`recordBudgetEvent`, journaled `cause:"debug"`) was followed
exactly — same idempotency invariant, same additive-renderer discipline.

**Residuals carried forward:**

- **F-47 → WP-245: CLOSED in code** (seam now journals a durable replay-safe `seam`
  entry + `chikory trace` surfaces `seams fired N`). **F-52** (unobserved live) folds in
  as a minor follow-up.
- **F-48 → WP-247** — the pure `describeSeamArming` decision landed (dogfood-049); the
  **structural** launcher guard + banner wire are still owed (frozen-launcher edits,
  TASK-PROTOCOL §4 follow-ups).
- **F-50 → WP-248** — graded gate enforces behaviour + assertions but not all spec prose.
- **F-51 → WP-249** — harvest-commit hygiene (separate run-diff from operator hand-edits
  + stamp `Ref: run-id:`). This run's delivery is still **uncommitted** — when committed,
  it should land in its own commit with the run-id trailer.

**Top next (dogfood-051): WP-207 pacing telemetry** — the seam saga is settled, so the
loop moves onto the most-cited *unsolved* pillar: **context-rot**. The pure
`decideContextWindowPacing` decision already exists (dogfood-031) and is unit-tested, but
it is **never wired into the live agent loop and never journaled** — `kind:"pacing"`
exists in `types.ts` and falls to the trace `default` case; nothing emits it. This is the
**identical gap-pattern WP-245 just fixed for seams**, and FA-3/SE-2 explicitly name the
remaining work as "using that decision in planner/runner cadence and journaling." Wiring
it gives `chikory trace` the **first live observability on the token-economics problem**
that every report has flagged for 50 runs.
