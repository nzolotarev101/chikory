/**
 * The plan-gate ORACLE floor (F-221) — the third deterministic floor, beside the
 * ADR-005 D2 coverage floor (`coverage.ts`) and the WP-257 literal floor
 * (`literal-preservation.ts`).
 *
 * A node whose acceptance criteria contain no executable `check` has no oracle
 * at all: nothing but an LLM's reading of a diff can ever say it is done. On
 * dogfood-120 four of six nodes were in that state, and `N-2` — one
 * planner-invented prose criterion, `check` absent — demanded "evidence
 * records… upstream provenance… review". The judge, correctly refusing
 * self-authored assertions (WP-535/F-164, evidence-only), failed it on five
 * consecutive passes across two incarnations; three fails is a rule-3 HALT, two
 * HALTs killed the lineage, and the chain died. Along the way the squeeze
 * produced exactly what an unfalsifiable criterion rewards: a fabricated
 * "Reviewed and signed off by Chikory benchmark task review panel" line and a
 * RED/GREEN "proof" built from fake `git`/`npx` shims.
 *
 * So the floor is not "prefer checks" — it is: a node the chain will KILL for
 * failing a criterion must have at least one criterion a shell can settle. The
 * planner is never asked to write that check (F-40: a plausible-but-invalid
 * planner-authored command makes correct work unpassable). It must instead cover
 * the node with a goal criterion id — whose `check` `buildPlan` copies verbatim
 * from the goal spec — or merge the node into one that already has an oracle.
 *
 * Pure: no I/O, no LLM. The whole rejection is decided at plan time, for the
 * price of one repair pass (~$0.4 on dogfood-120) instead of a node's spend and
 * hours of wall clock.
 */
import type { Plan } from "../types.js";

function hasExecutableCheck(node: Plan["nodes"][number]): boolean {
  return node.acceptanceCriteria.some(
    (criterion) => criterion.check !== undefined && criterion.check.trim().length > 0,
  );
}

/**
 * The ids of `plan` nodes carrying no acceptance criterion with a non-empty
 * `check`. Order follows the plan; empty ⇒ every node has an executable oracle
 * (a PROCEED precondition, like full criterion coverage).
 *
 * One deliberate exemption: when NO node in the plan has an executable check,
 * the floor reports nothing. `buildPlan` hydrates a covering criterion from the
 * goal spec verbatim, so a plan with no checks anywhere means the OPERATOR wrote
 * a prose-only spec — a legitimate choice the planner cannot repair (it must
 * never author a check itself, F-40). Rejecting that plan would dead-end the
 * launch on a defect the retry has no move against, which is the WP-542 failure
 * mode this floor exists inside. The floor fires on the case that actually
 * happened instead: a spec that DOES supply oracles, and a decomposition that
 * left some nodes without one.
 */
export function planOracleGaps(plan: Plan): string[] {
  if (!plan.nodes.some(hasExecutableCheck)) return [];
  return plan.nodes.filter((node) => !hasExecutableCheck(node)).map((node) => node.id);
}
