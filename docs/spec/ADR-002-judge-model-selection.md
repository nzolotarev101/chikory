# ADR-002: Agent-as-a-Judge Model Selection

**Status**: Open  
**Date**: 2026-06-09

## Context

The judge must be structurally different from the executor to mitigate self-preference, position, and verbosity biases. Options:

1. **Different provider family** — e.g., executor=Anthropic, judge=OpenAI or Gemini
2. **Same provider, different model size** — e.g., executor=Sonnet, judge=Opus
3. **Fine-tuned evaluator model** — specialized judge trained on rubric scoring
4. **Multi-model debate** (ChatEval/DEBATE) — multiple judges vote

## Decision

Default: **Option 1 — different provider family**. Configurable per-run. Fine-tuned evaluator is Stage 2+.

## Consequences

- Users must supply API keys for at least two providers to use default judge behavior
- Single-provider mode available as a fallback (same provider, different model — weaker bias mitigation, must be explicit)
- Adds latency and cost per judging pass — must be transparent in spend controls

## Scoring methodology

Default: **pointwise rubric scoring** with chain-of-thought. Pairwise comparison available for output-quality decisions. Binary/low-precision scoring enforced to resist reward hacking.
