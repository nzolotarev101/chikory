import type { Plan } from "../types.js";

const TOKEN_BOUNDARY_CHARS = "A-Za-z0-9_-";
const BACKTICK_LITERAL_PATTERN = /`([^`]*)`/g;

/** WP-257 planner-output guardrail: ordered, de-duped backtick literals from a goal. */
export function extractGoalLiterals(goalText: string): string[] {
  const literals: string[] = [];
  const seen = new Set<string>();

  for (const match of goalText.matchAll(BACKTICK_LITERAL_PATTERN)) {
    const literal = match[1] ?? "";
    if (seen.has(literal)) continue;
    seen.add(literal);
    literals.push(literal);
  }

  return literals;
}

/** WP-257 `planCoverageGaps` analog: backtick literals missing from all node goals. */
export function planLiteralGaps(plan: Plan): string[] {
  return extractGoalLiterals(plan.goal).filter(
    (literal) => !plan.nodes.some((node) => containsExactToken(node.goal, literal)),
  );
}

function containsExactToken(text: string, token: string): boolean {
  const escaped = escapeRegExp(token);
  const pattern = new RegExp(
    `(^|[^${TOKEN_BOUNDARY_CHARS}])${escaped}($|[^${TOKEN_BOUNDARY_CHARS}])`,
  );
  return pattern.test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
