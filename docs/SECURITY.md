# Security & Threat Model

Chikory runs autonomous agents that write and execute code. This document is the standing security design across all stages; every WP that touches executors, the judge, artifacts, or the control plane must check against it. Regulated-buyer requirements (spec §11 ZDR caveat) are designed in here, not bolted on at P4 (NF-4).

## 1. Assets

| Asset | Why it matters |
|---|---|
| User source code (workspaces, diffs, transcripts) | Often proprietary; transcripts can embed whole files |
| Provider API keys | Direct spend + account access |
| The journal & dataset (WP-306) | Aggregated traces reveal codebases and practices |
| Judge integrity | A compromised/biased judge silently approves bad changes — the product promise inverts |
| User's repos & machines | Executor has write + exec capability |

## 2. Threat model & mitigations

### T1 — Executor escapes task scope (malicious or confused agent)
The primary threat. An LLM-driven executor may write outside the workspace, exfiltrate code, install malware, or run destructive commands (prompt injection via repo contents is a live vector — README/code comments are untrusted input).

Mitigations (P1, WP-111/112):
- Workspace = dedicated git worktree; adapters launch CLI agents with **deny-by-default permissions** scoped to it (Claude Code: permission config; others: equivalent flags or OS sandbox).
- Conformance suite asserts no writes outside `workspaceDir` (executors.md §conformance #3).
- Step caps (`maxSeconds`/`maxTurns`/`maxCostUsd`) bound blast radius per step.
- Network egress for executors: allowed in P1 (CLI agents need provider APIs), **documented as the residual risk**; P2 hardening WP adds an opt-in egress allowlist mode (provider endpoints + package registries only).
- Standing judge rubric items (P1): "no secrets introduced", "no unrelated deletions", "diff matches instruction scope" — the judge is itself a security control gating every N steps.

### T2 — Prompt injection from repo contents
Brownfield repos may contain adversarial text targeting the executor or judge.

- Judge structural separation (JD-5): judge never receives the executor's instruction stream; evidence is diffs/tests/criteria — injection must survive a different prompt regime and model family to fool both.
- Judge runs `check` commands itself in a sandbox; executor claims are never trusted (JD-4).
- P2 (WP-215): security rubric pack adds explicit injected-instruction scan over diffs.

### T3 — Secret leakage
- Invariant #5: keys via env only; `.env` gitignored; validation fails fast on missing vars rather than prompting users to inline keys.
- Journal/JIF redaction guarantee (journal-format.md §4): env values never serialized; transcripts scanned for high-entropy strings before artifact `put` (P2; P1 relies on judge rubric "no secrets in diff").
- Dataset pipeline (WP-306): opt-in flag + second scrub pass; local-first default means nothing leaves the machine without explicit action.

### T4 — Judge subversion (reward hacking, drift, poisoning)
- Verdict computed by **code** from binary form answers (CONTRACTS.md §4) — the model cannot free-text its way to PROCEED.
- Memory provenance (CM-4): judge evidence excludes executor-authored memory when verifying executor claims.
- Flip-flop/drift rules force ESCALATE to a human; cross-family fixture disagreement tracked in CI (judge.md §testing).

### T5 — Supply chain
- `devbox.json` + lock pins the toolchain; no global installs (devbox-only rule).
- Dependencies minimal by policy (NF-1 helps security too); lockfiles committed; CI on pinned versions.
- P3 release WP-305 includes: signed releases, SBOM, `SECURITY.md` disclosure policy at repo root, npm/PyPI provenance attestation.

### T6 — Control plane (Stage 2 — binding design constraints now)
- Tenant isolation: per-tenant encryption keys for stored journals/artifacts; row-level tenancy enforced in the data layer, not application code alone.
- **Per-artifact-kind residency**: customers choose what is hosted (e.g., journals hosted, transcripts local-only) — the ZDR/HIPAA answer; transcript-local mode must keep trace browser functional (refs render as "local-only").
- AuthN: OIDC; SSO (SAML/OIDC) + SCIM at enterprise tier (WP-406). AuthZ: RBAC — roles `viewer` / `operator` (run, approve ESCALATEs) / `admin` (keys, members, retention policy).
- Audit log: every approve/reject, config change, retention change, key rotation — append-only, exportable (same discipline as the journal).
- Hosted judge: customer provider keys held in KMS-backed vault, used only at call time, never logged; or customers point hosted judge at their own gateway.
- The OSS SDK never phones home (control-plane.md constraint #1) — telemetry to Chikory cloud is opt-in config, absent by default.

### T7 — Availability / abuse (Stage 2)
- Budget caps double as abuse caps; per-tenant rate limits on hosted judge; runaway-run reaper (no step progress + spend accruing → suspend + notify).

## 3. Compliance trajectory (enterprise gate, P4)

| Milestone | When |
|---|---|
| Security disclosure policy + threat model public | P3 (WP-305) |
| SOC 2 Type I scope definition; logging/audit prerequisites built | P4 start (WP-406) |
| SOC 2 Type II observation window | P4 second half |
| Data-residency options (region pinning), DPA template, ZDR mode documented | P4 (WP-406) |
| HIPAA posture statement (likely: supported only in local-first / BYO-infra mode initially) | P4 |

## 4. Security testing

- Conformance suites: workspace confinement, redaction, terminal states (every release).
- Adversarial fixture pack for the judge: injected-instruction diffs, secret-introducing diffs, scope-creep — expected non-PROCEED (judge.md fixtures; extended by WP-215).
- P4: external pentest before enterprise GA; dependency + container scanning in CI.

## 5. Residual risks (stated, not hidden)

1. P1 executors have network egress (CLI agents require it) — allowlist mode lands P2; until then, run untrusted-repo tasks in a VM.
2. Judge is probabilistic: gates reduce, not eliminate, bad changes — positioning and docs must never claim otherwise ("fewer failed runs", not "no failed runs").
3. CLI-agent internals are opaque (ADR-003 consequence); we bound and observe them, we don't control them.
