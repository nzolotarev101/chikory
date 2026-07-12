# dogfood-099 — WP-308 (work-conserving limit scheduler) COMPLETE — the seam now EXECUTES the decision (F-136 fixed)

- **Vibe check (plain):** dogfood-098 built the *brain* that, on an LLM usage limit, decides "switch endpoint" / "do other useful work" / "park" instead of sleeping — but the run loop only *recorded* that choice and faked the throttled step as done. This run built the *hands*: a net-new `applyLimitResponse` (the function that carries out the choice) so a forced-limit run actually re-dispatches to a failover endpoint, or does real limit-independent work and comes back to the throttled item later — no more fabricated "complete with zero work." It landed unattended in 6 durable steps, every step passed the quality-gate judge, and a live in-memory proof shows a forced-limit run sealing SUCCESS with conserved work > 0 and every plan item genuinely done. WP-308 (work-conserving limit scheduler) is now 🟢 done.
- **Bottom line:** delivery 🟢 (all 4 ACs re-pass, **850 TS tests green**, all 11 harvested files byte-IDENTICAL) · Thesis-KPI 🟢 (end-to-end forced-limit run seals SUCCESS, `conserved 5000ms > 0`, `slept 0`, throttled item deferred-then-done, not skipped) · judge catches: **0** (clean completion run, no seeded bad diff) · WP-308 **🟢 DONE**.

## Run at a glance — `run-03cd4c21-68f9-4aa8-8a9a-6157868b0843`

| field | value |
|---|---|
| Outcome | 🟢 SUCCESS · 6 steps · **$13.85 / $45** (30.8%; exact steps+judge sum $13.8447) · **36m 54s** wall-clock |
| Executor / Judge | codex(openai) / gemini-3.1-pro-preview via openai-compat (family-diverse ✓, invariant #2 held) |
| Spec | `examples/dogfood/dogfood-099-wp308-limit-response-execution.yaml` (LOOSE, 6 ordered increments) |
| Host WP | WP-308 (work-conserving limit scheduler) — P3 intelligent-scaling track, the execution half owed after dogfood-098 |
| Landed | uncommitted (staged) on working tree — all 11 harvested `packages/sdk-ts` + `docs/components/router.md` files byte-IDENTICAL to the run workspace (pack §5) |
| **Judge** | **6/6 PROCEED** · 0 ROLLBACK · 0 escalations · $0.06 (0.5% share) · all 4 ACs judge-executed & exited 0 every pass |
| **Pacing** | `autoCalibrate` · peak window 158% (compact 5) · compactions 1 (pacing 1) · first pacing fold step 5 · pressure-steps 5 (unfolded 4) |

## Trace

```
run run-03cd4c21 · SUCCESS · 6 steps · $13.85 / $45.00 · 36m 54s · executor codex(openai) · judge openai-compat
 #   step                                        tokens(in/out)   cost     verdict
 1   Part 1 — honest step record (no fake done)  2017k/9.6k       $2.62    ✓ PROCEED (4/4)
 2   Part 2 — declared-failover re-dispatch      1639k/11k        $2.16    ✓ PROCEED (4/4)
 3   Part 3 — limit-independent work execution   1557k/12k        $2.06    ✓ PROCEED (4/4)
 4   Part 4 — durable park (retryAfter/At timer) 2359k/15k        $3.10    ✓ PROCEED (4/4)
 5   Part 5 — measured totals (executed, not book)1286k/8.9k      $1.70    ✓ PROCEED (4/4)
 6   Part 6 — live proof + router.md + full suite 1637k/9.8k      $2.14    ✓ PROCEED (4/4)
totals: decisions 6 · judge passes 6 ($0.06, 0.5%) · rollbacks 0 · escalations 0 · injections 0 · checkpoints 6
```

## Delivery quality (human review, post-landing)

**Scope discipline 🟢.** 12 files touched, all inside the sanctioned surface (`packages/sdk-ts/` + the one PART-6 `docs/components/router.md` edit). No `plan.md` write (F-135 lesson held). Two net-new files: `src/executors/limit-response.ts` (`applyLimitResponse`), `src/workflow/limit-park.ts` (`decideLimitParkDelay`).

**F-136 genuinely resolved 🟢.** The old fabricated-completion block in `activities.ts` (`status:"SUCCESS"`, `claimsComplete:true`, zero tool calls, empty diff) is DELETED and replaced by `applyLimitResponse(...)`. The regression test asserts the fix directly: `limit-response-activity.test.ts:145` now `expect(record.claimsComplete).toBe(false)` for the honest-record path; `:250` `expect(record.claimsComplete).toBeUndefined()` for executed independent work; `:401` park returns `status:"FAILED"` (retriable).

**All three decision branches EXECUTE, not journal:**
- **Declared-failover** (`applyLimitResponse.ts:74-96`): rebuilds the routing policy off the failover target (`routingFromFailoverTarget`) and calls `adapter.runStep` against it — real adapter call, real record.
- **Limit-independent-work** (`:105-160`): runs the decision's target-stage work (`limit-independent <stage> work before retrying: <item>`), strips `claimsComplete`, journals `deferredPlanItem` so the loop returns to the throttled item — deferred, not dropped.
- **Park-until-reset** (`:162-`): defers via a workflow-side durable timer. `agent-loop.ts:327` `parkForLimitReset` uses the same durable `sleep` as soak (import line 16), never an activity sleep; records a `control_event` `source:"limit"` on resume.

**PART-6 live proof is real, not a toy 🟢** (`agent-loop.test.ts:337` "forced limit response conserves work and seals SUCCESS only after every chunk runs"): `CHIKORY_LIMIT_AT_STEP=0` forces a limit at step 0 → scheduler picks limit-independent review-stage work (other family) → step-1 writes the conserving work, the throttled parser chunk is **deferred to step 2 and actually done**, CLI chunk at step 3 → seals SUCCESS with journal totals `limitSignals:1, limitSleptMs:0, limitSleepConservedMs:5000` (**conserved > 0, slept 0**). This is exactly the thesis KPI: a forced-limit run made real progress instead of sleeping.

**Additive / determinism 🟢.** No new dependency; `limit_signal` journal fields additive; a no-signal run renders byte-identically (PART-5 tests both ways). AC-4 full suite: **850 passed | 19 skipped**, tsc + eslint clean.

## New friction

- **ℹ️ F-137 — durable-park (PART 4) is loop-proven only via a mocked `executeStep`, not a real classify→decide→park→resume→deferred-item-completes live proof.** Evidence: the end-to-end live proof (`agent-loop.test.ts:337`) exercises the **limit-independent-work** branch; the park branch's loop coverage (`agent-loop.test.ts:~255-336`) injects a fabricated park record via `activitiesOverride` and the run then terminates on `maxSteps:1`, not on a demonstrated park→resume→throttled-item-completes sequence. Unit coverage of `decideLimitParkDelay` (`limit-park.ts`) and `applyLimitResponse` park output is solid, but the failover/independent paths have an integration live-proof the park path lacks. Low severity — the seam deliberately deprioritizes park (activities.ts prefers `declared-failover` then any non-park before `[0]`), so park is the rarely-hit last resort. **No new WP** — track-B note under WP-309 (limit telemetry + reset learning), whose real 429/CLI-stderr call sites will naturally exercise a real park; fold a forced-park end-to-end proof in there.

_No 🔴 loop-integrity friction. 6 checkpoints, clean lastGood chain, no duplicate journal entries, no resumes, no wasted/filler steps (all 6 diffs non-trivial: 7980–15750 bytes). Cost telemetry sane (no `.00` with nonzero tokens). Judge family diverse, checks truly executed._

## Verdict on the thesis

🟢 **Strong.** The work-conserving limit scheduler is now END-TO-END: on a forced usage limit the run does not sleep and does not fabricate completion — it re-routes or does other useful work and returns to the throttled item, and the trace proves conserved > 0 with every plan item genuinely done. This is the vendor-neutral + work-conserving-scaling pillar demonstrated live, unattended, zero operator input, per-step reliability held (6/6 PROCEED). WP-308 closes; WP-309 (learn real reset schedules from real 429/CLI-stderr signals) is the next dependant.
