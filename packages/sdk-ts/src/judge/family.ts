/**
 * Family-diversity enforcement (WP-133, invariant #2, JD-5 fold 1): the
 * judge's model family must differ from the executor's, or it shares the
 * executor's blind spots and the bias mitigation is gone.
 *
 * parseTaskSpec enforces this at parse time; this module re-enforces it at
 * the judge boundary (defense in depth — specs constructed programmatically
 * never pass through the parser). Same-family is allowed only via the
 * explicit `allow_same_family` opt-in, and even then every judge pass warns
 * loudly.
 */
import type { LLMProvider } from "../types.js";

export class FamilyDiversityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FamilyDiversityError";
  }
}

export interface FamilyDiversityInput {
  executorFamily: LLMProvider;
  /** Declared judge family (TaskSpec.judge.family). */
  judgeFamily: LLMProvider;
  /** Effective provider of the model the judge pass will actually call. */
  judgeProvider: LLMProvider;
  allowSameFamily?: boolean;
}

export interface FamilyDiversityResult {
  /** Non-empty only for the opted-in same-family case — log AND journal these. */
  warnings: string[];
}

/**
 * Throws `FamilyDiversityError` when the judge would run in the executor's
 * family without the explicit opt-in. With `allowSameFamily`, returns the
 * loud warning(s) the caller must surface on every judge pass.
 */
export function enforceFamilyDiversity(input: FamilyDiversityInput): FamilyDiversityResult {
  const violations: string[] = [];
  if (input.judgeFamily === input.executorFamily) {
    violations.push(
      `judge.family '${input.judgeFamily}' equals executor.family '${input.executorFamily}'`,
    );
  }
  if (input.judgeProvider === input.executorFamily && input.judgeProvider !== input.judgeFamily) {
    // Declared family differs but routing points the judge stage back at the
    // executor's provider — the diversity exists only on paper.
    violations.push(
      `routed judge provider '${input.judgeProvider}' equals executor.family ` +
        `'${input.executorFamily}' despite judge.family '${input.judgeFamily}'`,
    );
  }

  if (violations.length === 0) return { warnings: [] };
  if (!input.allowSameFamily) {
    throw new FamilyDiversityError(
      `${violations.join("; ")} — the judge must use a structurally different model family ` +
        `(invariant #2). Set allow_same_family: true to override.`,
    );
  }
  return {
    warnings: violations.map(
      (v) =>
        `[chikory] WARNING: ${v} (allow_same_family: true). Bias mitigation is reduced — ` +
        `the judge shares the executor's blind spots (invariant #2).`,
    ),
  };
}
