# Dogfood-048 — THE chain-level Agent-as-a-Judge true-positive catch, ARMED and PROVEN (durable chain pillar 🟢 + judge-catch pillar 🟢) — 🟢

> **Vibe check:** dogfood-047's headline failed because the bad-diff seam was
> launched *disarmed* — the judge never saw a regression, so the chain-level
> catch was never exercised. This run is the armed re-attempt, and it worked
> exactly as the thesis predicts: inside a **dependent node of a durable chain**,
> the judge's real-time test caught a seeded regression **before it could seal
> SUCCESS**, the executor read the failing test and fixed it, and the chain
> closed **SUCCESS 2/2**. This is the **first chain-level regression the judge
> caught pre-land** — the §1.1 KPI proven one level up from the single-run
> dogfood-046. Both of dogfood-047's gaps were closed at spec-authoring time:
> **F-48** (the four `CHIKORY_SEED_BAD_DIFF_*` vars were baked into the launch
> header and verified armed post-run) and **F-49** (each AC `check` `grep`s the
> spec's mandated literal assertions before vitest, so the executor cannot
> rewrite the gate to match a spec-deviating impl).

**WP**: WP-246 (per-node bad-diff seam wiring — now **DOGFOOD-PROVEN**) · escalation target JD-3 / IF-2 (Agent-as-a-Judge true-positive catch, **inside a chain**) + WP-219 (durable multi-run chains) · **Date**: 2026-06-23 (run 2026-06-23 UTC) · **Spec**: [`examples/dogfood/dogfood-048.yaml`](../../examples/dogfood/dogfood-048.yaml) · **Chain-id**: `chain-b7665e97-0416-4638-bba5-71e66293d5ea` · **Child runs**: `…-node-node-a`, `…-node-node-b` · **Runtime under test**: `3fc27bb` (WP-246 chain seam) · **Outcome**: 🟢 **chain SUCCESS 2/2 — the chain-level judge-catch FIRED, was caught pre-land, and self-corrected** · **Harvested delivery**: 4 files (`truncate-decimals.ts`/`.test.ts`, `truncate-to-cents.ts`/`.test.ts`), landed `2c516d5`

---

## What this run proved

The escalation dogfood-046 (single-run judge-catch) was supposed to reach was:
the same deterministic catch, but **inside a dependent node of a durable
multi-run chain** — stressing two thesis pillars at once (durable execution
WP-219 + the judge true-positive catch WP-244/246). dogfood-047 attempted it but
was launched disarmed (F-48). This run armed it and it landed:

- **Node A** (independent predecessor, no seam): wrote a correct pure
  `truncateDecimals` → judge PROCEED 1/1 → **SUCCESS in 1 step**. A real node
  doing real work.
- **Node B** (dependent consumer): step 0 wrote a **correct** `truncateToCents`
  importing node A's `truncateDecimals`. The WP-246 seam
  (`CHIKORY_SEED_BAD_DIFF_NODE_INDEX=1`, `atStep:0`) then overwrote
  `truncate-to-cents.ts` with the compiling-but-wrong `return value;` **after the
  executor finished, before the judge ran**.
- The cadence-1 judge re-ran AC-2's `grep`+`vitest` check against the corrupted
  working tree → **`vitest` exited 1** → deterministic override → **AC-2 FAILED
  (0/1 criteria) → node B refused to seal SUCCESS. THAT is the chain-level
  catch.**
- The failing-test feedback reached node B's executor, which **restored a correct
  `truncateToCents`** at step 1 → AC-2 `exited 0` → **node B SUCCESS** → **chain
  SUCCESS 2/2**.

### Proof the seam armed (closes F-48)

Node B's `task_json` carries the seam config — verified, not assumed:

```json
"debug": { "seedBadDiff": {
  "atStep": 0,
  "path": "packages/sdk-ts/src/util/truncate-to-cents.ts",
  "content": "export function truncateToCents(value: number): number { return value; }"
}}
```

…and node B took **2 steps** (caught → fixed), not the 1-step clean SUCCESS that
betrayed dogfood-047's disarmed launch.

### Proof the catch was a real deterministic seeded regression (from artifacts)

- **Node B step-1 executor diff** (`8f71dc821114`, 1468 B): a **correct**
  `truncateToCents` importing `truncateDecimals(value, 2)`.
- **Node B step-2 diff** (`c60b86aefa6d`, 518 B): its base is
  `export function truncateToCents(value: number): number { return value; }`
  — i.e. the **seeded corruption was on disk at step-2 start** — replaced with the
  correct import-based impl. This is the executor reading the judge's failing-test
  feedback and fixing it.
- The grep-pinned assertions (`truncateToCents(9.999)…9.99`,
  `truncateToCents(1.239)…1.23`) stayed present through **both** steps — the seam
  corrupts only the impl, never the test (closes F-49: the executor could not
  weaken the gate).

---

## Trace evidence

### Node A — `chain-b7665e97-…-node-node-a` · SUCCESS · 1 step · $0.66 / $6.00 · 2m 33s

| # | step | tokens (in/out) | cost | verdict |
|---|------|-----------------|------|---------|
| 1 | Implemented node A `truncateDecimals` | 490k / 4.8k | $0.66 | ✓ PROCEED (1/1) |

- judge pass #1 · `gemini-3.1-pro-preview` · $0.0042 · AC-1 judge-executed check `exited 0`; all 4 rubric clauses ✓. checkpoint `e02d856a7f52` lastGood.

### Node B — `chain-b7665e97-…-node-node-b` · SUCCESS · 2 steps · $0.97 / $6.00 · 4m 13s

| # | step | tokens (in/out) | cost | verdict |
|---|------|-----------------|------|---------|
| 1 | Implemented `truncateToCents` → **seam corrupts it** | 439k / 4.9k | $0.60 | ✓ PROCEED (**0/1** — AC-2 `exited 1`, **THE CATCH**) |
| 2 | Fixed the corrupted `truncateToCents` from failing-test feedback | 273k / 2.5k | $0.37 | ✓ PROCEED (1/1 — AC-2 `exited 0`) |

- judge pass #1 · $0.0050 · AC-2 judge-executed check `exited 1`; rubric `tests_pass ✗` (1/1 checks failed), other 3 ✓. `verdict: PROCEED (0/1)` rationale *"work in progress, no regressions — unmet criteria: AC-2"*. checkpoint `665d638b6aa7` lastGood.
- judge pass #2 · $0.0042 · AC-2 `exited 0`; all rubric ✓. checkpoint `dafe57954a50` lastGood.

**Chain totals:** node A $0.6642 + node B $0.9739 = **$1.6381**; judge share node A 0.6% / node B 0.9%; ~6m46s wall; executor `codex`/`openai` (`gpt-5.5`) vs judge `openai-compat`/`gemini-3.1-pro-preview` (Google) — **family diversity real**. No probe step (F-11 did not recur). No rollbacks, no escalations.

---

## Delivery quality (human review, post-landing)

Harvested into `2c516d5` (4 deliverable files + bundled DOGFOODING/skill guideline
edits). Independently re-run against the working tree in devbox — **both ACs PASS**:

- **AC-1** `exited 0` — `grep` (both mandated literals) + `vitest` (5/5) + `tsc` + `eslint` all green.
- **AC-2** `exited 0` — `grep` (both mandated literals) + `vitest` (3/3) + `tsc` + `eslint` all green.

Line-by-line vs the spec `goal`:

- `truncateDecimals(value, digits)` — named export only, `RangeError` on
  non-`Number.isInteger`/negative `digits`, `Math.trunc(value*10**digits)/10**digits`
  truncation, JSDoc present. ✅ matches spec verbatim.
- `truncateToCents(value)` — named export only, imports `truncateDecimals` from
  `./truncate-decimals.js`, returns `truncateDecimals(value, 2)`. ✅ behaviour
  matches spec. **⚠️ the spec-mandated "short JSDoc" is absent** — node B's
  *correct* step-0 impl had a JSDoc, but the step-2 fix restored behaviour
  without it (**F-50**, minor).
- Scope: only the four named files touched; no contract/CLI/chain-runner/dep
  changes. ✅

---

## Anomaly review

- **🟢 The headline fired and was caught pre-land** — node B's AC-2 went red at
  the step-0 judge pass (`vitest exited 1`), the deterministic override blocked
  the SUCCESS seal, and the bad change was **never sealed**. First chain-level
  true-positive catch.
- **F-48 CLOSED** — seam armed (verified `debug.seedBadDiff` in node B
  `task_json`, node B ≥2 steps). The disciplined fix (env baked into the spec
  header + post-run verification) worked; the structural guard (**WP-247**)
  remains queued to make it robust without operator discipline.
- **F-49 CLOSED** — the AC `check` `grep`-pinned the mandated literals verbatim;
  the executor kept every assertion through catch+fix, so the gate measured the
  spec, not the executor's self-authored tests. The cheapest WP-248 fix (a)
  (grep-pin in the `check`) is **validated inline**; the read-only spec-owned test
  file (b) remains the fuller form.
- **🟡 F-50 (new) — the graded gate enforces behaviour + assertions, not all spec
  prose.** The mandated "short JSDoc" was dropped from node B's landed impl and
  nothing failed: the `grep`+`vitest`+`tsc`+`eslint` gate cannot see a missing doc
  comment, and the LLM judge scored `scope_matches_instruction ✓`. Residual sliver
  of the F-49 class (the gate measures what it can execute). **No new WP — folds
  into WP-248** (broaden the spec-fidelity check); 🟢 cosmetic, behaviour correct.
- **Wasted/filler steps:** none. Node A 1 productive step; node B 2 (catch + fix),
  both productive. No empty-diff probe (F-11 did not recur).
- **Cost telemetry:** all steps nonzero and `costEstimated:true` (codex adapter
  returns estimated, not provider-billed, cost — pre-existing, not F-9: F-9 was
  `.00` with nonzero tokens, not seen here). Judge passes priced
  ($0.0042–$0.0050). Budget gate live (16.2% of node B's $6).
- **Token economics:** input ~490k (A) / 439k (B s1) / 273k (B s2) per step for
  ~20-line functions — the codex executor rehydrates broad repo context each step;
  baseline data for WP-203/WP-207. Output tiny (2.5k–4.9k).
- **Judge behavior:** judge-executed checks ran in-workspace with real exit codes
  (`exited 1` then `exited 0`); no hallucinated concerns, no false
  ESCALATE/ROLLBACK; family diversity real (Google judge vs OpenAI executor). The
  catch came from the judge-**executed** test, not the LLM's diff read — consistent
  with dogfood-046 and the CLAUDE.md invariant *Agent-as-a-Judge runs tests, not
  text grading*.
- **Loop integrity:** node B journal idx 0–8 (step/judge/verdict/checkpoint ×2 +
  terminal), no duplicates, both checkpoints `lastGood`, node B base = node A head
  (WP-239 handoff intact — node B imported node A's `truncateDecimals`), seam fired
  **once** (the step-2 fix was never re-corrupted). Clean.
- **Seam telemetry still invisible in the trace (F-47 reinforced):** node B's
  totals line still reads `injections 0` despite the seeded catch — the seam fires
  with no journaled entry, so the proof above required hand-inspecting `task_json`
  + three diff blobs. **WP-245** (journal + surface the seam firing) is freshly
  re-validated as needed: the most consequential catch yet is still invisible to
  `chikory trace`.

---

## New friction

**F-50 — the graded acceptance gate enforces behaviour and graded assertions, but
not all spec-mandated prose (e.g. JSDoc).** Node B's landed `truncateToCents`
dropped the spec's required "short JSDoc" (the step-2 fix restored the import +
return but not the doc comment), and the gate
(`grep`+`vitest`+`tsc`+`eslint`) plus the LLM judge (`scope_matches_instruction ✓`)
all passed. This is the residual of the F-49 class — the gate measures what it can
execute, so non-executable spec requirements slip through. Behaviour was correct
and the run is a 🟢 thesis win, so this is **cosmetic**. → **No new WP; folds into
WP-248** (when WP-248 broadens the gate to spec-authored assertions, extend the
spec-fidelity check or the judge rubric to flag mandated-prose omissions such as
JSDoc). Cheapest partial: add the JSDoc marker to the grep set when a spec mandates
it.

---

## Verdict on the thesis

🟢 **The two highest-value pillars now hold together, on demand, in a chain.** The
real-time Agent-as-a-Judge true-positive catch — a judge blocking a genuinely wrong
diff *before* it lands — is now proven **inside a dependent node of a durable
multi-run chain**, not just a single run (dogfood-046). The catch was deterministic
(seeded, not luck), fair (the executor wrote correct code; the seam corrupted it
post-hoc; the test it could not rewrite caught it), family-diverse (Google judge vs
OpenAI executor), and self-correcting (the executor fixed from the failing-test
feedback). dogfood-047's two gaps are closed: **F-48** (armed + verified) and
**F-49** (grep-pinned spec assertions). **WP-246 → 🟢 DOGFOOD-PROVEN.**

Two honest residuals: **(1)** the seam still fires with **zero journaled
telemetry** — `injections 0` masks the most important catch yet, so the proof
survives only by manual artifact archaeology (**F-47 → WP-245**, now top-priority
observability debt); **(2)** the operational arming still relies on **manual
discipline** (the spec header baked the env in this time, but nothing in the
launcher refuses a disarmed seam-spec — **F-48 → WP-247**). The next headline
should pay down one of these two observability/operability debts on real product
code, not re-prove the now-settled catch on fresh scaffolding.
