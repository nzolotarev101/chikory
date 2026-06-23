---
name: dogfood-assessor
description: Assess the latest planned dogfood run in examples/dogfood against plan.md to identify if it is busy work or mission-critical, analyze historical runs, and document prioritization rationales.
---

# Dogfood Assessor Skill

This skill is run to analyze the latest planned dogfooding run in the `examples/dogfood/` folder against the master `plan.md` to classify it as "mission critical" or "busy work" and evaluate the context of its prioritization.

## Steps for the Agent

### Step 1: Locate and Read the Latest Planned Dogfood Run
1. Scan the `examples/dogfood/` directory or read the index in `examples/dogfood/README.md` to identify the highest-numbered `dogfood-<NNN>.yaml` file that has not been executed yet (i.e., status is "not yet run" or has no report/outcome).
2. Read the YAML file's contents, paying close attention to:
   - The file header comment (which states the Work Package (WP) and any prerequisites).
   - The `name` and `goal` fields.
   - The `acceptance_criteria` list.

### Step 2: Read `plan.md` to Determine the Goal of the Current Phase
1. View the main `plan.md` file at the root of the repository.
2. Locate the current active phase (e.g., Phase 2 - Reliability & memory) and extract the **Goal of the Phase**.
3. Identify the core architectural pillars and mission-critical work packages for that phase:
   - For Phase 2, mission-critical tasks include durable execution, goal decomposition/run chaining (WP-219), memory pointer store (WP-202), compaction (WP-203), tiered memory (WP-204), branching/rollback (WP-205), and HITL suspend/resume (WP-206).
   - Busy work or polish tasks include helper scripts, CLI formatting, metrics rendering, test de-flaking, or env scrubbing (e.g., `chikory land` (WP-220), watch state transitions (WP-223), land verification (WP-224), de-flake tests (WP-225), checkpoint notifications (WP-208 pure slices), trace metrics (WP-209), etc.).
   - **What counts is the DELIVERABLE WP, not the mechanism.** Hosting a thesis mechanism (a `debug.seedBadDiff` judge-catch seam, a `chikory chain` decomposition) on an *invented throwaway utility* does **not** upgrade a candidate to mission-critical — the landed diff still moves zero product WP (dogfood-046 `clamp`, 047 `roundTo`/`roundToCents`, 048 `truncateDecimals`/`truncateToCents` are the pattern to stop). A run is mission-critical only when the mechanism is seeded **into a real open product WP's code**.

### Step 3: Classify the Next Run
1. Compare the latest planned run's WP and goal against the phase goal and core pillars, on **two axes**: (A) does it have a real *failure surface* (DOGFOODING §1.1)? and (B) does its *landed deliverable* advance a real open `plan.md` §6 product WP (DOGFOODING §1.2)?
2. Classify the run as:
   - **🟢 Mission Critical**: the thesis mechanism is seeded **into a real open product-WP's code** — it has a failure surface AND moves the backlog (a necessary slice of goal decomposition/chaining WP-219, memory store WP-202, compaction WP-203, etc.).
   - **🟡 Scaffold-hosted**: it stresses a thesis mechanism (judge-catch seam, chain) but the deliverable is a **fresh throwaway utility invented solely to host the seam** — passes axis A, fails axis B (zero product-WP progress). This is the dogfood-046/047/048 pattern.
   - **🟡 Busy Work**: a minor fix, CLI polish, formatter, or helper script — no thesis mechanism and no product-WP progress.
3. Provide a clear justification, naming the deliverable WP (or noting there is none).

### Step 4: Evaluate Three Preceding Runs (If "Busy Work" or "Scaffold-hosted")
1. If the latest planned run is classified as **Busy Work** or **🟡 Scaffold-hosted**, identify the three immediately preceding runs in the `examples/dogfood/` folder (e.g., if the latest is `dogfood-014`, look at `dogfood-013`, `dogfood-012`, `dogfood-011`).
2. Read their specifications (`dogfood-*.yaml`) or reports (`docs/reports/dogfood-*.md`) to classify each as either "busy work" or "mission critical / productive".
3. Provide a summary of the classification of those three runs.

### Step 5: Identify the Prioritization Rationale
1. Determine the technical or structural reason WHY the current next item was prioritized. Specifically check if it falls under one of the following:
   - **Architect / Frozen Contract Wall**: The core mission-critical task is blocked because it requires a frozen contract change or ADR accept (TASK-PROTOCOL §4 / plan.md §6 queue note), forcing manual work first, which means only pure/ DX/ polish slices can be dogfooded in the meantime.
   - **Friction / Feedback Loop**: The run directly addresses a friction point (F-n) from a previous dogfood report (e.g., F-21 spawning WP-226).
   - **Acyclic Dependency / Pure Preconditions**: The run is a pure helper or precondition slice (like cycle detection `hasDependencyCycle` or sequencing `readyNodes`) unblocked by a landed contract PR.
   - **Other reason**: Clarify any other technical or ordering reason why this item is next.
2. **Only the Frozen-Contract-Wall and harness-blocker reasons legitimately justify a 🟡 Scaffold-hosted or Busy-Work headline** (the §1.2 carve-out). "It was convenient to host the seam on a fresh utility" is **not** a valid rationale — if a real product WP can host the mechanism, a scaffold-hosted pick is a `⛔ VETO`, not an `🟡 ALLOW`.

### Step 6: Issue a BINDING verdict (the veto)

This skill is a **gate, not advice** (DOGFOODING §1.3). After classifying:

1. Apply the **failure-surface test** (DOGFOODING §1.1): could a competent agent
   *plausibly fail* this candidate? A pure, single-file function with a
   deterministic test (a 1:1 parity port, a formatter, a pure helper) has **no
   failure surface** → it is **track-B**, never a headline dogfood, regardless of
   which WP it serves.
2. Apply the **product-progress test** (DOGFOODING §1.2): does the *landed
   deliverable* advance a real open `plan.md` §6 product WP? A thesis mechanism
   (judge-catch seam, chain) seeded into a **fresh throwaway utility** fails this
   test — it is **🟡 Scaffold-hosted**, not mission-critical.
3. Scan `plan.md §6` for any **unblocked thesis-stressing slice on a real product
   WP** — one that exercises a thesis pillar (durable execution, multi-run chains /
   WP-219, judge-catching a regression, crash→resume / WP-206, context-rot /
   WP-203/204) or has a real bug surface, needs no un-landed contract, **and could
   host the mechanism instead of a throwaway utility**.
4. **Emit the verdict explicitly:**
   - `✅ PROCEED` — the candidate is mission-critical (real failure surface AND
     advances a real product WP). Queue it.
   - `⛔ VETO` — the candidate is busy work / track-B / **🟡 Scaffold-hosted**
     **and** an unblocked thesis slice on a real product WP exists. **Name that
     slice and require the mechanism be seeded into it instead.**
   - `🟡 ALLOW (fallback)` — the candidate is busy work or scaffold-hosted but
     **nothing real is unblocked** (the §1.2 carve-out: every product WP is blocked
     by a frozen-contract / ADR wall or harness the dogfood depends on); permit it
     as the headline, and name the contract/architect work that must land to unblock
     a real run next.

The caller (`dogfood-review` phase-5) MUST honor a `⛔ VETO`.

## Output

End your analysis with a structured summary formatted for readability. To ensure it is simple to read, visually clear, and detailed while conserving full context, adhere strictly to these rules:

1. **Vibe Check (Simplified Summary First)**: Begin with a 1–2 sentence high-level, jargon-free summary classifying the planned run. Clearly state the target Work Package (WP) and what the task aims to achieve in plain English.
2. **Context Conservation**: Maintain all exact details (WP identifiers, spec file paths, preceding run numbers/reports).
3. **Structured Visual Layout**:
   - Use clear visual indicators for classification (`🟢 Mission Critical`, `🟡 Scaffold-hosted`, or `🟡 Busy Work`).
   - **Lead the summary with the binding verdict** (Step 6): `✅ PROCEED`,
     `⛔ VETO` (name the thesis slice to queue instead), or `🟡 ALLOW (fallback)`
     (state what must land to unblock a real run).
   - If classified as Busy Work or Scaffold-hosted, present the comparison table of the three preceding runs (run number, classification, report link, and outcome) using a markdown table.
4. **Prioritization Rationale & Terminology Explanations**: Provide a detailed explanation of the prioritization rationale. Explain any complex domain terms (e.g., "Frozen Contract Wall", "Acyclic Dependency", "Friction Loop") clearly, so that the developer does not need external references to understand the decision.
