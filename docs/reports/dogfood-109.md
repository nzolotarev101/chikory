# dogfood-109 — WP-302 `brownfield-001`/`brownfield-002` PINNED (P3-rung-4 prep)

- **WP:** WP-302 (brownfield benchmark task authoring) · P3-rung-4 prerequisite (`plan.md` §7, WP-530) — rung-4 needs ≥5 pinned brownfield tasks scored vs a baseline; this brings the corpus to 3/5.
- **Date:** 2026-07-21
- **Not a `chikory run`/`chain` dogfood** — hand-authored WP-302 prerequisite work, same shape as dogfood-107. No run-id/journal exists for this entry; no ledger row (the ledger is terminal-run-only).
- **Outcome:** ✅ **PINNED** — `brownfield-001` and `brownfield-002` are now runnable (non-draft). `devbox run -- bash scripts/bench.sh`: 3/3 valid (all of `brownfield-001`/`002`/`003`).

## Plain lead

P3-rung-4 (score ≥5 brownfield tasks vs a baseline, `plan.md` §7) needs more
pinned tasks than the single one (`brownfield-003`) climbed in dogfood-108.
Researched and pinned the last 2 draft tasks — a real major-version
dependency upgrade (`brownfield-001`) and a real internal-API migration
(`brownfield-002`) — via two parallel research forks, each independently
verifying its checks discriminate a broken tree from a fixed one before
marking `pinned`. Corpus is now 3/5 toward rung-4; 2 more tasks still needed.

## What got pinned

**`brownfield-001`** — `ecyrbe/zodios` (TypeScript HTTP client/server built
on zod schemas) @ `6e6f3b3dbc3fdd62bc2c043efbdcd0254823fcb4`. Upgrade its
`zod` dependency from `3.22.4` to the 4.x line. **No real upstream PR exists
for this exact migration** (disclosed transparently by the research fork) —
the fork performed the upgrade itself and found 3 independent, real break
classes by actually running the toolchain, not by inspecting a changelog:

1. Two `src/api.ts` type-narrowing casts stop compiling under zod v4's
   rebuilt internals.
2. zod v4's `.d.cts` needs TypeScript ≥5.4 (repo pins 5.2.2), which
   transitively needs a `@types/node` bump.
3. Two pre-existing tests hardcode zod v3's exact `ZodError` shape/message
   text, which v4 changed.

3 requirements: install-clean + zod-major-is-4, full jest suite green **with
an exact total-test-count invariant (117)** guarding against silently
deleting the 2 broken assertions instead of fixing them, and a scoped `tsc`
build.

**`brownfield-002`** — `gitify-app/gitify` (5.2k-star Electron/TS app) @
`a061eaa112fa18885dd4de0cea6c0e51094cad0c`, the parent of real merged PR
#3036 ("move account crud into the accounts store"). Before the fix,
`utils/auth/utils.ts` exports a legacy free-function API
(`addAccount`/`removeAccount`/`hasAccounts`/`hasMultipleAccounts`/
`getPrimaryAccountHostname` + an `AuthState` type) manually threaded through
`useAccountsStore.ts`, while every other consumer already calls the store
directly — the modern pattern already established elsewhere in the same
codebase. Goal: inline the legacy logic into the store's own actions and
delete the legacy API entirely, no observable behavior change.

4 requirements: install-clean, full suite green (153 files/~1123 tests),
scoped typecheck, and a **root-cause discriminator** — a probe file with 6
`@ts-expect-error` directives asserting each legacy symbol no longer exists.
Renaming, re-exporting, or leaving the legacy code as a dead stub all fail
this check (the directives become "unused" errors); only a genuine deletion
passes.

## Verification (by hand, not through the harness's `chikory` adapter)

Both forks worked independently on host (no `devbox`, per the parallel-run
constraint — Chikory's devbox has a documented concurrent-startup race and
two forks ran simultaneously), and both:

1. Cloned the repo at the pinned ref, confirmed the checks are RED on the
   unmodified tree — `brownfield-001` R2/R3 fail (2/117 tests, tsc errors);
   `brownfield-002` R4 fails 6/6 ("Unused '@ts-expect-error'").
2. Performed the real fix (self-upgrade for `brownfield-001`, since no
   upstream PR exists; the real `#3036` diff for `brownfield-002`) and
   confirmed the same checks flip GREEN.
3. Re-ran the exact YAML check text verbatim (not hand-retyped, to rule out
   a transcription mismatch) on a fresh clone as a final confirmation.

Independently re-verified by me: `devbox run -- bash scripts/bench.sh` →
`benchmarks/tasks: 3 valid, 0 invalid` (format-level validation across all
3 now-pinned tasks). Neither task has been run through the actual `chikory`
adapter yet — that's a P3-rung-4 launch step, not part of pinning.

## New friction

None loop-integrity. Both forks' first launch attempt died mid-run on an
unrelated session auth expiry (`/login` fix, not a Chikory bug) before
touching any files — relaunched fresh with no lost work, no file corruption.
Not filed as an F-n (infra/session issue, not a Chikory defect).

## Verdict on the thesis

P3-rung-4's task corpus is 3/5 (`brownfield-001`/`002`/`003` all pinned,
`devbox run -- bash scripts/bench.sh` clean). Only `brownfield-003` has
actually been scored through the `chikory` adapter (dogfood-108); the other
2 are verified by hand only, same status `brownfield-003` had after
dogfood-107 before dogfood-108 ran it for real. **P3-rung-4 itself remains
un-climbed** — it needs 2 more tasks pinned (5 total) AND all 5 scored
through both `chikory` and a baseline adapter to produce the required score
RANGE, not just a corpus of pinned YAML files.

## Next

Two paths, roughly equal-sized lifts, not yet chosen:

1. Pin 2 more brownfield tasks (same research process, ~30-90 min each) to
   reach 5 total.
2. Run `brownfield-001`/`002` through `devbox run bench -- run --adapter
   chikory` now (mirrors dogfood-108) to bank 2 more real scores while the
   corpus grows in parallel later.

Recommend confirming with the operator before committing session time to
either — both are multi-attempt, real-cost, real-external-repo operations
(dogfood-108 took 6 launch attempts and ~$0.65+debugging time for just one
task).
