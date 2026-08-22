/**
 * Pure run-completion review decisions — the holistic architecture pass over
 * the CUMULATIVE diff at the moment a run would seal SUCCESS. Kept outside the
 * Temporal workflow body so the decision is deterministic and unit-testable
 * (the `decideRemediation`/`decideWorkChunk` sibling).
 *
 * Cost bound: at most `MAX_COMPLETION_REVIEWS` extra judge passes per run
 * (initial review + the re-review after the one bounded design-fix retry),
 * and zero passes when the sealing verdict already covered the cumulative
 * diff (a first-verdict seal).
 */
import { DETERMINISTIC_RUBRIC_IDS, RUBRIC_PRE_EXISTING_SUITE_GREEN } from "../judge/rubric.js";
import type { JudgeForm } from "../types.js";

/** Initial review + one re-review after the bounded design-fix retry. */
export const MAX_COMPLETION_REVIEWS = 2;

/**
 * Ceiling on how many EXTRA review passes a run may earn by showing progress
 * (F-412, dogfood-160 review). It is a BACKSTOP, not the bound: since WP-643
 * (dogfood-161) `areMateriallySameObjections` recognises a reworded repeat, so
 * the recognition is what normally stops an oscillating run and this constant
 * only catches what the recognition misses.
 *
 * It is still needed because the instrument is INCOMPLETE. Measured at the
 * dogfood-161 review against this run's own four completion reviews — all four
 * restating one complaint, none of them fixture data the delivery ever saw — the
 * comparator answers "same" on 2 of the 6 pairs. Driven through the accumulating
 * seam (`agent-loop.ts:263`/`:1406`) that was enough to stop at review #2 where
 * the shipped byte-equality granted all four, but review #4's wording matched
 * none of its three predecessors: had it arrived second, nothing would have
 * stopped the run but this constant. See WP-644.
 *
 * So the progress exemption still fails CLOSED: a judge that rewords the same
 * objection every pass earns at most this many extra attempts, never the run's
 * whole headroom.
 */
export const MAX_PROGRESS_GRANTS = 2;

/** A brief must ride inside step context without rotting it (CM-3 discipline). */
const COMPLETION_BRIEF_MAX_CHARS = 2000;

export interface CompletionReviewState {
  /** Diff base of the judge pass that just confirmed all criteria. */
  sealingDiffBase: string;
  /** The run's base commit (prepareRun). */
  baseCommit: string;
  /** Completion reviews already run since the last terminal seal. */
  reviewAttemptsUsed: number;
  /**
   * Whether the sealing verdict's design rubric had any failing items.
   * When true on a first-verdict seal, the run must take the bounded design-fix
   * review path instead of skipping (the F-180 fix).
   */
  sealingVerdictHasRubricFailures?: boolean;
  /**
   * The sealing verdict's rubric results, when the caller holds the array
   * rather than a precomputed boolean. Equivalent to
   * `sealingVerdictHasRubricFailures: rubricResults.some((r) => !r.pass)`,
   * which wins when both are given.
   */
  rubricResults?: ReadonlyArray<{ pass: boolean; id?: string; justification?: string }>;
  /**
   * Whether the spec has a declared `regression_suite` command.
   * When true on a first-verdict seal, the completion review MUST run to execute
   * the command, since the command never runs on per-step passes.
   */
  hasRegressionSuite?: boolean;
  /**
   * Whether the run has out-of-rubric escalation concerns that must be adjudicated (WP-619).
   * When true on a first-verdict seal, the completion review MUST run to adjudicate
   * the concerns, even if no regression suite was declared.
   */
  hasEscalationConcerns?: boolean;
  /**
   * Whether the run has standing findings from earlier passes or the sealing pass.
   */
  hasStandingFindings?: boolean;
  /**
   * The failing rubric items / objections from the current completion review (or sealing pass).
   */
  currentFindings?: ReadonlyArray<RubricResult>;
  /**
   * Objections that have already been given a repair attempt in this run.
   */
  attemptedFindings?: ReadonlyArray<RubricResult | { id: string; justification: string }>;
  /**
   * The objections given to the immediate last repair attempt.
   */
  lastAttemptedFindings?: ReadonlyArray<RubricResult | { id: string; justification: string }>;
  /**
   * Whether the run still has step headroom (stepIndex < maxSteps).
   */
  hasStepHeadroom?: boolean;
  /**
   * Whether the run has budget headroom (!budgetBreached).
   */
  hasBudgetHeadroom?: boolean;
  /**
   * Remaining steps before reaching maxSteps.
   */
  remainingSteps?: number;
  /**
   * Repair grants already earned by a NEW (non-repeated) objection. Each one
   * buys exactly one extra review pass, up to `MAX_PROGRESS_GRANTS`.
   */
  progressGrantsUsed?: number;
}

export type CompletionReviewDecision =
  | { action: "review" }
  | { action: "skip"; reason: string };

const STOPWORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are",
  "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but",
  "by", "can", "could", "did", "do", "does", "doing", "down", "during", "each", "few", "for",
  "from", "further", "had", "has", "have", "having", "he", "her", "here", "hers", "herself",
  "him", "himself", "his", "how", "i", "if", "in", "into", "is", "it", "its", "itself", "just",
  "me", "more", "most", "my", "myself", "no", "nor", "not", "now", "of", "off", "on", "once",
  "only", "or", "other", "our", "ours", "ourselves", "out", "over", "own", "s", "same", "she",
  "should", "so", "some", "such", "t", "than", "that", "the", "their", "theirs", "them",
  "themselves", "then", "there", "these", "they", "this", "those", "through", "to", "too",
  "under", "until", "up", "very", "was", "we", "were", "what", "when", "where", "which",
  "while", "who", "whom", "why", "will", "with", "would", "you", "your", "yours", "yourself",
  "yourselves",
]);

const BOILERPLATE = new Set([
  "diff", "design", "goal", "defect", "defects", "issue", "issues", "problem", "problems",
  "requirement", "requirements", "behavior", "contract", "mechanism", "mechanisms",
  "choice", "choices", "result", "results", "reported", "established", "existing", "concrete",
  "delivery", "overall", "coherent", "primary", "separate", "different",
  "make", "makes", "retains", "retain", "maintains", "maintain",
  "contains", "introduced", "introduces", "shown", "required", "explicitly", "explicit",
  "true", "false", "item", "items", "pass", "passes", "fail", "fails", "failing",
  "test", "tests", "unit", "suite", "committed", "step", "steps", "path", "paths",
  "also", "therefore", "instead", "rather", "objection", "objections", "finding", "findings",
  "review", "verdict", "check", "checks", "explanation", "explaining", "consequently",
  "regressing", "normal", "original", "ac", "ac-1", "ac-2", "ac-3", "ac1", "ac2", "ac3",
]);

const GENERIC_EXTENSIONS = new Set([
  "ts", "js", "py", "json", "yaml", "yml", "md", "txt", "sh", "rs", "go",
]);

function stem(word: string): string {
  let w = word.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (w.length <= 2) return w;

  if (w === "utf8" || w === "utf-8") return "utf8";
  if (w === "time") return "time";
  if (w === "timing") return "timing";
  if (w.startsWith("inconsistent")) w = "consist" + w.slice(12);
  else if (w.startsWith("unhandled")) w = "unhandl" + w.slice(9);
  else if (w.startsWith("unpreserved")) w = "unpreserv" + w.slice(11);
  else if (w.startsWith("unrestored")) w = "unrestor" + w.slice(10);
  else if (w.startsWith("unsubscribed")) w = "unsubscrib" + w.slice(12);
  else if (w.startsWith("unreleased")) w = "unreleas" + w.slice(10);
  else if (w.startsWith("unparameterized")) w = "unparameter" + w.slice(15);

  w = w.replace(/(?:ingly|edly|edly|ingly|ing|ed|es|s)$/, "");
  w = w.replace(/(?:tionality|tional|tion|sion|ation|ition|ative|ator|ate|ative)$/, "");
  w = w.replace(/(?:alism|ality|aliti|al|ly|ally|eli|ousli|ously|ous|fulness|ful|ness)$/, "");
  w = w.replace(/(?:ization|izer|ize|ized|izing|ability|abili|ibility|ibli|able|ible)$/, "");
  w = w.replace(/(?:ement|ment|ence|ance|enci|anci|ent|ant|ity|iti|ive|ivity|iviti)$/, "");
  w = w.replace(/(?:ory|ori|ary|ari)$/, "");
  if (w !== "time") {
    w = w.replace(/(?:e)$/, "");
  }

  return w;
}

function splitIdentifier(id: string): string[] {
  return id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[_$./\-\s]+/)
    .map((p) => stem(p.toLowerCase()))
    .filter((p) => p.length >= 2 && !GENERIC_EXTENSIONS.has(p));
}

const DEFECT_CATEGORIES = {
  LOSS_OR_OMISSION: new Set([
    "drop", "lost", "loss", "omit", "omiss", "miss", "skip", "bypass", "unhandl",
    "unrestor", "unpreserv", "unbound", "uncheck", "unfilter", "evict", "discard", "lose",
    "fail",
  ].map(stem)),
  DUPLICATION: new Set([
    "duplic", "repeat", "redund", "copi", "reemit", "rerun", "retri", "reexecut", "cycl", "loop",
  ].map(stem)),
  RESOURCE_LEAK: new Set([
    "leak", "unreleas", "unsubscrib", "unmount", "exhaust", "retain", "unfre", "hang",
  ].map(stem)),
  DATA_CORRUPTION_OR_ENCODING: new Set([
    "corrupt", "utf8", "encod", "decod", "truncat", "format", "serializ", "deserializ", "unpars",
  ].map(stem)),
  CONCURRENCY_OR_TIMING: new Set([
    "race", "concurr", "thread", "lock", "deadlock", "order", "snapshot", "timeout", "timer",
    "contention", "interleav", "asynchron",
  ].map(stem)),
  CAP_OR_BOUND_BYPASS: new Set([
    "cap", "limit", "bound", "ceil", "max", "overflow", "underflow", "exceed", "headroom",
    "stopp",
  ].map(stem)),
  SECURITY_OR_VALIDATION: new Set([
    "inject", "parameter", "unparameter", "sanit", "escap", "unvalid", "invalid", "malform",
    "valid", "permiss", "permit", "author", "secret", "forg", "timing",
  ].map(stem)),
  LOGIC_STATE_CONDITION: new Set([
    "condit", "empti", "nonempti", "null", "undefin", "absent", "predic", "guard", "enforc",
    "crash", "typeerror",
  ].map(stem)),
  PERFORMANCE_DEFECT: new Set([
    "scan", "unindex", "slow", "bottleneck", "ineffici", "degra",
  ].map(stem)),
} as const;

type DefectCategory = keyof typeof DEFECT_CATEGORIES;

const FOCUS_SUBJECTS = new Set([
  // Resource / DB
  "connection", "socket", "pool", "database", "query", "sql", "table", "column", "row", "scan", "index",
  // Cert / Security
  "certificate", "cert", "descriptor", "handle", "ssl", "tls", "secret", "credential", "password",
  "token", "hmac", "signature", "jwt",
  // Time / Clock
  "clock", "timestamp", "time", "server", "date",
  // Stream / Buffer
  "stream", "buffer", "chunk", "tail", "packet", "byte", "payload", "header",
  // Review / Cap / Attempt
  "history", "attempt", "cap", "review", "grant", "finding", "bound",
  // User / Entity
  "user", "profile", "avatar", "picture", "image", "photo", "email", "phone", "address",
  // Event / Subscription
  "listener", "subscription", "heartbeat", "event", "message", "channel", "queue", "pipeline",
  // Encoding / Format
  "utf8", "encoding", "format", "schema", "json",
  // Concurrency / Stat
  "worker", "thread", "stat", "snapshot", "hash",
].map(stem));

const DOMAIN_TARGETS = new Set([
  "stream", "buffer", "chunk", "tail", "pool", "socket", "connection", "listener",
  "subscription", "query", "worker", "stat", "token", "cert", "certificate",
  "descriptor", "pipeline", "service", "client", "server", "database",
].map(stem));

const CONDITION_TERMS = new Set([
  "timeout", "timer", "retry", "reconnect", "backoff", "unmount", "mount", "empty",
  "nonempty", "absent", "defin", "undefin", "nonempti", "null", "miss", "full",
  "partial", "final", "initi", "befor", "after", "concurr", "share", "untouch",
  "modifi", "delet", "expir", "unreleas", "close", "open", "reload", "restart",
  "interleav", "content", "order", "boundari", "utf8", "binari", "string",
  "integ", "boolean", "ssl", "tls", "http", "503", "404", "500", "socket",
  "network", "disk", "memor", "heap", "stack", "thread", "process", "queri",
  "execut", "rsa", "hmac", "password", "email", "format", "length", "timing",
].map(stem));

const DEFECT_ACTIONS = new Set([
  "drop", "lost", "skip", "bypass", "unhandl", "unrestor", "unpreserv",
  "duplic", "repeat", "leak", "unreleas", "unsubscrib", "corrupt",
  "deadlock", "race", "exceed", "inject", "invalid", "malform",
  "crash", "typeerror", "unindex", "exhaust", "enforc", "bound", "valid",
].map(stem));

const SPECIFIC_ATTRIBUTES = new Set([
  // Contact / User attributes
  "email", "phone", "password", "avatar", "picture", "image", "photo", "profile", "address",
  // DB / Connection attributes
  "connection", "socket", "pool", "cert", "certificate", "descriptor", "handle", "ssl", "tls",
  // Query / Storage attributes
  "sql", "table", "column", "row", "scan", "index", "hash", "snapshot",
  // Auth / Security attributes
  "token", "hmac", "signature", "jwt", "secret", "credential",
  // Time / Clock attributes
  "clock", "timestamp", "server", "date",
  // Stream / Buffer attributes
  "stream", "buffer", "chunk", "tail", "packet", "byte",
  // Review / Cap attributes
  "cap", "history", "attempt", "review",
  // Event / Subscription attributes
  "listener", "subscription", "heartbeat",
  // Concurrency attributes
  "worker", "thread", "stat",
  // Encoding attributes
  "utf8", "encoding",
].map(stem));

interface ObjectionProfile {
  codeEntities: Set<string>;
  codeSubTokens: Set<string>;
  domainTargets: Set<string>;
  focusSubjects: Set<string>;
  specificAttributes: Set<string>;
  triggerConditions: Set<string>;
  defectActions: Set<string>;
  defectCategories: Set<DefectCategory>;
}

function extractProfile(text: string): ObjectionProfile {
  const codeEntities = new Set<string>();
  const codeSubTokens = new Set<string>();
  const domainTargets = new Set<string>();
  const focusSubjects = new Set<string>();
  const specificAttributes = new Set<string>();
  const triggerConditions = new Set<string>();
  const defectActions = new Set<string>();
  const defectCategories = new Set<DefectCategory>();

  const registerToken = (s: string) => {
    if (
      !s ||
      s.length <= 1 ||
      STOPWORDS.has(s) ||
      GENERIC_EXTENSIONS.has(s)
    ) {
      return;
    }

    const isDomainToken =
      DOMAIN_TARGETS.has(s) ||
      FOCUS_SUBJECTS.has(s) ||
      SPECIFIC_ATTRIBUTES.has(s) ||
      CONDITION_TERMS.has(s) ||
      DEFECT_ACTIONS.has(s);

    if (!isDomainToken && BOILERPLATE.has(s)) {
      return;
    }

    if (DOMAIN_TARGETS.has(s)) {
      domainTargets.add(s);
    }
    if (FOCUS_SUBJECTS.has(s)) {
      focusSubjects.add(s);
      // Synonym mappings for focus subjects
      if (s === stem("avatar") || s === stem("picture") || s === stem("photo") || s === stem("image")) {
        focusSubjects.add("image_focus");
      } else if (s === stem("clock") || s === stem("timestamp") || s === stem("time") || s === stem("date")) {
        focusSubjects.add("time_focus");
      } else if (s === stem("cert") || s === stem("certificate")) {
        focusSubjects.add("cert_focus");
      } else if (s === stem("descriptor") || s === stem("handle")) {
        focusSubjects.add("handle_focus");
      } else if (s === stem("socket") || s === stem("connection")) {
        focusSubjects.add("connection_focus");
      }
    }
    if (SPECIFIC_ATTRIBUTES.has(s)) {
      specificAttributes.add(s);
      if (s === stem("avatar") || s === stem("picture") || s === stem("photo") || s === stem("image")) {
        specificAttributes.add("image_focus");
      } else if (s === stem("clock") || s === stem("timestamp") || s === stem("time") || s === stem("date")) {
        specificAttributes.add("time_focus");
      } else if (s === stem("cert") || s === stem("certificate")) {
        specificAttributes.add("cert_focus");
      } else if (s === stem("descriptor") || s === stem("handle")) {
        specificAttributes.add("handle_focus");
      } else if (s === stem("socket") || s === stem("connection")) {
        specificAttributes.add("connection_focus");
      }
    }
    if (CONDITION_TERMS.has(s)) {
      triggerConditions.add(s);
      // Synonym mappings for condition terms
      if (s === "absent" || s === "empty" || s === "undefin" || s === "null" || s === "miss") {
        triggerConditions.add("empty_condition");
      } else if (s === "defin" || s === "nonempti" || s === "present") {
        triggerConditions.add("defined_condition");
      } else if (s === "timeout" || s === "timer") {
        triggerConditions.add("timeout_condition");
      }
    }
    if (DEFECT_ACTIONS.has(s)) {
      defectActions.add(s);
    }
    for (const [cat, words] of Object.entries(DEFECT_CATEGORIES) as [DefectCategory, Set<string>][]) {
      if (words.has(s)) {
        defectCategories.add(cat);
        defectActions.add(s);
      }
    }
  };

  // 1. Backtick spans
  for (const m of text.matchAll(/`([^`]+)`/g)) {
    const raw = m[1].trim();
    if (raw.length > 1 && !GENERIC_EXTENSIONS.has(raw.toLowerCase()) && !BOILERPLATE.has(raw.toLowerCase())) {
      codeEntities.add(raw.toLowerCase());
    }
    const words = raw.match(/[a-zA-Z0-9_$]+/g) ?? [];
    for (const w of words) {
      if (!/^\d+$/.test(w) && !GENERIC_EXTENSIONS.has(w.toLowerCase()) && !BOILERPLATE.has(w.toLowerCase())) {
        codeEntities.add(w.toLowerCase());
        splitIdentifier(w).forEach((t) => {
          codeSubTokens.add(t);
          registerToken(t);
        });
      }
    }
  }

  // 2. Structural identifiers
  for (const m of text.matchAll(/\b([a-zA-Z0-9_$]+(?:[._/-][a-zA-Z0-9_$]+)*)\b/g)) {
    const w = m[1];
    if (
      /[a-z]+[A-Z0-9]/.test(w) ||
      /[A-Z]{2,}/.test(w) ||
      /_/.test(w) ||
      /\./.test(w) ||
      /\//.test(w)
    ) {
      if (!GENERIC_EXTENSIONS.has(w.toLowerCase()) && !BOILERPLATE.has(w.toLowerCase())) {
        codeEntities.add(w.toLowerCase());
      }
      const parts = w.match(/[a-zA-Z0-9_$]+/g) ?? [];
      for (const p of parts) {
        if (p.length > 1 && !/^\d+$/.test(p) && !GENERIC_EXTENSIONS.has(p.toLowerCase()) && !BOILERPLATE.has(p.toLowerCase())) {
          codeEntities.add(p.toLowerCase());
          splitIdentifier(p).forEach((t) => {
            codeSubTokens.add(t);
            registerToken(t);
          });
        }
      }
    }
  }

  // 3. Normalized content words
  const words = text
    .toLowerCase()
    .replace(/[`'"]/g, "")
    .replace(/[^a-z0-9_]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  for (const w of words) {
    if (w.length > 1 && !STOPWORDS.has(w) && !/^\d+$/.test(w)) {
      const s = stem(w);
      if (s.length > 1) {
        registerToken(s);
      }
    }
  }

  return {
    codeEntities,
    codeSubTokens,
    domainTargets,
    focusSubjects,
    specificAttributes,
    triggerConditions,
    defectActions,
    defectCategories,
  };
}

function matchProfiles(fa: ObjectionProfile, fb: ObjectionProfile): boolean {
  // Target Locus Alignment:
  // Both objections must identify the same code symbol, symbol sub-tokens, primary domain target, or focus subject.
  const sharedEntities = [...fa.codeEntities].filter((x) => fb.codeEntities.has(x));
  const sharedSubTokens = [...fa.codeSubTokens].filter((x) => fb.codeSubTokens.has(x));
  const sharedDomainTargets = [...fa.domainTargets].filter((x) => fb.domainTargets.has(x));
  const sharedFocusSubjects = [...fa.focusSubjects].filter((x) => fb.focusSubjects.has(x));
  const sharedSpecificAttributes = [...fa.specificAttributes].filter((x) =>
    fb.specificAttributes.has(x),
  );

  // If both objections specify explicit code symbols and share no symbols or sub-tokens,
  // they are targeting completely different parts of the codebase.
  if (
    fa.codeEntities.size > 0 &&
    fb.codeEntities.size > 0 &&
    sharedEntities.length === 0 &&
    sharedSubTokens.length === 0
  ) {
    return false;
  }

  const hasSharedTarget =
    sharedEntities.length > 0 ||
    sharedSubTokens.length > 0 ||
    sharedDomainTargets.length > 0 ||
    sharedFocusSubjects.length > 0;

  if (!hasSharedTarget) {
    return false;
  }

  // Defect Category Compatibility:
  // If both objections identify categorized failure modes, they must not be disjoint.
  // E.g. LOSS_OR_OMISSION vs DUPLICATION, RESOURCE_LEAK vs CONCURRENCY_OR_TIMING,
  // LOGIC_STATE_CONDITION vs PERFORMANCE_DEFECT.
  const sharedCategories = [...fa.defectCategories].filter((x) => fb.defectCategories.has(x));
  if (fa.defectCategories.size > 0 && fb.defectCategories.size > 0 && sharedCategories.length === 0) {
    return false;
  }

  // Focus Subject & Specific Attribute Alignment:
  // What specific aspect/attribute within the target locus is faulted?
  // E.g. connection vs cert, email vs phone, token/clock vs hmac/signature, profile vs phone, tail/chunk vs retry.
  if (
    fa.specificAttributes.size > 0 &&
    fb.specificAttributes.size > 0 &&
    sharedSpecificAttributes.length === 0
  ) {
    return false;
  }
  if (fa.focusSubjects.size > 0 && fb.focusSubjects.size > 0 && sharedFocusSubjects.length === 0) {
    return false;
  }

  // Trigger Condition & Defect Action Alignment:
  // Evaluates whether both descriptions express the same operational trigger condition and defect action.
  const sharedConditions = [...fa.triggerConditions].filter((x) => fb.triggerConditions.has(x));
  const sharedActions = [...fa.defectActions].filter((x) => fb.defectActions.has(x));

  // If both specify operational triggers, they must not be in conflict (e.g. timeout vs ssl reload, format vs length).
  if (fa.triggerConditions.size > 0 && fb.triggerConditions.size > 0 && sharedConditions.length === 0) {
    return false;
  }

  // Two objections express the same defect proposition when:
  // (a) They target the same locus (code symbol, domain entity, or focus subject)
  // (b) They focus on the same aspect/subject (e.g. connection pool, stream tail, jwt expiry, user profile)
  // (c) They share an operational trigger condition OR a specific defect action OR multiple code entities/sub-tokens.
  const hasSharedFocus = sharedFocusSubjects.length > 0 || sharedEntities.length > 0 || sharedSubTokens.length >= 3;
  const hasSharedMechanism =
    sharedConditions.length > 0 ||
    sharedActions.length > 0 ||
    sharedEntities.length >= 2 ||
    sharedSubTokens.length >= 4;

  return hasSharedFocus && hasSharedMechanism;
}

function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** One filled rubric row of a judge form. */
export type RubricResult = JudgeForm["rubricResults"][number];

/**
 * Decides whether two objections are materially the same objection (WP-643/WP-647).
 *
 * Compares what the objection is ABOUT rather than how it is worded:
 * 1. Soundness: identical trimmed text on the same rubric id is always a repeat.
 * 2. Rubric id check: different rubric ids are always different objections.
 * 3. Target Locus Alignment: both objections must identify the same code symbol,
 *    sub-tokens, primary domain target, or focus subject. Disjoint symbols return false.
 * 4. Defect Category Compatibility: disjoint defect categories (e.g. dropping chunks vs
 *    duplicating chunks on retry) targeting the same symbol return false.
 * 5. Focus Subject & Specific Attribute Alignment: both objections must address the same
 *    specific aspect/attribute (e.g. email vs phone, connection vs cert file descriptor).
 * 6. Trigger Condition & Defect Action Alignment: verifies matching operational triggers
 *    and compatible failure mechanisms without scalar similarity thresholds.
 * 7. Superset / Clause-Level Restatements:
 *    When one objection is a strict SUPERSET of another (e.g. a second review repeats an
 *    earlier complaint and adds an additional defect observation), the run must not earn
 *    an extra repair grant to re-litigate the un-repaired complaint. If any anchored clause
 *    of an objection restates a defect proposition from an earlier attempt, it is recognised
 *    as a repeated objection.
 */
export function areMateriallySameObjections(
  a: RubricResult | { id: string; justification: string },
  b: RubricResult | { id: string; justification: string },
): boolean {
  // 1. Soundness & Rubric Check
  if (a.id !== b.id) return false;
  if (a.justification.trim() === b.justification.trim()) return true;

  const fa = extractProfile(a.justification);
  const fb = extractProfile(b.justification);

  if (matchProfiles(fa, fb)) return true;

  // 2. Superset / Clause-Level Restatement Check
  // When an objection repeats a previously attempted defect proposition alongside
  // new findings (strict superset), matching anchored clauses between the two objections
  // identifies that the core complaint is a repeat.
  const sentsA = splitIntoSentences(a.justification);
  const sentsB = splitIntoSentences(b.justification);

  if (sentsA.length > 1 || sentsB.length > 1) {
    for (const sa of sentsA) {
      const pa = extractProfile(sa);
      for (const sb of sentsB) {
        const pb = extractProfile(sb);
        const sharedEnt = [...pa.codeEntities].filter((x) => pb.codeEntities.has(x));
        const sharedSub = [...pa.codeSubTokens].filter((x) => pb.codeSubTokens.has(x));

        // Clause-level matching requires anchored locus: explicit shared entity or >= 4 shared sub-tokens
        if (sharedEnt.length >= 1 || sharedSub.length >= 4) {
          if (matchProfiles(pa, pb)) {
            return true;
          }
        }
      }
    }
  }

  return false;
}

/**
 * Returns true if any finding in `current` matches an objection that was already attempted.
 */
export function hasRepeatedObjection(
  current: ReadonlyArray<RubricResult | { id: string; justification: string }>,
  attempted: ReadonlyArray<RubricResult | { id: string; justification: string }>,
): boolean {
  return current.some((curr) =>
    attempted.some((att) => areMateriallySameObjections(curr, att)),
  );
}

function extractHasRubricFailures(state: CompletionReviewState): boolean {
  if (typeof state.sealingVerdictHasRubricFailures === "boolean") {
    return state.sealingVerdictHasRubricFailures;
  }
  if (Array.isArray(state.rubricResults)) {
    return state.rubricResults.some((r) => !r.pass);
  }
  return false;
}

export function decideCompletionReview(
  state: CompletionReviewState,
): CompletionReviewDecision {
  if (state.hasStepHeadroom === false || (typeof state.remainingSteps === "number" && state.remainingSteps <= 0)) {
    return { action: "skip", reason: "step headroom exhausted" };
  }
  if (state.hasBudgetHeadroom === false) {
    return { action: "skip", reason: "budget headroom exhausted" };
  }

  const currentFails: ReadonlyArray<RubricResult> = state.currentFindings ??
    (Array.isArray(state.rubricResults)
      ? (state.rubricResults.filter(
          (r): r is RubricResult =>
            !r.pass &&
            typeof (r as { id?: unknown }).id === "string" &&
            typeof (r as { justification?: unknown }).justification === "string",
        ) as ReadonlyArray<RubricResult>)
      : []);

  // F-414: the two histories are UNIONED, not selected between. `??` made
  // `lastAttemptedFindings` unreachable, because every agent-loop call site
  // passes an always-defined `attemptedFindings` array.
  const attempted: ReadonlyArray<RubricResult | { id: string; justification: string }> = [
    ...(state.attemptedFindings ?? []),
    ...(state.lastAttemptedFindings ?? []),
  ];

  if (
    currentFails.length > 0 &&
    attempted.length > 0 &&
    hasRepeatedObjection(currentFails, attempted)
  ) {
    return {
      action: "skip",
      reason: "completion review: repeated objection on a converged step",
    };
  }

  // F-413: the bound is UNCONDITIONAL. Gating it on an empty `attempted` list
  // meant the agent loop — which always passes a non-empty list once one repair
  // has been granted — never consulted it again, so the cap was live only until
  // the first grant. Progress raises the ceiling by one pass per grant and no
  // more, and `MAX_PROGRESS_GRANTS` caps the raise itself.
  const progressGrants = Math.min(
    Math.max(state.progressGrantsUsed ?? 0, 0),
    MAX_PROGRESS_GRANTS,
  );
  if (state.reviewAttemptsUsed >= MAX_COMPLETION_REVIEWS + progressGrants) {
    return { action: "skip", reason: "completion reviews exhausted" };
  }

  const isFirstVerdictSeal = state.sealingDiffBase === state.baseCommit;
  const failingRubric = extractHasRubricFailures(state);

  if (
    isFirstVerdictSeal &&
    !failingRubric &&
    !state.hasRegressionSuite &&
    !state.hasEscalationConcerns &&
    !state.hasStandingFindings
  ) {
    return {
      action: "skip",
      reason: "sealing verdict already judged the cumulative diff (first-verdict seal)",
    };
  }
  return { action: "review" };
}

/**
 * Union the design objections the SEALING verdict raised with the ones the
 * completion review raised, deduped by rubric id, sealing-verdict-first,
 * with authoritative reconciliation for machine-settled (deterministic) rows.
 *
 * For LLM-judged design rows (e.g. `design_serves_overall_goal`,
 * `cumulative_design_coherent`), the union is preserved (trap C / F-180):
 * a second, independent review coming back clean must NOT silently drop an
 * objection the sealing verdict raised.
 *
 * For deterministic rows (`DETERMINISTIC_RUBRIC_IDS`: `no_architecture_violations`,
 * `no_secrets_introduced`, `pre_existing_suite_still_green`), the completion
 * review measures the whole cumulative diff (run base -> final state) with
 * deterministic code oracles, making its measurement authoritative:
 *
 * 1. Sealing FAIL, Review PASS:
 *    The review re-measured the cumulative delivery and found no violation.
 *    Any step-scoped finding (e.g. restoring a pre-existing import, or a temporary
 *    step artifact reverted before completion) is acquitted, clearing the
 *    sealing pass's FAIL for that same row.
 *
 * 2. Sealing PASS, Review FAIL:
 *    The sealing pass passed (or measured only a localized step diff that missed
 *    an earlier introduced violation), but the completion review re-measured the
 *    full cumulative diff and found a deterministic violation. The review's FAIL
 *    is authoritative and is included in the merged findings so the run does not
 *    seal with a cumulative defect.
 *
 * 3. Both FAIL:
 *    The deterministic finding failed on both passes and is included in the
 *    merged findings.
 */
export function mergeDesignFindings(
  sealingRubric: ReadonlyArray<RubricResult>,
  reviewRubric: ReadonlyArray<RubricResult>,
): RubricResult[] {
  const merged: RubricResult[] = [];
  const seen = new Set<string>();

  const reviewMap = new Map<string, RubricResult>();
  for (const result of reviewRubric) {
    reviewMap.set(result.id, result);
  }

  for (const result of sealingRubric) {
    if (result.pass || seen.has(result.id)) {
      continue;
    }

    if (DETERMINISTIC_RUBRIC_IDS.has(result.id)) {
      const reviewResult = reviewMap.get(result.id);
      if (reviewResult !== undefined && reviewResult.pass) {
        // Acquitted! The completion review re-measured this deterministic row
        // over the cumulative diff and found it passing. Clear the sealing FAIL.
        seen.add(result.id);
        continue;
      }
      seen.add(result.id);
      merged.push(reviewResult && !reviewResult.pass ? reviewResult : result);
      continue;
    }

    seen.add(result.id);
    merged.push(result);
  }

  for (const result of reviewRubric) {
    if (result.pass || seen.has(result.id)) {
      continue;
    }
    seen.add(result.id);
    merged.push(result);
  }

  return merged;
}

/**
 * The design-fix or suite-repair brief: the completion review's failing rubric items, fed to
 * the executor as the next step's instruction — composed deterministically
 * from the form the judge already filled (the `buildRemediationBrief`
 * discipline: no extra LLM call, no paraphrase drift).
 */
export function buildCompletionReviewBrief(form: JudgeForm): string {
  const rubricFails = form.rubricResults.filter((r) => !r.pass);
  const hasSuiteFail = rubricFails.some((r) => r.id === RUBRIC_PRE_EXISTING_SUITE_GREEN);

  if (!hasSuiteFail) {
    const lines: string[] = [
      "DESIGN REVIEW BRIEF — every acceptance criterion passes; a completion review",
      "of the run's CUMULATIVE changes found design findings. One bounded fix",
      "attempt is granted; do NOT change behavior, only design.",
    ];
    if (rubricFails.length > 0) {
      lines.push("design findings (judge evidence):");
      for (const fail of rubricFails) lines.push(`- ${fail.id}: ${fail.justification}`);
    }
    lines.push(
      "a fix must resolve these findings while keeping every acceptance criterion passing.",
    );
    const text = lines.join("\n");
    return text.length <= COMPLETION_BRIEF_MAX_CHARS
      ? text
      : `${text.slice(0, COMPLETION_BRIEF_MAX_CHARS - 1)}…`;
  }

  const headerLines = [
    "REPAIR BRIEF — every acceptance criterion passes; a completion review",
    "of the run's CUMULATIVE changes found regression test failures. One bounded repair",
    "attempt is granted; fix the broken behavior and restore the test suite to green.",
    "failing items (judge evidence):",
  ];
  const closingLine =
    "a fix must resolve these findings while keeping every acceptance criterion passing.";

  const otherFails = rubricFails.filter((r) => r.id !== RUBRIC_PRE_EXISTING_SUITE_GREEN);
  const otherFailLines = otherFails.map((fail) => `- ${fail.id}: ${fail.justification}`);

  const suiteFail = rubricFails.find((r) => r.id === RUBRIC_PRE_EXISTING_SUITE_GREEN)!;
  let statusPrefix = suiteFail.justification;
  let outputLog = "";
  const colonIdx = suiteFail.justification.indexOf(":\n");
  if (colonIdx !== -1) {
    statusPrefix = suiteFail.justification.slice(0, colonIdx);
    outputLog = suiteFail.justification.slice(colonIdx + 2);
  }

  const suiteHeaderLine = `- pre_existing_suite_still_green: ${statusPrefix}`;

  const fixedLinesWithoutLog = [
    ...headerLines,
    ...otherFailLines,
    suiteHeaderLine,
    closingLine,
  ];
  const fixedLengthWithoutLog = fixedLinesWithoutLog.join("\n").length;

  // The brief with the suite's own output omitted entirely — the floor this
  // function falls back to whenever there is no room to carry an excerpt.
  const withoutLog = (): string => {
    const text = fixedLinesWithoutLog.join("\n");
    return text.length <= COMPLETION_BRIEF_MAX_CHARS
      ? text
      : `${text.slice(0, COMPLETION_BRIEF_MAX_CHARS - 1)}…`;
  };

  if (!outputLog || fixedLengthWithoutLog >= COMPLETION_BRIEF_MAX_CHARS) return withoutLog();

  const availableForLog = COMPLETION_BRIEF_MAX_CHARS - fixedLengthWithoutLog - 2;
  let logExcerpt = outputLog;
  if (outputLog.length > availableForLog) {
    // F-326: `String.prototype.slice(-0)` is `slice(0)` — the WHOLE string, not the
    // empty one. When the fixed part leaves no room for even the `…\n` marker the
    // excerpt must be DROPPED; emitting it in full blew the 2000-char brief to
    // 46,095 chars on the dogfood-137 delivery.
    const sliceLen = availableForLog - 2;
    if (sliceLen <= 0) return withoutLog();
    logExcerpt = `…\n${outputLog.slice(-sliceLen)}`;
  }

  const finalLines = [
    ...headerLines,
    ...otherFailLines,
    `${suiteHeaderLine}:\n${logExcerpt}`,
    closingLine,
  ];

  return finalLines.join("\n");
}
