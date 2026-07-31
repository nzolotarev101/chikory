# Benchmark Task Provenance & Reproducibility Report: `brownfield-004`

## Summary

| Metric / Attribute | Value |
|---|---|
| **Task ID** | `brownfield-004` |
| **Task Class** | `brownfield` |
| **Status** | `pinned` |
| **Target Repository** | `https://github.com/react-hook-form/react-hook-form` |
| **Upstream PR / Fix Commit** | PR #13613 (`69da9545b222aceb5fc8ea15e851cab83b1c84f6`) |
| **Pinned Base Commit (Immediately Pre-Fix)** | `d96c5ceef12cb53266ce1ae5e65fba301a31fe57` |
| **Base Verification Command** | `pnpm install --frozen-lockfile && pnpm test` |
| **Estimated Horizon** | 1–3 hours (F-231: measured against the upstream fix size below, not asserted) |

---

## 1. Upstream Provenance & Diagnostic Horizon

### Provenance Metadata
- **Repository**: [react-hook-form/react-hook-form](https://github.com/react-hook-form/react-hook-form)
- **Upstream Pull Request**: PR #13613 (*"🐞 fix: clear internal errors state on argument-less clearErrors() (#13613)"*)
- **Parent Base Commit**: `d96c5ceef12cb53266ce1ae5e65fba301a31fe57` (immediately pre-fix parent commit on `master`)
- **Fix Commit**: `69da9545b222aceb5fc8ea15e851cab83b1c84f6`

### Upstream Fix Size (measured, F-231)
`gh api repos/react-hook-form/react-hook-form/commits/69da9545b222aceb5fc8ea15e851cab83b1c84f6`:

| File | Change |
|---|---|
| `src/logic/createFormControl.ts` | +2 / −1 |
| `src/__tests__/logic/createFormControl.test.ts` | +20 / −0 |

The horizon claim rests on this number, not on prose. The EDIT is two lines
(`_formState.errors = {}`, then publish that same object); the cost is finding it.

### Diagnostic Ambiguity & Real-World Complexity (1–3 Hours)
In `react-hook-form`, state management uses a multi-layered architecture:
1. **`_proxyFormState`**: Dynamic Proxy wrappers tracking which specific properties (`errors`, `isDirty`, `touchedFields`) are read during component renders.
2. **`_subjects.state`**: Event streams notifying subscribed React components of state updates during form interactions.
3. **`_formState`**: The canonical internal state container holding raw error maps and field metadata.
4. **`getFieldState`**: Direct query method reading state from `_formState` and field descriptors without creating proxy subscriptions.

When `clearErrors()` was called without parameters, it executed `_subjects.state.next({ errors: {} })`. An engineer or AI agent investigating an issue where `getFieldState(name).invalid` returns `true` after calling `clearErrors()` faces significant diagnostic ambiguity:
- Event-based component tests and UI re-renders show subscriber state receiving `{ errors: {} }`, giving the false appearance that errors were cleared.
- Direct state queries (`getFieldState`) and proxy accesses inspect internal `_formState.errors`, which still retained stale error objects because `_formState.errors = {}` was missing.
- Disentangling subscriber state notifications from internal reference storage requires tracing proxy subscriptions, subject streams, and state accessors across `createFormControl.ts`, `useForm.ts`, `useController.ts`, and `getFieldState.ts`. This structural divergence between published event payloads and stored state references represents a genuine multi-hour brownfield diagnostic challenge.

### Outcome-Shaped Task Goal
The task goal is strictly outcome-shaped:
> Ensure that an argument-less `clearErrors()` call cleanly clears all field errors and resets form error state, so that `getFieldState(fieldName).invalid` returns `false` and formState errors are completely cleared across all accessors and subscriptions, while keeping all pre-existing tests passing and typechecks clean.

---

## 2. Upstream Reproduction & Verification Commands

### Environment Setup Sequence
To reproduce this task from a clean environment:
```bash
# 1. Clone target repository
git clone https://github.com/react-hook-form/react-hook-form.git
cd react-hook-form

# 2. Fetch specific commits
git fetch origin d96c5ceef12cb53266ce1ae5e65fba301a31fe57 69da9545b222aceb5fc8ea15e851cab83b1c84f6

# 3. Checkout base pinned ref (immediately pre-fix)
git checkout d96c5ceef12cb53266ce1ae5e65fba301a31fe57

# 4. Install dependencies using target's own package manager
pnpm install --frozen-lockfile
```

### Requirement Verification Commands

| Requirement ID | Description | Verbatim Verification Command Script |
|---|---|---|
| **Base Verification** | Base test suite passes on base ref | `pnpm install --frozen-lockfile && pnpm test` |
| **R1** | Dependencies install clean | `pnpm install --frozen-lockfile` |
| **R2** | Full pre-existing test suite green (>= 1208 tests) | See verbatim script below (uses timestamped tempfile, explicit `rm -f`, `fs.existsSync` check, and `r.success` assertion to prevent stale output or exit code suppression) |
| **R3** | Project typechecks clean | `pnpm type` (`tsc --noEmit`) |
| **R4** | Root-cause probe: argument-less `clearErrors()` resets `_formState.errors` & `getFieldState.invalid` | See verbatim probe script below (complete heredoc without truncation) |

#### R2 Verbatim Script
```bash
set -e
OUTFILE="/tmp/rhf-jest-result-$(date +%s).json"
rm -f "$OUTFILE"
pnpm jest --config ./scripts/jest/jest.config.js --json --outputFile="$OUTFILE" > /tmp/rhf-jest.log 2>&1 || true
node -e "
const fs = require('fs');
if (!fs.existsSync('$OUTFILE')) {
  console.error('Jest output JSON file was not generated');
  process.exit(1);
}
const r = JSON.parse(fs.readFileSync('$OUTFILE', 'utf8'));
fs.unlinkSync('$OUTFILE');
if (!r.success || r.numFailedTests !== 0) {
  console.error('failed tests:', r.numFailedTests);
  process.exit(1);
}
if (r.numTotalTests < 1208) {
  console.error('expected >= 1208 total tests, got', r.numTotalTests);
  process.exit(1);
}
"
```

#### R4 Verbatim Script (Self-Contained Probe)
```bash
set -e
PROBE_DIR="src/__tests__/__probe__"
PROBE_FILE="$PROBE_DIR/clear-errors-root-cause.test.ts"
mkdir -p "$PROBE_DIR"
cat > "$PROBE_FILE" <<'TESTEOF'
import { createFormControl } from '../../logic/createFormControl';

describe('root cause probe: argument-less clearErrors', () => {
  it('resets internal _formState.errors and field state status', () => {
    const { setError, clearErrors, getFieldState, control } =
      createFormControl<{
        foo: string;
        bar: string;
      }>();

    setError('foo', { type: 'required' });
    setError('bar', { type: 'required' });

    expect(getFieldState('foo').invalid).toBe(true);
    expect(control._formState.errors).not.toEqual({});

    clearErrors();

    expect(getFieldState('foo').invalid).toBe(false);
    expect(getFieldState('bar').invalid).toBe(false);
    expect(control._formState.errors).toEqual({});
  });
});
TESTEOF
pnpm test "$PROBE_FILE"
```

---

## 3. Observed RED-on-Pin Evidence

Tested on clone of target repo at pinned base ref `d96c5ceef12cb53266ce1ae5e65fba301a31fe57`.

### Base Verification Command Output
```text
$ git checkout d96c5ceef12cb53266ce1ae5e65fba301a31fe57
HEAD is now at d96c5cee 🐞 fix: preserve dirtyFields reference stability (#13612)

$ pnpm install --frozen-lockfile && pnpm test
...
Test Suites: 120 passed, 120 total
Tests:       1208 passed, 1208 total
Snapshots:   8 passed, 8 total
Time:        4.896 s
Ran all test suites in 2 projects.
Exit Code: 0
```

### Requirement R1–R3 Execution
- **R1** (`pnpm install --frozen-lockfile`): PASS (exit code 0)
- **R2** (Jest suite check): PASS (`numTotalTests: 1208`, `numFailedTests: 0`, exit code 0)
- **R3** (`pnpm type`): PASS (`tsc --noEmit` clean, exit code 0)

### Requirement R4 (Root-Cause Probe) Output — FAIL / RED
```text
$ pnpm test src/__tests__/__probe__/clear-errors-root-cause.test.ts
$ jest --config ./scripts/jest/jest.config.js src/__tests__/__probe__/clear-errors-root-cause.test.ts
FAIL Web src/__tests__/__probe__/clear-errors-root-cause.test.ts
  root cause probe: argument-less clearErrors
    ✕ resets internal _formState.errors and field state status (7 ms)

  ● root cause probe: argument-less clearErrors › resets internal _formState.errors and field state status

    expect(received).toBe(expected) // Object.is equality

    Expected: false
    Received: true

      17 |     clearErrors();
      18 |
    > 19 |     expect(getFieldState('foo').invalid).toBe(false);
         |                                          ^
      20 |     expect(getFieldState('bar').invalid).toBe(false);
      21 |     expect(control._formState.errors).toEqual({});
      22 |   });

      at toBe (src/__tests__/__probe__/clear-errors-root-cause.test.ts:19:42)

Test Suites: 1 failed, 1 total
Tests:       1 failed, 1 total
Snapshots:   0 total
Time:        0.441 s
Ran all test suites matching src/__tests__/__probe__/clear-errors-root-cause.test.ts.
Exit Code: 1
```

---

## 4. Observed GREEN-on-Known-Fix Evidence

Tested on clone of target repo at fix commit `69da9545b222aceb5fc8ea15e851cab83b1c84f6`.

### Base Verification Command Output
```text
$ git checkout 69da9545b222aceb5fc8ea15e851cab83b1c84f6
HEAD is now at 69da9545 🐞 fix: clear internal errors state on argument-less clearErrors() (#13613)

$ pnpm install --frozen-lockfile && pnpm test
...
Test Suites: 120 passed, 120 total
Tests:       1208 passed, 1208 total
Snapshots:   8 passed, 8 total
Time:        3.757 s
Ran all test suites in 2 projects.
Exit Code: 0
```

### Requirement R1–R4 Execution
- **R1** (`pnpm install --frozen-lockfile`): PASS (exit code 0)
- **R2** (Jest suite check): PASS (`numTotalTests: 1208`, `numFailedTests: 0`, exit code 0)
- **R3** (`pnpm type`): PASS (`tsc --noEmit` clean, exit code 0)
- **R4** (Root-cause probe): PASS / GREEN

```text
$ pnpm test src/__tests__/__probe__/clear-errors-root-cause.test.ts
$ jest --config ./scripts/jest/jest.config.js src/__tests__/__probe__/clear-errors-root-cause.test.ts
PASS Web src/__tests__/__probe__/clear-errors-root-cause.test.ts
  root cause probe: argument-less clearErrors
    ✓ resets internal _formState.errors and field state status (3 ms)

Test Suites: 1 passed, 1 total
Tests:       1 passed, 1 total
Snapshots:   0 total
Time:        0.4 s, estimated 1 s
Ran all test suites matching src/__tests__/__probe__/clear-errors-root-cause.test.ts.
Exit Code: 0
```
