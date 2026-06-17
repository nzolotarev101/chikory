import type { Message } from "../types.js";

/** Frozen digest system prompt for WP-203 / ADR-006 / CM-1. */
export const DIGEST_SYSTEM_PROMPT: string = [
  "You compact older execution memory for a durable agent run.",
  "",
  "Fold the provided older step summaries into one faithful prose digest that",
  "preserves the decisions made, important file and symbol names, and open",
  "threads a resumed run must remember.",
  "",
  "Rules:",
  "- Preserve the oldest-to-newest progression when it matters for causality.",
  "- Drop redundancy, transient chatter, and repeated restatements.",
  "- Keep concrete implementation facts over verbatim context.",
  "- Mention unresolved questions, failed attempts, and follow-up work still",
  "  relevant to the run.",
  "- Output prose only. Do not return JSON or wrap the digest in a schema.",
  "",
  "The goal is to rehydrate the gist without carrying rotted verbatim context.",
].join("\n");

/** Builds pure digest messages for WP-203 / ADR-006 / CM-1. */
export function buildDigestMessages(toDigest: readonly string[]): Message[] {
  const summaries = toDigest.map((summary, index) => `${index + 1}. ${summary}`).join("\n");
  const user = ["## Older step summaries to fold (oldest to newest)", summaries].join("\n");

  return [
    { role: "system", content: DIGEST_SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}
