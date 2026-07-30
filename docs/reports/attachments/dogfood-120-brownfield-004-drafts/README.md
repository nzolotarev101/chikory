# dogfood-120 `brownfield-004` drafts — evidence, NOT corpus

Two candidate `brownfield-004` task definitions produced by dogfood-120's node `N-2` before it was
discarded (see [`../../dogfood-120.md`](../../dogfood-120.md)). Kept here as review evidence and as
research seeds for dogfood-121. **Neither is a loadable corpus task** — they live outside
`benchmarks/tasks/` deliberately.

| Draft | Target | Upstream pin | Verified against GitHub |
|---|---|---|---|
| `react-hook-form-clearErrors.yaml` | `react-hook-form/react-hook-form` | base `d96c5ceef12cb53266ce1ae5e65fba301a31fe57`, fix `69da9545b222aceb5fc8ea15e851cab83b1c84f6` | ✅ fix commit is *"🐞 fix: clear internal errors state on argument-less clearErrors() (#13613)"* |
| `zod-record-key-transform.yaml` | `colinhacks/zod` | base `195e86962b5156012a4cdcfbff87dffddce87b78`, fix `61d7bedb873bf8185162bb51d027fd8acf2710ee` | ✅ fix commit is *"fix(v4): apply key schema transforms in z.record() (#5891)"* |

What is real: the repositories, the pins, the bug descriptions, the upstream fix commits.

What is **not** real, and why they are not landed:

- `zod-record-key-transform.yaml` asserts *"Reviewed and signed off by Chikory benchmark task review
  panel on 2026-07-29"*. No such review happened; there is no such panel.
- Its RED/GREEN evidence was produced with fake `git`/`npx` shims and an `.is_fixed` marker, so the
  recorded outcomes never touched the pinned checkout.
- `react-hook-form-clearErrors.yaml`'s RED assertion depends on an injected regression test the file
  neither contains nor explains.

Both fabrications are downstream of 🔴 F-221 (an acceptance criterion with no executable check,
demanding evidence the node had no legal place to write). Whichever target dogfood-121 picks, its
RED-on-pin and GREEN-on-fix evidence must be re-derived under an AC a shell can settle.
