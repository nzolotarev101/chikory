# Benchmark task definitions

Task corpus for the DevAI-extended suite (see `../README.md`). One YAML file
per task. Brownfield tasks are the moat — DevAI's 55 originals are greenfield,
so the extension work starts here.

## Format (v1 — FROZEN, WP-301)

The format froze when the harness landed: the schema in
`../harness/src/task.ts` is the single source of truth, and
`devbox run bench` validates this directory against it. Full field reference,
design rules, and the draft→pinned lifecycle: **[AUTHORING.md](AUTHORING.md)**.

Summary shape:

```yaml
id: brownfield-001          # stable id; never reused
class: brownfield | greenfield
status: draft | pinned      # pinned = repo ref + checks verified reproducible
repo:
  url: <public git url>     # real OSS repo, never a fixture invented for the task
  ref: <commit sha>         # full 40-hex once pinned; "TBD" while draft
horizon: <estimated hours for a competent human>  # multi-hour by design
goal: |
  Outcome-shaped, like a Chikory loose spec (DOGFOODING §3.2): what must be
  true after, not which files to touch.
requirements:               # DevAI-style; each independently checkable
  - id: R1
    description: ...
    check: <command exiting 0/1, run in the task workspace>
    prerequisites: [ ... ]  # optional; feeds D-SR (dependency-adjusted rate)
metrics_notes: |            # what this task stresses (per ../README.md metrics)
```

Design rules (inherited from dogfood lessons; expanded in AUTHORING.md):
- Checks must be behavioral, not symbol-presence greps (F-97/F-103 class).
- No file-layout pins on delegated work (F-82); no bare-word negative greps (F-83).
- Every task must have a real chance of a wrong turn — a task any agent
  one-shots clean measures nothing (DOGFOODING §1.1 failure-surface test).

## Status

**`brownfield-003` PINNED 2026-07-20** (P3-rung-3 prerequisite, WP-302 —
`docs/reports/dogfood-107.md`): `colinhacks/zod` @ `b6b1288277e6ca87dab0ad1c7251b92612b7445c`
(the commit before upstream PR #5855 fixed issue #5826, `.default()`
shallow-copying Map/Set). 4 check-graded requirements (install-clean, the
regression test, full-suite-green, and a root-cause discriminator that
independently probes the Set-typed sibling the issue never reported — no
narrow Map-only patch can pass it). Verified end-to-end through the real
harness (`devbox run bench -- run --adapter command`): 2/4 satisfied on the
unmodified pinned tree (the bug is genuinely present), 4/4 on the real
upstream fix. `brownfield-001`/`brownfield-002` remain drafts — still need a
real repo/ref pinned the same way before they're runnable.

`brownfield-001`/`002`/`003` double as long-horizon dogfood spec sources for
the WP-265 ladder (rung 4+) once pinned.
