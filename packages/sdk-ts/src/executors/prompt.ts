/**
 * Step prompt rendering (WP-111) — projects the ContextBundle (CM-4 tiers)
 * plus the bounded instruction into one prompt for a wrapped CLI agent.
 * Large material never appears inline: memory refs render as pointer
 * summaries only (CM-3).
 */
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

  const notes = Object.entries(context.notes);
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
        .map((r) => `- ${r.kind} ${r.id.slice(0, 12)} (${r.bytes} bytes): ${r.summary}`)
        .join("\n")}`,
    );
  }

  parts.push(
    `# This step — do ONLY this, then stop\n${instruction}\n\n` +
      `Work only inside the current directory. Do not commit; the runner checkpoints for you.\n\n` +
      `# Completion signal\n` +
      `If — and only if — you judge the whole task above fully complete after this step ` +
      `(nothing left for a follow-up step), end your final message with this exact line on its own:\n` +
      `${COMPLETION_MARKER}\n` +
      `Omit it entirely if more work remains; never emit it speculatively. It only asks the ` +
      `runner to grade your work now — the quality gate still decides whether the task passes.`,
  );

  return parts.join("\n\n");
}
