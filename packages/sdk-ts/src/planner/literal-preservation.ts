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

/** An elided fragment (`docs/reports/…`) names no artifact a node can carry. */
function isElided(literal: string): boolean {
  return literal.includes("…") || literal.includes("...");
}

/**
 * A commit SHA or a chain/run id — narrative context, not a deliverable. Every
 * dogfood goal cites the run it follows (`7ad4bd3`,
 * `chain-0723ac0b-4eba-413a-933f-2d1646a4f643`), and mandating those into a node
 * goal asks the planner to recite history it cannot act on.
 */
function isOpaqueId(literal: string): boolean {
  const segments = literal.split("-");
  const hexSegments = segments.filter((segment) => /^[0-9a-f]+$/.test(segment));
  return (
    hexSegments.some((segment) => segment.length >= 7) ||
    (segments.length >= 4 && hexSegments.filter((segment) => segment.length >= 4).length >= 2)
  );
}

/** Shaped like something that lives in the repo: a path, an identifier, a flag. */
function isCodeShaped(token: string): boolean {
  return /[A-Z]/.test(token) || /[/_=():.-]/.test(token);
}

/**
 * F-225 — which backtick literals the plan gate may HALT a launch over.
 *
 * `extractGoalLiterals` takes every backticked span, and a goal spec backticks
 * prose too: dogfood-121's goal mandated 28 literals including `any`, `check`,
 * `git`, `npx` and `devbox run` alongside the real ones. Three of the four gaps
 * that burned $0.62 of plan spend were prose. A literal is mandated only when it
 * is shaped like a repo artifact — a path, a dotted/underscored/camelCase
 * identifier, a flag, a field assertion — and is neither elided nor an opaque id.
 *
 * Deliberately shape-only: the harness cannot tell a goal's narrative from its
 * contract, so anything that survives this filter is surfaced to the spec author
 * by the launch preflight lint, at $0, before a plan is ever paid for.
 */
export function isMandatedLiteral(literal: string): boolean {
  const trimmed = literal.trim();
  if (trimmed.length === 0) return false;
  if (isElided(trimmed) || isOpaqueId(trimmed)) return false;
  return trimmed.split(/\s+/).some(isCodeShaped);
}

/** The goal literals a plan must preserve — `extractGoalLiterals` minus prose. */
export function mandatedGoalLiterals(goalText: string): string[] {
  return extractGoalLiterals(goalText).filter(isMandatedLiteral);
}

/**
 * Every surface of a node that reaches the run verbatim. F-224: this used to be
 * `node.goal` alone, but `buildPlan` hydrates a covered criterion's description
 * and executable `check` verbatim from the goal spec, so a literal living in a
 * check IS preserved — dogfood-121's gate flagged `rawResultsDir` as dropped
 * while it sat in AC-1's and AC-4's checks, and spent two attempts on it.
 */
function nodeSurfaces(node: Plan["nodes"][number]): string[] {
  return [
    node.id,
    node.goal,
    ...node.acceptanceCriteria.flatMap((criterion) => [
      criterion.description,
      criterion.check ?? "",
    ]),
  ];
}

/** WP-257 `planCoverageGaps` analog: mandated literals missing from every node. */
export function planLiteralGaps(plan: Plan): string[] {
  return mandatedGoalLiterals(plan.goal).filter(
    (literal) => !plan.nodes.some((node) => nodeCarriesLiteral(node, literal)),
  );
}

/** The node that preserves a literal, or `undefined` — the repair-brief inventory. */
export function literalCarrier(plan: Plan, literal: string): string | undefined {
  return plan.nodes.find((node) => nodeCarriesLiteral(node, literal))?.id;
}

export function nodeCarriesLiteral(node: Plan["nodes"][number], literal: string): boolean {
  return nodeSurfaces(node).some((text) => containsExactToken(text, literal));
}

function containsExactToken(text: string, token: string): boolean {
  const escaped = escapeRegExp(token);
  // F-224: a directory literal is satisfied by any path UNDER it —
  // `benchmarks/tasks/` preserves `benchmarks/`, which the trailing token
  // boundary used to reject for being too specific. `benchmarksX/` still fails,
  // because the literal does not occur in it at all.
  const trailing = token.endsWith("/") ? "" : `($|[^${TOKEN_BOUNDARY_CHARS}])`;
  const pattern = new RegExp(`(^|[^${TOKEN_BOUNDARY_CHARS}])${escaped}${trailing}`);
  return pattern.test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
