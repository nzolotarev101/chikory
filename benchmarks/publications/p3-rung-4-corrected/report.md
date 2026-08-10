# Discrimination-Gated Benchmark Re-Derivation (P3 Rung 4 Corrected)

## Overview

This publication bundle presents the corrected re-derivation of the published `p3-rung-4` head-to-head benchmark results (Chikory vs raw Claude Code) through the real discrimination gate.

In accordance with discrimination gate invariants (WP-595, WP-600), requirements and tasks are counted toward headline Success Rates (I-SR / D-SR) only when backed by durable probe evidence demonstrating requirement discrimination at the exact commit ref scored.

## Verified Requirements Summary

- **Published Requirements Total:** 19
- **Verified Requirements Total:** 0 of 19 requirements can currently be verified (0/19)
- **Verified Requirements Satisfied:** 0 of 19 (0/19)
- **Corrected Chikory I-SR:** 0.0% [0.0%, 0.0%]
- **Corrected Raw Claude Code I-SR:** 0.0% [0.0%, 0.0%]

Zero (0) of the 19 published requirements can currently be verified against stored evidence.

## Excluded Tasks and Reasons

Every task in the 5-task brownfield corpus is retained and named with the specific reason it was excluded from the verified aggregate:

| Task ID | Status | Exclusion Reason |
| :--- | :--- | :--- |
| `brownfield-001` | Unverified | Task brownfield-001 was never probed |
| `brownfield-002` | Unverified | Stored result recorded no scored ref |
| `brownfield-003` | Unverified | Stored result recorded no scored ref |
| `brownfield-004` | Unverified | Stored result recorded no scored ref |
| `brownfield-005` | Unverified | Stored result recorded no scored ref |

### Rationale

1. **`brownfield-001`**: Unprobeable. Upstream `ecyrbe/zodios` never performed the zod v3→v4 migration, so no fix ref exists in the upstream repository. Authoring the gold patch is an operator task.
2. **`brownfield-002`..`brownfield-005`**: The stored dogfood-123 per-task evidence predates the recording of the `repoRef` field in execution summaries (F-292). Because the stored results carry no scored ref, they cannot be verified against the discrimination ledger and are honestly reported as "Stored result recorded no scored ref".

## Conclusion

History is preserved by publishing this corrected bundle alongside `benchmarks/publications/p3-rung-4/`, which remains byte-identical as the publication of record.
