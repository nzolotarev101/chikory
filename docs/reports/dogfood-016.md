# Dogfood-016 - WP-219 S3 pure precondition (`hasDependencyCycle`)

**WP**: WP-219 · **Date**: 2026-06-13 · **Task spec**: [`examples/dogfood/dogfood-016.yaml`](../../examples/dogfood/dogfood-016.yaml) · **Run**: `run-2418f473-0906-4e86-94ae-9c644a3145f8` · **Landed**: harvested byte-identically and staged, pending commit on `main`

> Sixteenth dogfood, sixteenth first-attempt SUCCESS. The engine added the
> chain executor's acyclic-plan guard exactly as specified: a pure
> `hasDependencyCycle(plan)` predicate using Kahn's algorithm plus four focused
> tests. The delivery is correct and scoped. The review found three operational
> issues around it: parallel Devbox startup is unsafe (F-22), the supposedly
> closed CLI transition race still has a terminal-boundary form (F-23), and the
> documented explicit-run form of `dogfood-verify` makes Vitest abort under
> Devbox 0.17.0 (F-24).

## The run

Zero-secrets setup matched dogfood-002...015: Codex executor (OpenAI family)
and Gemini judge behind the local OpenAI-compatible shim. The actual executor
and judge model families were different; the family-diversity invariant held.

```text
run run-2418f473... · SUCCESS · 2 steps · $1.10 / $5.00 · 3m 25s
 1   Implemented exactly two new files...  747k/4.6k  $0.98
 2   WP-219 S3 is already implemented...    59k/991   $0.08  PROCEED (3/3)
totals: decisions 2 · judge passes 1 ($0.03, 3.1%) · rollbacks 0 · escalations 0
        checkpoints 2 · issues found 0 · changes made 1
```

Step 1 did all product work: 23 tool calls, 2m15s, and a 2,646-byte diff.
Step 2 was the completion probe: seven tool calls, 29s, 59k input tokens, and
an empty diff. The judge ran all three checks, passed all four rubric items,
and sealed SUCCESS.

Journal integrity was clean: two decisions, two checkpoints, no resume,
rollback, or escalation. Checkpoint chain:
`49b617d67e6d` (`lastGood:false`) to `83471844d83b`
(`lastGood:true`).

Cost telemetry was healthy: $0.9799 + $0.0832 executor spend and $0.0336 judge
spend = $1.0967 exact, 22.0% of the $5 cap. Judge share was 3.1%.

## Delivery quality (human review, post-landing)

All run acceptance checks passed independently in devbox:

- **AC-1**: `validation.test.ts` - 4/4 passed.
- **AC-2**: frozen contract conformance - 77/77 passed.
- **AC-3**: strict typecheck and lint - both clean.
- **Full SDK suite on the host**: 234 passed, 19 skipped. The executor's own
  full-suite run had one CLI observer flake; see F-23.

The harvested files are byte-identical to the run workspace and staged:

- `packages/sdk-ts/src/chain/validation.ts`
- `packages/sdk-ts/test/chain/validation.test.ts`

The implementation matches the goal line by line: type-only `Plan` import,
the prescribed Kahn traversal, unknown dependency ids excluded from edges,
no non-null assertions, no IO, and no extra exports. The test helper builds
the required minimal `Plan`, and the describe block has exactly the four
required cases. No dependency, contract, runner, or existing source file was
changed by the run.

## New friction

**F-22 - Parallel `devbox run` invocations race on the generated command
script.** The executor launched focused test, typecheck, and lint concurrently;
all three failed around `.devbox/gen/scripts/.cmd.sh`, then passed when rerun
sequentially. The review reproduced the same collision. This contributed to
step 1's 747k input-token footprint because the executor had to diagnose the
environment, perform an offline install, and rerun checks. **No WP spawned**:
the actionable fix is an operating rule, now added to `AGENTS.md`,
`CLAUDE.md`, and `DOGFOODING.md`: Devbox commands must be serialized. This is
an upstream Devbox 0.17.0 startup collision, not Chikory product logic.

**F-23 - F-15 is not fully closed: `followRun` can still miss a durable
transition when the run becomes terminal between journal scan and status
return.** The executor's full SDK suite failed
`cli.test.ts > loop-breaker escalation -> approve --reject`: status reached
`AWAITING_APPROVAL`, but the parent `run` output omitted the durable
`AWAITING_APPROVAL` line and returned the final FAILED report. The focused test
and one independent host full-suite run passed, confirming a timing race.
Source inspection identifies the remaining boundary: `followRun` drains the
journal, then awaits `handle.status()`, and returns immediately on terminal
status without a final drain. Entries appended between the scan and terminal
status are therefore skipped. -> **WP-227**: final journal drain before a
terminal return, with a deterministic test that appends ESCALATE during
`status()`. Dogfood-017 is ready for this fix.

**F-24 - The documented explicit `dogfood-verify` invocation falsely marks
Vitest checks red under Devbox 0.17.0.** Both
`RUN_ID=... devbox run dogfood-verify` and an arbitrary
`FOO=x devbox run -- pnpm ... vitest` reproduce the same `undefined` abort;
the identical checks pass when the run id is passed positionally to the script
inside devbox. **No WP spawned; fixed inline**: the review skill and verifier
usage now prescribe
`devbox run -- bash scripts/dogfood-verify.sh <run-id>`. The newest-run form
remains `devbox run dogfood-verify`.

Recurrences and baseline:

- **F-11 recurred**, fifteenth data point and twelfth priced campaign:
  59k input tokens, seven tool calls, 29s, $0.0832, and **7.6% of total run
  cost**. It remains within the 5.8%-35.1% spread. `claimsComplete` is frozen
  in the contracts; adapter/runner wiring remains queued in WP-221.
- **Token economics**: 806k executor input tokens for a 2,646-byte pure
  change. The productive step's 747k is materially inflated by F-22,
  dependency bootstrap, and an unprompted full-suite run.
- Human ceremony remained launch, harvest, and review. No new finding beyond
  the already queued WP-219/WP-220 automation path.

## Verdict on the thesis (sixteenth data point)

- The product delivery is correct, independently green, and advances the
  chain executor with its required cycle guard.
- The judge made the right decision and all journal/checkpoint invariants held.
- Reliability pressure remains concentrated in the operating shell and CLI
  observer, not the executor/judge loop. F-23 matters because forensics must
  never omit a durable transition even when terminal state follows quickly.
- Next: dogfood-017 delivers WP-227, the final journal drain regression fix,
  before returning to WP-219/WP-221 implementation slices.
