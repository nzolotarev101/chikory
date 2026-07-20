# dogfood-107 — WP-302 `brownfield-003` PINNED (P3-rung-3 prerequisite)

- **WP:** WP-302 (brownfield benchmark task authoring) · unblocks WP-530 P3-rung-3 (first benchmark task scored end-to-end, plan.md §7)
- **Date:** 2026-07-20
- **Task file:** `benchmarks/tasks/brownfield-003-bug-archaeology.yaml`
- **Not a `chikory run`/`chain` dogfood** — this is hand-authored WP-302 prerequisite work, mirroring how WP-531/WP-532 were hand-landed harness prerequisites before dogfood-105/106's headlines. No run-id/journal exists for this entry.
- **Outcome:** ✅ **PINNED** — `brownfield-003` is now the first runnable (non-draft) brownfield benchmark task. Verified end-to-end through the real harness, not just by hand.

## Plain lead

P3-rung-3 (the next thesis-ladder rung: score one real benchmark task end-to-end)
was blocked — all 3 draft brownfield tasks had `url: TBD`/`ref: TBD`/`check: TBD`,
and pinning one means picking a real external GitHub repo and verifying facts, not
something to fabricate. Researched and pinned a real, verifiable bug (`colinhacks/zod`
issue #5826) with 4 mechanically-checkable requirements, and proved the checks work
correctly by running them through the actual benchmark harness (not just by hand) —
both on the unmodified buggy tree and on the real upstream fix.

## What got pinned

**Repo:** `https://github.com/colinhacks/zod` @ `b6b1288277e6ca87dab0ad1c7251b92612b7445c`
(the commit immediately before upstream PR #5855 landed).

**Bug:** `.default()` on a `Map`/`Set`-typed schema returned the SAME mutable
instance on every `.parse(undefined)` — `shallowClone`
(`packages/zod/src/v4/core/util.ts`) only special-cased plain objects and arrays,
so Map/Set fell through to `return o` (shared reference). A mutation on one parse
result leaked into the next parse — a real, reported (issue #5826), fixed (PR #5855,
merged as `34f601590351e5d3a57fe20c001155940ba65324`) bug in a very widely-used
TypeScript library.

**4 requirements** (`benchmarks/tasks/brownfield-003-bug-archaeology.yaml`):

| id | what it checks | prereq |
|---|---|---|
| R1 | `pnpm install --frozen-lockfile` clean | — |
| R2 | a new/modified test (discovered via `git diff --name-only <base-ref>`, no file-layout pin) reproduces the reported Map-default sharing bug and passes | R1 |
| R3 | full pre-existing zod suite green (no other behavior changed) | R1 |
| R4 | **root-cause discriminator** — writes and runs its OWN probe test (independent of anything the agent wrote) asserting the SAME bug is fixed for `Set`-typed defaults, which issue #5826 never reported | R1 |

R4 is the interesting one: it can't be gamed by a differently-shaped regression
test, because it doesn't depend on the agent's test file at all — it's a
self-contained mechanical proxy for "did you fix the root cause (generalize the
clone) or just patch the one reported case."

## Verification (not just by hand — through the real harness)

1. **Manual reproduction:** cloned the repo, checked out the pinned ref, confirmed
   `shallowClone` has no Map/Set branch, wrote the exact issue #5826 repro as a
   `vitest` test — **fails** (`size` is 1, expected 0).
2. **Fix confirmation:** checked out the real upstream fix commit — the same test
   **passes**; full pre-existing suite (326 files / 3680 tests) stays green at the
   pinned ref (R3's baseline is genuinely unaffected either way).
3. **Root-cause discriminator validated by construction:** hand-wrote a
   deliberately NARROW patch (`shallowClone` special-cased ONLY `Map`, not `Set`)
   — R4 correctly **fails** against it; the real general fix (both `Map` and `Set`)
   correctly **passes**. Proves R4 actually discriminates, not just checks the
   reported symptom.
4. **End-to-end through the harness** (`devbox run bench -- run --tasks
   benchmarks/tasks --filter brownfield-003 --adapter command --cmd
   "<clones repo, checks out pinned ref>"`): **2/4 satisfied on the unmodified
   pinned tree** (R1/R3 pass trivially, R2/R4 correctly red — the bug is
   genuinely present). Repeated with the real fix + a regression test applied:
   **4/4 satisfied (I-SR 100%, D-SR 100%)**. `devbox run bench` (format
   validator) also passes clean.

## New friction

None loop-integrity. One authoring note for future task-pinners: `git diff
--name-only <ref>` does **not** surface untracked new files — the check scripts
use `git add -A -N .` (intent-to-add) first, same idiom as Chikory's own
diff-capture (`clearStaleIndexLock`/`git add -N .` in the runner). Also: vitest's
CLI positional filters AND together across multiple args rather than OR — a
multi-file check must loop and invoke vitest once per file, not pass a
space-joined file list.

## Verdict on the thesis

P3-rung-3's hard blocker (no pinned task existed) is cleared. The rung itself is
**NOT YET climbed** — `brownfield-003` has only been dry-run through the `command`
baseline adapter (to prove the checks work), never through the `chikory` adapter
with a real judge, which is what P3-rung-3 actually requires (a genuine I-SR/D-SR
score artifact from a chikory-vs-benchmark run).

## Next

Launch P3-rung-3 for real:

```
devbox run bench -- run --tasks benchmarks/tasks --filter brownfield-003 \
  --adapter chikory --judge-cmd '<keyless CLI judge invocation>' \
  --out benchmarks/results
```

This is a real 3-6h horizon task against a live external repo — expect it to
take substantially longer and cost more than a normal `examples/dogfood/`
headline. Commit this pinning work (and the docs updates) before launching.
