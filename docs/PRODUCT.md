# Product Strategy — Users, Pricing, GTM, Enterprise Readiness

Companion to `plan.md` (what to build) — this is *who it's for, what they pay, how it reaches them*, consolidated from spec §3, §7, §9, §10, §11. Reviewed at every phase boundary.

## 1. Personas

| Persona | Stage | Job-to-be-done | What they need from us |
|---|---|---|---|
| **Solo builder / indie** (incl. us, dogfooding) | P1+ | Multi-hour agent runs that don't burn money or melt down overnight | <10-min quickstart, local-first, hard budget caps, readable traces |
| **AI-engineering / platform team** (primary buyer, spec §7) | P2–P4 | Coding agents already in use, no orchestration layer for multi-day work | Vendor neutrality (their model contracts), OTel into their stack, judge gates, HITL inbox |
| **Engineering leader** (economic buyer) | P4 | Trust + cost story for agent adoption (the 79%→11% gap) | Spend governance, audit trail, benchmark evidence, SOC 2 |
| **Regulated-industry platform team** | P4–P5 | Agents with provable change control | Residency controls, ZDR mode, judge-verified audit per change |

Beachhead question (spec §11 open): resolved **empirically, not upfront** — P3 OSS launch is the sensor. Hypothesis order: AI-native startups first (fast adopters, real long-horizon needs), enterprise follows the benchmark + SOC 2, indie sustains the OSS funnel. Revisit at P4 entry with telemetry + interview data.

## 2. Initial use cases (spec §7)

Multi-repo feature implementation · maintenance automation · migration work · internal-tool generation. These four drive: example tasks (WP-144), benchmark task selection (WP-302), and the Stage-3 vertical shortlist.

## 3. Pricing (spec §9 synthesis)

Principle: buyers resist *unpredictability* more than price; agents (not seats) are the 24/7 consumer → no per-seat core pricing.

| Tier | Price | Gets |
|---|---|---|
| **OSS / local** | Free forever (MIT) | Everything local-first: runner, judge, CLI, traces. BYO keys + Temporal |
| **Free cloud** | $0, generous caps | State-only hosting, trace browser, N runs + M judge-calls/mo — the funnel |
| **Pro** | $29–199/mo + usage | Unit pricing: per agent-run + per judge-call + artifact GB; caps configurable; spend dashboards |
| **Enterprise** | Contract | SSO/SAML+SCIM, audit export, residency/ZDR mode, SLAs, support; platform fee + usage |
| **Stage 3 packs** | Per-app subscription | Vertical pack + steward maintenance with contractual SLOs |

Rules: usage meters derive from journal events (one truth — control-plane.md §2); every meter visible to the customer *before* the bill (the budget ledger **is** the pricing UX); pass-through model costs always itemized separately from Chikory fees. Avoid: outcome-based and pure-token pricing (documented buyer backlash, spec §9).

## 4. GTM by phase

| Phase | Motion | Proof artifact |
|---|---|---|
| P1–P2 | Build in public; dogfood reports as content ("Chikory built this WP, judge caught X") | `docs/reports/dogfood-*.md` |
| P3 | **Benchmark launch** — the GTM event: vendor-neutral leaderboard + raw traces + methodology; OSS MIT release | WP-303/304/305 |
| P4 | Cloud waitlist from OSS users; design-partner conversions; "hosted in minutes" path | WP-401–407 |
| P5 | Vertical pack with contractual SLOs; design-partner case studies → repeatable sales | WP-507 |

Positioning guardrails (spec §4/§11): never "autonomous magic" — always "fewer failed runs, lower supervision cost, clearer spend"; over-index on artifacts skeptical developers can verify (traces, ablations, ranges not points); "not another framework" stated explicitly in all top-of-funnel copy.

## 5. Success metrics per phase

| Phase | Metric | Target |
|---|---|---|
| P1 | MVP exit gates | 5/5 (plan.md §1.4) |
| P2 | Long-horizon proof | 24h+ brownfield run, ≥1 suspend/resume, zero rot-shaped failures |
| P3 | Benchmark + adoption | Beat OpenHands on 50-task subset (month-6 stop signal); external users ≥ 3; traces published |
| P4 | Revenue quality | Paying logos; ≥1 enterprise (SSO in prod); meter-reconciliation exact; SLOs held a quarter |
| P5 | Recurring outcome revenue | ≥1 pack GA; steward runs dominate usage; partners renew |

North-star (all phases): **end-to-end success rate per dollar on long-horizon tasks** — the compounding-error thesis, measured.

## 6. Enterprise readiness checklist (gates P4 GA)

- [ ] SOC 2 Type I (Type II window started) — WP-406
- [ ] SSO (SAML/OIDC) + SCIM — WP-406
- [ ] RBAC role matrix + append-only audit log + export — WP-404/406
- [ ] Per-artifact-kind residency + region pinning + ZDR mode documented — WP-406, SECURITY.md §T6
- [ ] DPA template, subprocessor list, security whitepaper (threat model public) — WP-406/305
- [ ] SLOs published + status page; DR drill passed — WP-408
- [ ] Tenant export/delete (GDPR) runbook tested — WP-408
- [ ] External pentest clean — SECURITY.md §4
- [ ] Pricing: committed-use contract option; itemized pass-through model costs — WP-407
- [ ] Support: severity matrix + response SLAs — WP-408

## 7. Strategy-changing signals (standing watch — spec §11)

Reviewed at each phase boundary: frontier models >90% SWE-bench Verified → weight brownfield harder (P3 already does) · Cognition ships model-neutral SDK → accelerate judge-as-runtime messaging · providers ship native judge primitives → moat shifts to benchmark + dataset (P3/WP-306 is the hedge) · Temporal ships LLM-native primitives → deepen partnership, differentiate at judge + benchmark layer.
