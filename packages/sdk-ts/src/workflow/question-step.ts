/**
 * Question step classifier (WP-608).
 *
 * A step that ends in a question (empty diff + summary asking permission/approval)
 * is not a step — it must be named, answered, and never billed as progress.
 *
 * Pure and deterministic: diff emptiness + asking summary -> question step.
 * Non-empty diff -> NEVER a question step, whatever the summary says (trap G).
 */

export interface QuestionStepCandidate {
  diffBytes?: number;
  diffRef?: { bytes: number };
  summary: string;
}

export interface QuestionStepDecision {
  question: boolean;
  reason?: string;
}

const ASKING_PATTERNS = [
  /\bwould you like\b/i,
  /\bshall (?:i|we)\b/i,
  /\bshould (?:i|we)\b/i,
  /\bmay (?:i|we)\b/i,
  /\bcan (?:i|we)\b/i,
  /\bdo you want me to\b/i,
  /\b(?:please )?(?:confirm|approve|let me know if)\b/i,
  /\bproceed with (?:these|the|this)\b/i,
  /\bgo ahead\b/i,
];

/**
 * An ASK, not merely a sentence with a question mark in it. F-353 (dogfood-142):
 * the delivered classifier returned true for any summary containing `?`, which
 * is wider than "asks for permission or approval" — a rhetorical or diagnostic
 * question in an otherwise-final summary would skip the judge entirely. The
 * patterns carry the whole decision; `?` only reinforces one.
 */
function isAskingSummary(summary: string): boolean {
  const text = summary.trim();
  if (!text) return false;
  return ASKING_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Pure deterministic classifier over a step record.
 *
 * An asking step has diffBytes === 0 (or diffRef.bytes === 0) AND a summary that asks
 * for approval or permission.
 * A real diff (diffBytes > 0) is NEVER a question step.
 */
export function decideQuestionStep(
  record: QuestionStepCandidate,
): QuestionStepDecision {
  const bytes = record.diffBytes ?? record.diffRef?.bytes ?? 0;
  if (bytes > 0) {
    return { question: false, reason: "step produced a non-empty diff" };
  }
  if (isAskingSummary(record.summary)) {
    return { question: true, reason: "empty diff with asking summary" };
  }
  return { question: false, reason: "empty diff without asking summary" };
}
