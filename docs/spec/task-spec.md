# task.yaml — Task Specification Format (WP-005)

User-facing YAML form of `TaskSpec` ([CONTRACTS.md §2](CONTRACTS.md)). Parsed with zod; validation rules in CONTRACTS.md §9. Examples ship in `examples/`.

## Full annotated example

```yaml
name: memory-pointer-store
goal: >
  Implement the ArtifactStore (Memory Pointer pattern) per
  docs/components/artifacts.md: content-addressed local FS backend,
  put/get/excerpt, applied to tool outputs over 8KB.

repos:
  - url: .                      # local path or git URL
    ref: main
    writable: true
  # - url: https://github.com/org/context-repo   # read-only reference repo
  #   writable: false

acceptance_criteria:
  - id: AC-1
    description: ArtifactStore interface implemented with content-addressed FS backend
    check: devbox run -- pnpm --filter sdk-ts test artifacts   # judge runs this; exit 0 = pass
  - id: AC-2
    description: Tool outputs >8KB stored externally; only ArtifactRef enters context
    check: devbox run -- pnpm --filter sdk-ts test memory-pointer
  - id: AC-3
    description: excerpt() returns targeted slices by range and query
    # no check command → judge evaluates from diff + tests evidence (binary rubric)

budget_usd: 20
max_steps: 60

executor:
  adapter: claude-code          # registered ExecutorAdapter name
  family: anthropic

judge:
  family: gemini                # MUST differ from executor.family (or allow_same_family: true + warning)
  cadence: 3                    # judge every N steps
  scoring_method: pointwise
  max_cost_share: 0.25          # warn if judging exceeds 25% of spend
  # rubric_packs: [security]    # P2

routing:
  stages:
    plan:   { provider: anthropic, model: claude-haiku-4-5-20251001 }
    code:   { provider: anthropic, model: claude-fable-5 }
    review: { provider: anthropic, model: claude-fable-5 }
    judge:  { provider: gemini,   model: gemini-2.5-pro }
  failover:
    judge:
      - { provider: openai, model: gpt-5.2 }

# P2 optional blocks:
# pacing:        { mode: auto }                       # WP-207
# notifications: { on: [escalate, milestone], slack_webhook_env: CHIKORY_SLACK_URL }  # WP-208
```

## Rules of note

- `check` commands run **by the judge** in a sandbox against the current workspace — never trusted from executor claims (JD-4). All checks must be devbox invocations for this repo's own tasks.
- Provider API keys are resolved from env at parse time; a stage routed to an unconfigured provider fails validation immediately, naming the variable.
- Defaults: `cadence: 3`, `scoring_method: pointwise`, `max_steps: 100`, routing falls back to `defaultPolicy(executor.family)` which auto-picks a different-family judge.
- Criteria with no `check` are judged from evidence only — prefer machine-checkable criteria wherever possible (OB-3); the benchmark requires them.
