/**
 * The loop's standing answer to an executor that stops to ask permission (WP-608).
 *
 * Lives in the core layer because BOTH sides need the exact same sentence and
 * they sit on opposite sides of the layering order: `src/executors/prompt.ts`
 * prints it up front so an agent is told before it asks, and
 * `src/workflow/agent-loop.ts` feeds it back as the re-driven step's input when
 * one asks anyway. Defining it in `src/workflow/` made the executor import
 * upward (F-352, dogfood-142 — the judge's deterministic architecture scan
 * flagged `executors→workflow` on the delivered diff).
 */
export const STANDING_APPROVAL_ANSWER =
  "No approver exists — this step itself is the approval. Apply your plan now.";
