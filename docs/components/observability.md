# Component: Observability

**Phase**: P1, extended P2/P4 · **WPs**: WP-105, WP-134, WP-142, WP-209, WP-403 · **Requirements**: OB-1..6, RT-7 · **Invariant**: #3
**Code**: `packages/sdk-ts/src/otel.ts` + journal renderer in CLI

## Purpose

"Minimal abstraction + maximal observability" (spec §4). Two complementary systems with one truth:

1. **OTel spans/metrics** — for machines and existing stacks (RT-7): teams point `OTEL_EXPORTER_OTLP_ENDPOINT` at whatever they already run (Grafana, Datadog, Langfuse, …). Chikory ships no proprietary sink.
2. **The journal** — for humans and forensics (OB-5): append-only, complete, renderable by `chikory trace`, exportable as JSON.

Rule: OTel is derived from the same events that hit the journal (one emit site per event class) — the two can never disagree.

## Span model

```
chikory.run (trace root)                 attrs: run-id, task, executor, judge, policy hash
 ├─ chikory.step #n                      attrs: instruction hash, status, tokens, cost, duration
 │   ├─ chikory.llm.call (×m)            attrs: stage, provider, model, tokens, cost, latency, retries, outcome
 │   └─ chikory.tool.call (×k)           attrs: tool, status(SUCCESS/FAILED), bytes→artifact
 ├─ chikory.checkpoint #n                attrs: git commit, journal idx, ctx tokens (pre/post compaction)
 └─ chikory.judge.pass #j                attrs: verdict, criteria pass/fail counts, cost, evidence bytes
```

CLI-agent executors are a span-granularity exception: internals are opaque, so the step span carries aggregate numbers + `transcriptRef` for drill-down.

## Metrics (OB-6, SE-3 — WP-209)

Per run, derived from journal, exposed as OTel metrics + `trace` footer: total/per-stage tokens & cost · decisions (steps) · checks (judge passes) & verdict mix · feedback frequency (judge passes per step) · rollback/escalation counts · components produced over time (from task-tree completions) · issues-found : changes-made ratio · compaction savings · judge cost share.

These are the spec §5.9 orchestrator process metrics — they exist to evaluate **Chikory itself**, and they feed the P3 benchmark report directly.

## Decision-tree tracing (OB-1)

Every *decision* — verdict, retry, failover, rollback target, pacing choice, compaction — is a journal entry with machine fields **and** a human rationale string. `chikory trace` renders the tree; nothing decides silently (NF-2).

## What we deliberately don't build (P1–P3)

No bundled dashboard/UI (P4's trace browser renders the journal in a browser, nothing more), no log aggregation, no alerting — existing OTel ecosystems do this better; we emit cleanly into them.
