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

**All 3 brownfield tasks PINNED (2026-07-20/21, P3-rung-4 prep, WP-302 —
`docs/reports/dogfood-107.md`/`dogfood-108.md`).** `devbox run -- bash
scripts/bench.sh`: 3/3 valid.

- **`brownfield-001`** — `ecyrbe/zodios` @ `6e6f3b3dbc3fdd62bc2c043efbdcd0254823fcb4`,
  a real zod v3.22.4→v4 major upgrade (never attempted upstream; performed
  and verified by hand — 3 independent break classes: app-code type cast,
  toolchain floor (`typescript`/`@types/node`), stale test oracles). 3
  requirements incl. a total-test-count invariant (117) guarding against
  silently deleting the 2 broken assertions instead of fixing them.
- **`brownfield-002`** — `gitify-app/gitify` @ `a061eaa112fa18885dd4de0cea6c0e51094cad0c`,
  real upstream PR #3036 (legacy free-function auth API inlined into its
  Zustand store). 4 requirements incl. a `@ts-expect-error` root-cause
  discriminator that fails 6/6 on the unfixed tree and only passes when all
  5 legacy functions + the `AuthState` type are genuinely deleted (not
  renamed/re-exported/stubbed).
- **`brownfield-003`** — `colinhacks/zod` @ `b6b1288277e6ca87dab0ad1c7251b92612b7445c`,
  real issue #5826 / PR #5855 (`.default()` shallow-copies Map/Set). 4
  requirements incl. a root-cause discriminator probing the unreported
  `Set` sibling. **Scored 4/4 end-to-end through the real `chikory`
  adapter + judge (dogfood-108, P3-rung-3 CLIMBED)** — the only one of the
  3 run through Chikory itself so far.

Each was verified RED on the unmodified pinned tree and GREEN on the real
fix before being marked `pinned` — `brownfield-001`/`002` by hand only so
far; only `brownfield-003` has an actual `chikory`-adapter score.

`brownfield-001`/`002`/`003` double as long-horizon dogfood spec sources for
the WP-265 ladder (rung 4+).
