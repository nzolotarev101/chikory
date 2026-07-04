# Benchmark task definitions

Task corpus for the DevAI-extended suite (see `../README.md`). One YAML file
per task. Brownfield tasks are the moat — DevAI's 55 originals are greenfield,
so the extension work starts here.

## Format (v0 — draft, frozen when the harness lands in WP-301)

```yaml
id: brownfield-001          # stable id; never reused
class: brownfield | greenfield
status: draft | pinned      # pinned = repo ref + checks verified reproducible
repo:
  url: <public git url>     # real OSS repo, never a fixture invented for the task
  ref: <commit sha>         # pinned; "TBD" while draft
horizon: <estimated hours for a competent human>  # multi-hour by design
goal: |
  Outcome-shaped, like a Chikory loose spec (DOGFOODING §3.2): what must be
  true after, not which files to touch.
requirements:               # DevAI-style; each independently checkable
  - id: R1
    description: ...
    check: <command exiting 0/1, run in the task workspace>
metrics_notes: |            # what this task stresses (per ../README.md metrics)
```

Design rules (inherited from dogfood lessons):
- Checks must be behavioral, not symbol-presence greps (F-97/F-103 class).
- No file-layout pins on delegated work (F-82); no bare-word negative greps (F-83).
- Every task must have a real chance of a wrong turn — a task any agent
  one-shots clean measures nothing (DOGFOODING §1.1 failure-surface test).

## Status

Three brownfield drafts below double as long-horizon dogfood spec sources for
the WP-265 ladder (rung 4+) before the WP-301 harness exists.
