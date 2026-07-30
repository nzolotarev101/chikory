/**
 * Step prompt rendering (WP-111) — projects the ContextBundle (CM-4 tiers)
 * plus the bounded instruction into one prompt for a wrapped CLI agent.
 * Large material never appears inline: memory refs render as pointer
 * summaries only (CM-3).
 */
import { WRITE_BOUNDARY_NOTE } from "../chain/write-boundary.js";
import { formatPointerReference } from "../runner/memory-pointer.js";
import type { StepInput } from "../types.js";
import { COMPLETION_MARKER } from "./step.js";

export function renderStepPrompt(input: StepInput): string {
  const { context, instruction } = input;
  const parts: string[] = [];

  parts.push(`# Task goal\n${context.goal}`);
  parts.push(
    `# Acceptance criteria\n${context.acceptanceCriteria
      .map((c) => `- [${c.id}] ${c.description}`)
      .join("\n")}`,
  );
  parts.push(`# Current plan item\n${context.planItem}`);

  // F-218: the write boundary is not a "note" among notes — it is the rule that
  // discards the whole node's work when broken, so it is lifted out of the
  // bulleted list and rendered inside the workspace-boundary block below.
  const notes = Object.entries(context.notes).filter(([key]) => key !== WRITE_BOUNDARY_NOTE);
  const writeBoundary = context.notes[WRITE_BOUNDARY_NOTE];
  if (notes.length > 0) {
    parts.push(`# Notes\n${notes.map(([k, v]) => `- ${k}: ${v}`).join("\n")}`);
  }
  if (context.recentSteps.length > 0) {
    parts.push(`# Recent steps\n${context.recentSteps.map((s) => `- ${s}`).join("\n")}`);
  }
  if (context.judgeFeedback) {
    parts.push(`# Judge feedback (address this)\n${context.judgeFeedback}`);
  }
  if (context.injections.length > 0) {
    parts.push(
      `# Operator guidance (highest priority)\n${context.injections
        .map((s) => `- ${s}`)
        .join("\n")}`,
    );
  }
  if (context.memoryRefs.length > 0) {
    parts.push(
      `# Stored artifacts (pointers — ask for excerpts via your runner, do not guess contents)\n${context.memoryRefs
        .map((r) => `- ${formatPointerReference(r)}`)
        .join("\n")}`,
    );
  }

  parts.push(
    `# This step — do ONLY this, then stop\n${instruction}\n\n` +
      // F-192: "the current directory" is not enough of a boundary. The
      // workspace is a CLONE whose `origin` is the source checkout, and it sits
      // inside that checkout — so an agent that reads `.git/config` can walk out
      // and edit the original, leaving the graded tree empty (dogfood-115
      // `run-c19147fe`). Name the sandbox, and name what is off-limits.
      `# Workspace boundary\n` +
      `Your workspace is: ${input.workspaceDir}\n` +
      `Read and write ONLY under that path. It is a git clone; the repository it was cloned ` +
      `from (its \`origin\`) is NOT yours to touch — editing it puts your work outside the ` +
      `graded tree, where it counts for nothing. Never resolve a path via \`origin\`, and never ` +
      `follow one out of the workspace.\n` +
      `Do not commit; the runner checkpoints for you.\n` +
      // F-218: the workspace is the outer boundary; a chain node also has an
      // inner one — the plan's declared writeSet, enforced when the node seals.
      (writeBoundary === undefined ? "" : `\n## Declared write boundary\n${writeBoundary}\n`) +
      `\n` +
      `# Completion signal\n` +
      `If — and only if — you judge the whole task above fully complete after this step ` +
      `(nothing left for a follow-up step), end your final message with this exact line on its own:\n` +
      `${COMPLETION_MARKER}\n` +
      `Omit it entirely if more work remains; never emit it speculatively. It only asks the ` +
      `runner to grade your work now — the quality gate still decides whether the task passes.`,
  );

  return parts.join("\n\n");
}
