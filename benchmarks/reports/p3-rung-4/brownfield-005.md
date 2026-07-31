# Benchmark Task Provenance & Reproducibility Report: `brownfield-005`

## Summary

| Metric / Attribute | Value |
|---|---|
| **Task ID** | `brownfield-005` |
| **Task Class** | `brownfield` |
| **Status** | `pinned` |
| **Target Repository** | `https://github.com/trpc/trpc` |
| **Upstream PR / Fix Commit** | PR #7390 (`dfbafa8ef178a5a3d23ef9461caa9494b3ef7f95`) |
| **Pinned Base Commit (Immediately Pre-Fix)** | `cdbc28049889a9da9ea2abb6bd6519afe2279ead` |
| **Base Verification Command** | `pnpm install --frozen-lockfile && pnpm vitest run packages/tests/server/links.test.ts` |
| **Estimated Horizon** | 1–3 hours (F-231: measured against the upstream fix size below, not asserted) |

---

## 1. Upstream Provenance & Diagnostic Horizon

### Provenance Metadata
- **Repository**: [trpc/trpc](https://github.com/trpc/trpc)
- **Upstream Pull Request**: PR #7390 (*"fix(client): abort JSONL stream on httpBatchStreamLink unsubscribe (#7390)"*)
- **Parent Base Commit**: `cdbc28049889a9da9ea2abb6bd6519afe2279ead` (immediately pre-fix parent commit on `main`)
- **Fix Commit**: `dfbafa8ef178a5a3d23ef9461caa9494b3ef7f95`

### Upstream Fix Size (measured, F-231)
`gh api repos/trpc/trpc/commits/dfbafa8ef178a5a3d23ef9461caa9494b3ef7f95`:

| File | Change |
|---|---|
| `packages/client/src/links/httpBatchStreamLink.ts` | +11 / −2 |
| `packages/tests/server/links.test.ts` | +51 / −0 |

The horizon claim rests on this number, not on prose. The source edit is small; the cost is the
diagnosis plus getting the signal racing and completion tracking right.

### Diagnostic Ambiguity & Real-World Complexity (1–3 Hours)
In `trpc`, client-server communications can be structured through modular link pipelines (`httpLink`, `httpBatchLink`, `httpBatchStreamLink`, `wsLink`).
When using `httpBatchStreamLink`, observable subscriptions manage streaming response payloads:
1. At the pinned ref `httpBatchStreamLink` calls `loader.load(op)` directly — there is **no `AbortController` anywhere in the request path**.
2. When a component unmounts, a route changes, or a subscriber unsubscribes from the query observable, the link pipeline invokes the cleanup function returned by the link's observable subscriber factory.
3. Prior to PR #7390, `httpBatchStreamLink` returned a no-op cleanup function (`return () => {}`).

> **Correction (F-231/F-232, 2026-07-30).** An earlier revision of this report and of
> `brownfield-005.yaml` stated that the link already created an `AbortController` and only the
> teardown was missing. That is false at `cdbc280…`: the upstream fix **creates** the controller,
> races it against the caller's signal via `raceAbortSignals(op.signal, ac.signal)`, tracks
> completion with an `isDone` flag, and aborts only from the teardown of an unfinished request.
> The original wording would have pointed the agent at a one-line edit instead of the real design
> change. Verified directly against the upstream patch.

An engineer or AI coding agent investigating resource leaks or uncancelled stream requests faces diagnostic ambiguity:
- Component teardown logic fires and subscriber callbacks detach, creating the visual impression that query cleanup succeeded.
- However, nothing in the request path can cancel the fetch, so the underlying network stream remains open on the transport layer.
- Diagnosing the root cause requires navigating multi-package abstractions (`@trpc/client`, `@trpc/server`, `@trpc/tests`), tracing RxJS-style observable subscription lifecycles, and recognizing that the cancellation mechanism must be introduced rather than merely invoked.

### Outcome-Shaped Task Goal
The task goal is strictly outcome-shaped:
> In `trpc`, when `httpBatchStreamLink` is used to create a batch stream observable and a subscriber unsubscribes before the HTTP request stream completes, ensure the in-flight fetch is cancelled — without cancelling an already-completed request and without discarding a caller-supplied `AbortSignal` — while maintaining type safety, keeping pre-existing tests green, and passing project typechecks.

---

## 2. Upstream Reproduction & Verification Commands

### Environment Setup Sequence
To reproduce this task from a clean environment:
```bash
# 1. Clone target repository
git clone https://github.com/trpc/trpc.git
cd trpc

# 2. Fetch specific commits
git fetch origin cdbc28049889a9da9ea2abb6bd6519afe2279ead dfbafa8ef178a5a3d23ef9461caa9494b3ef7f95

# 3. Checkout base pinned ref (immediately pre-fix)
git checkout cdbc28049889a9da9ea2abb6bd6519afe2279ead

# 4. Install dependencies using target's own package manager
pnpm install --frozen-lockfile
```

### Requirement Verification Commands

| Requirement ID | Description | Verbatim Verification Command Script |
|---|---|---|
| **Base Verification** | Base test suite passes on base ref | `pnpm install --frozen-lockfile && pnpm vitest run packages/tests/server/links.test.ts` |
| **R1** | Dependencies install clean | `pnpm install --frozen-lockfile` |
| **R2** | Pre-existing client links test suite green | `pnpm vitest run packages/tests/server/links.test.ts` |
| **R3** | Project package typechecks clean | `pnpm typecheck-packages` |
| **R4** | Root-cause probe: `httpBatchStreamLink` unsubscribe aborts fetch | See verbatim probe script below |

#### R4 Verbatim Script (Self-Contained Probe)
```bash
set -e
PROBE_FILE="packages/tests/server/probe-httpbatchstreamlink-abort.test.ts"
cat > "$PROBE_FILE" << 'TESTEOF'
import { expect, test, vi } from 'vitest';
import { httpBatchStreamLink } from '@trpc/client';
import { createChain } from '@trpc/client/links/internals/createChain';
import type { TRPCClientRuntime } from '@trpc/client';

const mockRuntime: TRPCClientRuntime = {};

test('httpBatchStreamLink - unsubscribe aborts fetch', async () => {
  let fetchSignal: AbortSignal | undefined;
  const fetchCalled = new Promise<void>((resolve) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      fetchSignal = init?.signal ?? undefined;
      resolve();
      return new Response(
        new ReadableStream({
          start() {
            // never enqueue or close - keeps the stream open
          },
        }),
        { status: 200 },
      );
    });
  });

  try {
    const links = [
      httpBatchStreamLink({
        url: 'http://localhost:9999',
      })(mockRuntime),
    ];

    const chain = createChain({
      links,
      op: {
        id: 1,
        type: 'query',
        path: 'hello',
        input: null,
        context: {},
        signal: null,
      },
    });

    const sub = chain.subscribe({});

    await fetchCalled;

    expect(fetchSignal!.aborted).toBe(false);

    sub.unsubscribe();

    expect(fetchSignal!.aborted).toBe(true);
  } finally {
    vi.restoreAllMocks();
  }
});
TESTEOF
pnpm vitest run "$PROBE_FILE"
```

---

## 3. Observed RED-on-Pin Evidence

Tested on clone of target repo at pinned base ref `cdbc28049889a9da9ea2abb6bd6519afe2279ead`.

### Base Verification Command Output
```text
$ git checkout cdbc28049889a9da9ea2abb6bd6519afe2279ead
HEAD is now at cdbc280 fix(upgrade): clear the query cache on every fixture render (#7448)

$ pnpm install --frozen-lockfile && pnpm vitest run packages/tests/server/links.test.ts
...
 RUN  v4.0.18 /private/tmp/test-trpc

 ✓  @trpc/tests  server/links.test.ts (22 tests) 106ms

 Test Files  1 passed (1)
      Tests  22 passed (22)
   Start at  17:38:31
   Duration  1.35s
Exit Code: 0
```

### Requirement R1–R3 Execution
- **R1** (`pnpm install --frozen-lockfile`): PASS (exit code 0)
- **R2** (`pnpm vitest run packages/tests/server/links.test.ts`): PASS (22 passed, exit code 0)
- **R3** (`pnpm typecheck-packages`): PASS (clean typecheck, exit code 0)

### Requirement R4 (Root-Cause Probe) Output — FAIL / RED
```text
$ pnpm vitest run packages/tests/server/probe-httpbatchstreamlink-abort.test.ts

 RUN  v4.0.18 /private/tmp/test-trpc

 ❯  @trpc/tests  server/probe-httpbatchstreamlink-abort.test.ts (1 test | 1 failed) 9ms
   × httpBatchStreamLink - unsubscribe aborts fetch 9ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL   @trpc/tests  server/probe-httpbatchstreamlink-abort.test.ts > httpBatchStreamLink - unsubscribe aborts fetch
AssertionError: expected false to be true // Object.is equality

- Expected
+ Received

- true
+ false

 ❯ server/probe-httpbatchstreamlink-abort.test.ts:52:34
     50|     sub.unsubscribe();
     51| 
     52|     expect(fetchSignal!.aborted).toBe(true);
       |                                  ^
     53|   } finally {
     54|     vi.restoreAllMocks();

 Test Files  1 failed (1)
      Tests  1 failed (1)
   Start at  17:38:51
   Duration  866ms
Exit Code: 1
```

---

## 4. Observed GREEN-on-Known-Fix Evidence

Tested on clone of target repo at fix commit `dfbafa8ef178a5a3d23ef9461caa9494b3ef7f95`.

### Base Verification Command Output
```text
$ git checkout dfbafa8ef178a5a3d23ef9461caa9494b3ef7f95
HEAD is now at dfbafa8 fix(client): abort JSONL stream on httpBatchStreamLink unsubscribe (#7390)

$ pnpm install --frozen-lockfile && pnpm vitest run packages/tests/server/links.test.ts
...
 RUN  v4.0.18 /private/tmp/test-trpc

 ✓  @trpc/tests  server/links.test.ts (22 tests) 104ms

 Test Files  1 passed (1)
      Tests  22 passed (22)
   Start at  17:38:57
   Duration  1.30s
Exit Code: 0
```

### Requirement R1–R4 Execution
- **R1** (`pnpm install --frozen-lockfile`): PASS (exit code 0)
- **R2** (`pnpm vitest run packages/tests/server/links.test.ts`): PASS (exit code 0)
- **R3** (`pnpm typecheck-packages`): PASS (exit code 0)
- **R4** (Root-cause probe): PASS / GREEN

```text
$ pnpm vitest run packages/tests/server/probe-httpbatchstreamlink-abort.test.ts

 RUN  v4.0.18 /private/tmp/test-trpc

 ✓  @trpc/tests  server/probe-httpbatchstreamlink-abort.test.ts (1 test) 6ms

 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  17:38:58
   Duration  759ms
Exit Code: 0
```
