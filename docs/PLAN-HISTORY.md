## 2026-08-07 — displaced from docs/DOGFOODING.md status block by the dogfood-124 review

**Status (2026-08-06, bounded — update discipline: REPLACE this block, ≤15 lines;
displaced prose moves verbatim to [`PLAN-HISTORY.md`](PLAN-HISTORY.md); per-run detail:
`docs/reports/`; queue + course correction: `plan.md` §6/§7).**
🟢 **P3-rung-4 CLIMBED — dogfood-123 published Chikory's first head-to-head benchmark result**
(`run-3e2a6791-cab1-46c7-bc5b-b3d0730b92c5`, SUCCESS **1 step $0.0457/$15.00**, 3m 20s, 2/2 criteria
+ 6/6 rubric, `docs/reports/dogfood-123.md`). **Chikory 19/19 I-SR [83.2%, 100.0%] vs raw Claude Code
18/19 I-SR [75.4%, 99.1%] / 16/19 D-SR [62.4%, 94.5%]** over `brownfield-001…005`, both arms 5/5
base-verified. Separation is `brownfield-001` alone (zod v3→v4). **The intervals OVERLAP** — 19
requirements cannot separate two arms at 95%; rung-5 needs corpus, not harness.
**The operator ran both arms BY HAND** (`scripts/bench-run.sh`, sequential) and the spec published only —
dogfood-122's lesson holds: an LLM executor may not supervise a multi-hour, quota-bound suite.
Agent classes live-checked: `park-until-reset` **0**, no rotation needed, 6/6 members probed at $0.
🔴 **F-261** (published trace link pointed inside a prunable run workspace) → **WP-588 hand-fixed**;
🟠 **F-263** (report prose cited a superseded suite run's versions) hand-fixed + provenance table;
ℹ️ **F-266** (progression gate named the retired P2 ladder) hand-fixed. **Queued: WP-589** (the
write-boundary rubric reads `git diff`, so 2.1 GiB / 95,068 gitignored writes scored ✓) · **WP-590**
(`gemini-cli` records `toolCalls: 0`). Progression ✅ PROGRESSING (rung 4). **NEXT = P3-rung-5, the
phase EXIT gate** — published DevAI-extended ranges + leaderboard, on a corpus that can separate.

