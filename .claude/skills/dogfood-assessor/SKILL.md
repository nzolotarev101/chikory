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

### Step 3: Classify the Next Run
1. Compare the latest planned run's WP and goal against the phase goal and core pillars.
2. Classify the run as:
   - **Mission Critical**: If it directly implements or is a necessary slice of a core architectural pillar (like goal decomposition & run chaining WP-219, memory pointer store WP-202, compaction WP-203, etc.).
   - **Busy Work**: If it is a minor fix, CLI polish, formatter, or helper script.
3. Provide a clear justification for this classification.

### Step 4: Evaluate Three Preceding Runs (If Classified as "Busy Work")
1. If the latest planned run is classified as **Busy Work**, identify the three immediately preceding runs in the `examples/dogfood/` folder (e.g., if the latest is `dogfood-014`, look at `dogfood-013`, `dogfood-012`, `dogfood-011`).
2. Read their specifications (`dogfood-*.yaml`) or reports (`docs/reports/dogfood-*.md`) to classify each as either "busy work" or "mission critical / productive".
3. Provide a summary of the classification of those three runs.

### Step 5: Identify the Prioritization Rationale
1. Determine the technical or structural reason WHY the current next item was prioritized. Specifically check if it falls under one of the following:
   - **Architect / Frozen Contract Wall**: The core mission-critical task is blocked because it requires a frozen contract change or ADR accept (TASK-PROTOCOL §4 / plan.md §6 queue note), forcing manual work first, which means only pure/ DX/ polish slices can be dogfooded in the meantime.
   - **Friction / Feedback Loop**: The run directly addresses a friction point (F-n) from a previous dogfood report (e.g., F-21 spawning WP-226).
   - **Acyclic Dependency / Pure Preconditions**: The run is a pure helper or precondition slice (like cycle detection `hasDependencyCycle` or sequencing `readyNodes`) unblocked by a landed contract PR.
   - **Other reason**: Clarify any other technical or ordering reason why this item is next.

## Output

End your analysis with a structured summary formatted for readability. To ensure it is simple to read, visually clear, and detailed while conserving full context, adhere strictly to these rules:

1. **Vibe Check (Simplified Summary First)**: Begin with a 1–2 sentence high-level, jargon-free summary classifying the planned run. Clearly state the target Work Package (WP) and what the task aims to achieve in plain English.
2. **Context Conservation**: Maintain all exact details (WP identifiers, spec file paths, preceding run numbers/reports).
3. **Structured Visual Layout**:
   - Use clear visual indicators for classification (e.g., `🔴 Mission Critical` or `🟡 Busy Work`).
   - If classified as Busy Work, present the comparison table of the three preceding runs (run number, classification, report link, and outcome) using a markdown table.
4. **Prioritization Rationale & Terminology Explanations**: Provide a detailed explanation of the prioritization rationale. Explain any complex domain terms (e.g., "Frozen Contract Wall", "Acyclic Dependency", "Friction Loop") clearly, so that the developer does not need external references to understand the decision.
