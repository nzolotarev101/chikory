# Component: Control Plane (Stage 2)

**Phase**: P4 (months 4–9) · **WPs**: WP-401..408 · **Requirements**: IF-5, ST-4, NF-4, RT-9, OB-5 · **Dir**: `services/control-plane/`
**Security constraints**: [docs/SECURITY.md §T6/T7](../SECURITY.md) are binding. **Pricing/GTM**: [docs/PRODUCT.md](../PRODUCT.md).

## 1. Purpose & binding constraints

Productize the judge (spec §10 Stage 2): hosted judges, hosted checkpointers/state, hosted trace browser — for teams who want the reliability shell without operating Temporal/storage. Constraints decided now and permanent:

1. **Local-first forever** (RT-9). Every hosted service is an alternative backend behind an existing interface (`DurableRunner`, `ArtifactStore`, judge endpoint, OTLP sink). Cloud orchestrates; never gatekeeps. OSS SDK never phones home.
2. **No cloud-only capabilities.** Trace browser renders JIF; hosted judge runs the same harness. Cloud = convenience + collaboration.
3. **One truth.** Meters, dashboards, and the trace browser are derived from journal events — never separately counted (architecture rule #3).
4. **Compliance designed in** (SECURITY.md §T6): tenancy isolation, per-artifact-kind residency, audit log, RBAC from the first deployed version.

## 2. Service architecture

```
                      ┌─────────────────────────────────────────────┐
   SDK/CLI (customer) │              api-gateway (REST)             │  web app (trace browser,
   ──────────────────►│  authn (OIDC/SAML) · authz (RBAC) · rate    │◄── dashboards, HITL inbox)
                      │  limits · audit-log emission                │
                      └────┬──────────────┬──────────────┬──────────┘
                           │              │              │
                ┌──────────▼───┐  ┌───────▼──────┐  ┌────▼─────────┐
                │ run-service  │  │ judge-service │  │ trace-service│
                │ runs, state, │  │ hosted judge  │  │ JIF ingest,  │
                │ checkpoints, │  │ harness; key  │  │ query, render│
                │ approvals    │  │ vault (KMS)   │  │ permalinks   │
                └──────┬───────┘  └───────┬──────┘  └────┬─────────┘
                       │                  │              │
        ┌──────────────▼──────────────────▼──────────────▼───────────┐
        │ data layer: Postgres (tenancy, runs, meters, audit)        │
        │ object store (artifacts, JIF docs) · Temporal Cloud or     │
        │ managed Temporal (workflows) · per-tenant KMS keys         │
        └────────────────────────────────────────────────────────────┘
                       │
                ┌──────▼────────┐
                │ meter-service │ journal events → usage meters → billing (Stripe)
                └───────────────┘
```

- **Stack**: TypeScript services (consistency with SDK), Postgres, S3-compatible object store, Temporal (Cloud preferred — "partner on infra", spec §11), deployed on managed k8s. Boring choices on purpose.
- **run-service**: hosted `DurableRunner` backend. Two modes: (a) *state-only* — customer workers execute locally, state/checkpoints/journal hosted (the common case; code never leaves customer machines); (b) *full-hosted* — runs execute in Chikory-managed sandboxes (later in P4; requires SECURITY.md T1 sandbox story at cloud strength).
- **judge-service**: stateless judge harness behind an endpoint; accepts `JudgeEvidence`, returns `JudgeVerdict`; enforces family-diversity server-side too. Customer keys vaulted or BYO-gateway.
- **trace-service**: JIF ingest + query API; the web trace browser is a pure client of it. ESCALATE inbox = `AWAITING_APPROVAL` runs + approve/reject (writes through run-service, audit-logged).
- **meter-service**: consumes journal events (the single truth) → meters: `agent_run_started`, `step_executed`, `judge_call`, `gb_artifact_stored`. Billing maps meters → Stripe usage records.

## 3. API surface (v1 sketch)

```
POST   /v1/runs                       start (TaskSpec) — state-only or hosted
GET    /v1/runs/{id}                  RunStatusReport
POST   /v1/runs/{id}/resume|cancel|approve|inject
GET    /v1/runs/{id}/journal          JIF (paginated/JSONL stream)
GET    /v1/runs/{id}/artifacts/{aid}  artifact fetch (residency-aware: 404+reason if local-only)
POST   /v1/judge/evaluate             hosted judge (evidence → verdict)
GET    /v1/usage                      meters by period/project
*      /v1/orgs|projects|members|keys|audit  — standard CRUD, RBAC-gated
```

Versioned path; breaking changes = new version; SDK pins. OpenAPI spec is the contract artifact of WP-404 and is generated-from-code, reviewed like CONTRACTS.md.

## 4. Data model (Postgres, row-level tenancy)

`orgs → projects → runs → (journal_entries, checkpoints, artifacts-index, approvals)` · `members(org, user, role)` · `api_keys(project, hashed, scopes)` · `meters(project, kind, qty, period)` · `audit_log(org, actor, action, target, ts)` append-only.
Artifacts bulk in object store under `tenant/{org}/...` with per-tenant KMS data keys; Postgres holds refs + metadata only (mirrors local design — refs everywhere, bulk in store).

## 5. Work packages (detail in plan.md §8)

| WP | Epic | Key acceptance criteria |
|---|---|---|
| WP-401 | run-service (state-only mode) + hosted ArtifactStore | Local CLI run with `backend: cloud` survives laptop loss; `chikory resume` from another machine; transcripts respect residency=local |
| WP-402 | judge-service | Same verdicts as local harness on fixture suite; keys never logged (assert via log scrub test); family enforcement server-side |
| WP-403 | trace browser + HITL inbox | Renders any valid JIF; permalink sharing; approve/reject ESCALATE with audit entry; parity test vs `chikory trace` output |
| WP-404 | api-gateway, orgs/projects, OIDC, RBAC, OpenAPI | Role matrix tested (viewer can't approve); audit log on every mutating call |
| WP-405 | meter-service + usage API | Meter totals reconcile with journal totals exactly (property test); usage visible per project/day |
| WP-406 | Enterprise: SSO/SAML+SCIM, audit export, residency controls, SOC2 groundwork | Per-artifact-kind residency enforced at API; region pinning; DPA template; SOC2 Type I evidence collection running |
| WP-407 | Billing + spend dashboards | Stripe integration; free tier limits enforced via meters; dashboard = ledger-derived, matches `/v1/usage` |
| WP-408 | Operations: deploy, SLOs, DR | See §6 — all targets monitored with alerts before GA |

## 6. Operations (WP-408)

- **SLOs (initial)**: API availability 99.9%; run-state durability 99.999999% (object-store class); judge-service p95 latency < 2× model latency; trace ingest lag p95 < 30s.
- **DR**: Postgres PITR + cross-region replica; object store versioned + cross-region replication; Temporal Cloud multi-region namespace. RPO ≤ 5 min, RTO ≤ 4h. Quarterly restore drill (journal cost-conservation property doubles as integrity check).
- **Degradation mode**: cloud outage must not stop customer runs — SDK falls back to local checkpointing and back-syncs on recovery (local-first pays off operationally).
- **Runbooks** in `services/control-plane/runbooks/`: stuck-run reaper, key rotation, tenant export/delete (GDPR), incident comms template.
- **Observability**: services emit OTel like everything else; internal dashboards from the same spans customers get.

## 7. Entry criteria for starting P4

P3 shipped (benchmark public, OSS launched); ≥3 external users running Chikory locally (hosting is the bottleneck signal); month-6 stop-signal passed (WP-304).

## 8. Exit criteria (Stage 2 done → Stage 3)

Paying customers on unit pricing; ≥1 enterprise contract (SSO+audit in production use); SLOs held for a quarter; SOC 2 Type I report issued; support load per customer trending down (productized, not consulting).
