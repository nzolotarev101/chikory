---
name: dogfood-review
description: Post-run review of a finished Chikory dogfood run — verify the delivery independently, hunt anomalies, write the numbered dogfood report, feed friction into plan.md/REQUIREMENTS.md/DOGFOODING.md, and ready the next spec. Run after every dogfood run reaches a terminal state.
---

# Dogfood run review

Input: a run-id (`$ARGUMENTS`), or find it — latest dir in `.chikory/runs/`,
or the `Ref: run-id:` line in the harvest commit. Everything below runs via
devbox (CLAUDE.md hard rule). The procedure has five phases; do them in
order, and **do not skip phase 4 even when the run looks clean** — the
report is a first-class plan input (TASK-PROTOCOL §7), and dogfood-002
proved a SUCCESS run can still surface three plan-changing gaps.

## 1. Reconstruct what happened (journal is ground truth)

```sh
devbox run -- pnpm chikory trace <run-id>              # header, per-step rows, totals
devbox run -- pnpm chikory trace <run-id> --step <n>   # each step: diff/transcript refs, judge form, rationale
```

Read every step and every judge pass. Record: terminal state, steps, judge
passes/verdicts, tokens in/out per step, cost vs budget, duration,
executor/judge families, checkpoint chain. Locate the spec
(`examples/dogfood/dogfood-<NNN>.yaml`, see `examples/dogfood/README.md`
index) and the harvest commit (`git log --grep <run-id>`).

## 2. Verify the delivery independently — never trust the run's own green

- Re-run **every acceptance criterion's `check`** from the spec yourself,
  in devbox, against the landed commit. Quote real output in the report.
- Review the landed diff against the spec's `goal` line by line: every
  named file/symbol present; conventions honored (AGENTS.md); nothing
  out of scope; no new dependencies unless the goal allowed them; for
  parity/port work, compare against the source-of-truth artifact
  (e.g. `types.ts` / CONTRACTS.md / shared fixtures).
- Confirm scope discipline: `git show --stat` — only files the goal names
  (or trivially entailed) changed.

## 3. Hunt anomalies — the checklist that has caught real findings

Walk all of these explicitly; each earlier hit became a WP:

- **Wasted/filler steps**: empty diffs, "already done" summaries, steps
  spent re-verifying (F-8 → WP-217).
- **Cost telemetry**: $0.00 with nonzero tokens? model missing from
  `packages/sdk-ts/src/pricing.ts`? budget gate effectively inert?
  (F-9 → WP-218).
- **Token economics**: input tokens per step vs work done — record the
  number; it's baseline data for WP-203/WP-207.
- **Judge behavior**: did checks actually execute (look for
  "judge-executed check … exited 0")? rubric justifications sane? any
  ESCALATE/ROLLBACK — was it a true positive? family diversity real
  (shim backend ≠ executor family)?
- **Human ceremony**: count what the human did by hand around the run
  (slicing, launching, harvesting) — F-10 territory; note anything WP-219/
  WP-220 wouldn't already fix.
- **Loop integrity**: duplicate journal entries, re-executed steps after
  any resume, checkpoint/lastGood consistency.

## 4. Write the report and update the living docs

1. **Report** `docs/reports/dogfood-<NNN>.md` — NNN matches the spec.
   Mirror dogfood-002.md's shape: header line (WP/date/spec/run-id/landed
   commit), trace excerpt, "Delivery quality (human review, post-landing)",
   "New friction", "Verdict on the thesis". **Friction numbering is global
   and sequential across all reports** (dogfood-001 = F-1…F-7,
   dogfood-002 = F-8…F-10; continue from the highest existing F-n).
   Every friction item states the evidence and names the WP it spawns (or
   says why none).
2. **plan.md** — mark the WP/slice done in §6 (cite run-id + landed
   commit); turn each new friction item into a WP row queued by priority
   (next free WP number, tag 🔴/🟡/🟢, "Next up (dogfood-NNN F-n)" note);
   update the **Status** line.
3. **docs/REQUIREMENTS.md** — new WPs into the requirement rows they
   serve; reopen rows the findings prove aren't actually done; update WP
   status (e.g. IF-2 in-progress with landed commit).
4. **docs/DOGFOODING.md** — new operational gotchas into §7
   (troubleshooting) or §8 (known limitations), citing the friction id;
   update the header "proven path" line.
5. **examples/dogfood/README.md** — index row for this campaign:
   outcome, run-id, landed commit, report link.

Constraints: never rewrite the `goal`/criteria of a spec that already ran;
keep `.chikory/runs/<run-id>` (journal + artifacts are the audit trail);
docs in `docs/` listed as living docs must not drift from code.

## 5. Ready the next run

Pick the top of the plan.md §6 queue that is dogfoodable per DOGFOODING §1
(🟢 mechanical, or a 🟡 slice needing no contracts change — contracts work
is hand-done first, TASK-PROTOCOL §4). Write
`examples/dogfood/dogfood-<NNN+1>.yaml` per DOGFOODING §3: goal as a
self-contained 1–3-step brief naming exact files/symbols/tests; judge-
executed checks that fit the 120 s cap (time them — bare toolchain
binaries, not `devbox run`); zero-secrets routing block if no API keys.
Validate it parses (`parseTaskSpec` over the file, or `pnpm chikory run`
which validates first). Add the README index row ("not yet run"). Remind
the user: commit everything before launching — the workspace clones HEAD.

## Output

End with a summary: verdict on the delivery, friction items found (F-n →
WP-n mapping), docs touched, next spec ready + its launch command. Leave
changes uncommitted for the user's review unless told otherwise.
