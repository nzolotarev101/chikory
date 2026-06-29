# dogfood-062 — WP-202 Memory Pointer RECALL primitive (the pure READ half)

- **WP:** WP-202 (Memory Pointer store, 🟡) — the documented `store.excerpt` **recall path**, the READ half of the Memory Pointer Pattern (CLAUDE.md core concept: "store large tool outputs externally, pass short refs into context"). Lands the exact inverse of the already-landed `formatPointerReference` (write half, dogfood-028) plus a recall helper that dereferences through an INJECTED excerpt function (the `deps.runCheck` DI pattern → hermetic test, no real `ArtifactStore`). The non-pure agent-loop wiring that calls the real `store.excerpt` is the SEPARATE §4 follow-up — exactly as `formatPointerReference` preceded its interception wiring.
- **Date:** 2026-06-29
- **Spec:** `examples/dogfood/dogfood-062.yaml` (`dogfood-062-wp202-memory-pointer-recall`)
- **Run-id:** `run-01add160-0b20-49ed-9af1-6598c6c558ae` (runtime HEAD `c6f1b32`)
- **Landed commit:** none yet — delivery is **STAGED** (`M` in index) on the working tree, byte-IDENTICAL to the run workspace (pack §5 = `IDENTICAL` ×3), pending the operator's harvest commit.
- **Gate verdict (pre-launch, recorded in the spec header):** ✅ **PROCEED** — §1.1 ✅ (cross-file `memory-pointer.ts` + `index.ts` barrel + `memory-pointer.test.ts`, 1–3 steps, real parsing failure surface: em-dash split, `B` suffix, idPrefix, null-on-malformed, round-trip — NOT a 1-file deterministic port) · §1.2 ✅ (real open plan.md §6 WP-202 🟡 product code on the named Memory Pointer Pattern thesis pillar — the documented recall remainder, dereferencing the real `ArtifactRef`/`ArtifactStore.excerpt` surface; NOT invented scaffolding) · §1.3 ✅ PROCEED (the core context-rot mitigation this run's own pacing pressure motivates; UNBLOCKED and not §4-walled — pure primitive + injected excerptFn; alternatives blocked or non-headline: WP-249 remainder = track-B harvest tooling, the secret/dependency OVERRIDE + WP-210 act + WP-250 are §4-walled, WP-251 needs delicate multi-step seam tuning).

## Trace (excerpt)

```
run run-01add160-0b20-49ed-9af1-6598c6c558ae · SUCCESS · 1 steps · $0.44 / $5.00 · 2m 52s · executor codex(openai) · judge openai-compat
 #   step                                 tokens(in/out)   cost     verdict
 1   Summary: WP-202 READ support is lan… 319k/3.6k        $0.44    ✓ PROCEED (2/2 criteria)
totals: decisions 1 · judge passes 1 ($0.01, 1.9%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 1 · pacing events 1 · peak window 162% (compact 1 · park 0) · feedback frequency 1/1 steps
        issues found 0 · changes made 1 (issues:changes 0:1)
        components over time: s0 j@0
```

| Metric | Value |
| --- | --- |
| Terminal state | 🟢 SUCCESS (1 step, `max_steps: 4`) |
| Executor / judge | `codex`/`openai` (`gpt-5.5`) · judge `openai-compat`/`gemini-3.1-pro-preview` (structurally different family ✓) |
| Step-1 tokens | **319,000 in / 3,600 out** · 12 tool calls · 2m 14s |
| Step-1 cost | **$0.4353** (estimated) · diff `4f6fb4c4b594` · 5,564 bytes |
| Judge pass #1 | $0.0083 · 19,033 evidence bytes · 37s · ✓ PROCEED (2/2 criteria, 0 rubric failures) |
| Total cost | **$0.4436** (exact sum, steps + judge) = **8.8%** of $5 budget · judge share **1.9%** |
| Checkpoint | `…@4` · commit `74f14032ca37` · `lastGood true` (1 checkpoint, no resume) |
| Pacing | 1 event · journaled `action compact · projectedTokens 646,090 · remainingTokens -246,090 · utilization 1.615225` → `peak window 162% (compact 1 · park 0)` |

**Acronyms:** **WP** = work package (a plan.md unit of work). **AC** = acceptance criterion (a judge-executed `check`). **F-n** = globally-numbered friction finding. **harvest** = landing the run's workspace diff onto `main`. **DI** = dependency injection (here: the `excerptFn` argument, so the test needs no real store). **Compact / park** = the two context-window-pressure pacing branches — `compact` folds history at the checkpoint; `park` declines to start the next step. **Window occupancy** = how full the calibrated context window is.

---

## Delivery quality (human review, post-landing)

🟢 **Textbook one-shot, exactly to spec.** Three named files changed, nothing else (`git status --short` = the 3 files; harvest byte-diff §5 = `IDENTICAL` for all three). Line-by-line against the `goal`:

- `src/runner/memory-pointer.ts`:
  - New exported **local** `ParsedPointerReference` interface (`kind`/`idPrefix`/`bytes`/`summary`) with the mandated JSDoc — added to this module, NOT `types.ts`. ✓
  - `parsePointerReference(line): ParsedPointerReference | null` — regex `/^\[memory ([^\s]+) ([^\s]+)\] ([0-9]+)B — (.*)$/u`: non-space `kind`/`idPrefix`, `[0-9]+` digits + literal `B`, the literal U+2014 `" — "` separator the renderer emits, greedy `(.*)` summary (MAY be empty, MAY contain spaces or `—`), `Number.parseInt(bytes, 10)` on match, `null` otherwise. The `u` flag matches the em-dash literally. **Exact inverse** of `formatPointerReference` — round-trips. ✓
  - `recallPointerExcerpt(line, excerptFn)` — parses via `parsePointerReference`; `null` ⇒ return `null` WITHOUT calling `excerptFn`; else `await excerptFn(parsed.idPrefix, parsed.bytes)`. Matching JSDoc. ✓
- `src/index.ts`: the existing memory-pointer re-export (index.ts:115) extended in place to add `parsePointerReference`, `recallPointerExcerpt`, and `type ParsedPointerReference`; nothing else in the barrel touched. ✓
- `test/runner/memory-pointer.test.ts`: five new cases covering goal (a)–(e) — round-trip an `ArtifactRef` (`idPrefix` = `id.slice(0, 12)`), a hand-written multi-word-summary line, three malformed lines null (missing `B`, missing `[memory ]` prefix, hyphen-not-em-dash separator), `recallPointerExcerpt` returns the injected `vi.fn` spy value asserting `toHaveBeenCalledWith("abc123def456", 8192)`, and the malformed-input no-call path. No existing assertion weakened (the `expect(ref).toEqual(original)` round-trip context is preserved). ✓

**Independent re-gate (pack §3):** AC-1 PASS (exit 0 — 5 grep-pins on the mandated symbols across all 3 files + scoped `vitest memory-pointer.test.ts` = 10 passed) · AC-2 PASS (exit 0 — `tsc --noEmit && eslint . && vitest run` = 510 passed | 19 skipped across 78 files). No new dependency; `shouldPointerize`/`formatPointerReference`/`MemoryPointerPolicy`, `types.ts`, and every contract untouched. Purely additive.

**Anomaly checklist:** no wasted/filler steps (1 step, `changes made 1`, `issues:changes 0:1`). Cost telemetry healthy — `$0.4353` step + `$0.0083` judge, both nonzero and priced (no `.00`/F-9; `gpt-5.5` + `gemini-3.1-pro-preview` both in `pricing.ts`). Judge checks genuinely executed (`exited 0` recorded for both ACs), rubric justifications sane (4/4: tests_pass, no_unrelated_deletions, no_secrets_introduced, scope_matches_instruction), family diversity real (Google `gemini-3.1-pro-preview` judge ≠ OpenAI `codex`/`gpt-5.5` executor via the keyless shim). No escalate/rollback/injection. Loop integrity clean: 1 checkpoint `lastGood true`, no resume, single journal. The empty-diff probe step (F-11) did not recur (`s0 j@0`; pack §7 = "none detected").

## Token economics + pacing (data point for WP-254 / WP-203-204)

319,000 in / 3,600 out for the single step — well below the series-high (dogfood-061 965k; the lighter task ⇒ 12 tool calls vs 27). The journaled pacing event is the notable read:

- `action compact · projectedTokens 646,090 · utilization 1.615225` → `peak window 162%` (`646,090 / 400,000`, the `gpt-5.5`-calibrated denominator WP-252 fixed; the `compact` branch, not the `park` branch dogfood-061 hit at 486%).
- **The compaction was SPURIOUS — a clean WP-254 numerator data point.** The step's TRUE window occupancy was 319k / 400k = **80%, under the window** — the provider accepted the prompt with no pressure. Yet `projectedTokens` reads **646,090 ≈ 2 × 319k**: the standing WP-254 defect feeds `(spentTokens + estimatedNextStepTokens)` — each ≈ the same single black-box `codex` step's cumulative `tokens_in` — and doubles it, so a comfortably-fitting step is scored at 162% and a `compact` fires under no real pressure. The denominator (400k) is correct (WP-252 closed); the NUMERATOR still over-reads. Reinforces WP-254; no change to that WP's priority.

## New friction

**None this run.** The run is a clean additive one-shot exactly to spec, like dogfood-043. Two existing items are reinforced (no new F-number, no new WP):

- **F-58 / WP-249 (reinforced, stays 🟡).** The delivery is again **STAGED on the working tree** with no `Run-ID:` trailer and harvested outside `chikory land --verify` — the exact harvest-bypass F-58 names. The acceptance re-gate clause (c) that dogfood-061 landed lives in the product `chikory land` path, but this run's harvest (like every dogfood harvest) does not route through it. No new evidence beyond what F-58/WP-249 already capture; the track-B harvest-tooling adoption remains the open remainder.
- **WP-254 (reinforced).** The spurious 162% `compact` above is a fresh data point that the pacing numerator over-reads on `codex` steps even when true occupancy is comfortably under the window. Already an open 🟡 WP; this is corroborating data, not a new finding.

## Verdict on the thesis

🟢 **Strong.** The judge (Google `gemini-3.1-pro-preview`) independently executed both acceptance checks against the run's clone — 5 grep-pins forcing the exact symbols into all three files, the scoped suite, then the full `tsc + eslint + vitest` sweep — and PROCEEDed only after all exited 0, on a structurally different model family from the OpenAI `codex` executor. The Memory Pointer Pattern's READ half (parse a context-facing pointer line back to its fields + dereference through an injected excerpt source) is the direct context-rot mitigation, and this run's own spurious-`compact` pacing read is a live reminder of why the pattern matters: the loop is already paying compaction cost on `codex` steps, so externalizing large tool outputs behind short refs is on the critical path. Pure-first slice landed cleanly; the non-pure `store.excerpt` wiring is the next §4 hand-design step.
