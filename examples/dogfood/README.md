# Dogfood task specs

One file per dogfood campaign — the TaskSpec that ran (or will run) a
plan.md work-package slice through Chikory itself. Full operating manual:
[`docs/DOGFOODING.md`](../../docs/DOGFOODING.md).

## Convention

- **Path**: `examples/dogfood/dogfood-<NNN>.yaml` — `NNN` is the campaign
  number, allocated sequentially. The paired report lives at
  `docs/reports/dogfood-<NNN>.md` (same number; the report is mandatory —
  TASK-PROTOCOL §7).
- **`name:` field**: `dogfood-<NNN>-<short-slug>` (e.g.
  `dogfood-001-memory-pointer-store`).
- **Header comment**: which WP/slice it implements, the launch command, and
  — once it has run — the run-id, outcome, landed commit, and report link.
- Specs are kept after the run (they're the reproducible half of the
  report); never rewrite the `goal`/criteria of a spec that already ran —
  a new attempt or next slice is a new `dogfood-<NNN+1>.yaml`.
- After every terminal run: `/dogfood-review <run-id>` — the standardized
  review that verifies the delivery, writes the report, updates the plan,
  and readies the next spec (DOGFOODING.md §6.1).

## Index

| Spec | WP / slice | Outcome | Report |
|---|---|---|---|
| [`dogfood-001.yaml`](dogfood-001.yaml) | WP-202 slice 1 — Memory Pointer store | SUCCESS (run 4 of 4; landed `e267e28`) | [`dogfood-001.md`](../../docs/reports/dogfood-001.md) |
| [`dogfood-002.yaml`](dogfood-002.yaml) | WP-201 slice 1 — Python contracts parity | SUCCESS (run-2899005b; landed `eb5c57e`) | [`dogfood-002.md`](../../docs/reports/dogfood-002.md) |
| [`dogfood-003.yaml`](dogfood-003.yaml) | WP-217 — completion signal → off-cadence judge pass | SUCCESS (run-b2f3504d; landed `ef4b16f`) | [`dogfood-003.md`](../../docs/reports/dogfood-003.md) |
| [`dogfood-004.yaml`](dogfood-004.yaml) | WP-218 slice 1 — pricing refresh + blind-cost-meter warning | SUCCESS (run-9edbcd28; landed `2a4dd21`) | [`dogfood-004.md`](../../docs/reports/dogfood-004.md) |
| [`dogfood-005.yaml`](dogfood-005.yaml) | WP-220 — `chikory land <run-id>` | SUCCESS (run-34926e85; diff verified on `wp-220-chikory-land`, commit pending review) | [`dogfood-005.md`](../../docs/reports/dogfood-005.md) |
| [`dogfood-006.yaml`](dogfood-006.yaml) | WP-222 slice 1 — executor subprocess env scrub | SUCCESS (run-559ea904; landed `18fae43`) | [`dogfood-006.md`](../../docs/reports/dogfood-006.md) |
| [`dogfood-007.yaml`](dogfood-007.yaml) | WP-223 — watch renders journal transitions, never sampled state | SUCCESS (run-22b337a9; diff verified, commit pending review) | [`dogfood-007.md`](../../docs/reports/dogfood-007.md) |
| [`dogfood-008.yaml`](dogfood-008.yaml) | WP-224 — `land --verify` + git-stderr capture | not yet run | — |
