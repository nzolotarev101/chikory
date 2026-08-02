/**
 * Compatibility re-export. The WP-228 baseline precheck moved to the core layer
 * (`src/util/precheck.ts`) when WP-561 wired it into `agentLoop`: the decision
 * is pure, and `src/workflow/` may not import from `src/cli/` — that edge is a
 * layering violation `scanDiffForLayeringViolations` reports as `workflow→cli`.
 */
export {
  evaluateBaselinePrecheck,
  type BaselinePrecheckResult,
  type PrecheckCheckResult,
} from "../util/precheck.js";
