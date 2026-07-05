/**
 * Judge harness (WP-131) — one judge pass: collect evidence, have the judge
 * LLM fill the binary form, deterministically override checked items (JD-4),
 * compute the verdict in code (JD-7), return a `JudgeVerdict`.
 *
 * Failures are values (invariant #4): a router failure or an invalid form
 * yields an ESCALATE verdict, never a throw — a throw here would mean
 * unbounded Temporal activity retries, each one spending judge LLM cost.
 */
import { JudgeFormSchema } from "../schemas.js";
import type {
  AcceptanceCriterion,
  ArtifactStore,
  CheckpointId,
  JudgeForm,
  JudgeVerdict,
  ModelChoice,
  Router,
  TokenUsage,
} from "../types.js";
import {
  collectEvidence,
  type CheckRun,
  type CollectedEvidence,
  type EvidenceWorkspaceRepo,
} from "./evidence.js";
import { buildJudgeMessages, JUDGE_FORM_RESPONSE_SCHEMA } from "./prompt.js";
import { RUBRIC_TESTS_PASS, STANDING_RUBRIC, type RubricItem } from "./rubric.js";
import { computeVerdict } from "./verdict.js";

const ZERO_TOKENS: TokenUsage = { input: 0, output: 0 };
const EMPTY_FORM: JudgeForm = { criterionResults: [], rubricResults: [], concerns: [] };

export interface BuildVerdictOptions {
  runId: string;
  judgeModel: ModelChoice;
  costUsd: number;
  tokens: TokenUsage;
  /** ROLLBACK target; absent → the run's base checkpoint. */
  lastGoodCheckpointId?: CheckpointId;
  rubric?: RubricItem[];
}

/** Fallback ROLLBACK target: the workspace state right after `prepareRun`. */
export function baseCheckpointId(runId: string): CheckpointId {
  return `${runId}@base`;
}

/**
 * form + history → `JudgeVerdict` via the deterministic CONTRACTS.md §4 rules.
 * Pure given its inputs — WP-132 reuses it to recompute a verdict from a
 * journaled form after a crash, with zero extra LLM spend.
 */
export function buildVerdict(
  form: JudgeForm,
  criteriaHistory: Record<string, boolean[]>,
  opts: BuildVerdictOptions,
): JudgeVerdict {
  const decision = computeVerdict(form, criteriaHistory, opts.rubric ?? STANDING_RUBRIC);
  return {
    kind: decision.kind,
    form,
    rationale: decision.rationale,
    rollbackTo:
      decision.kind === "ROLLBACK"
        ? (opts.lastGoodCheckpointId ?? baseCheckpointId(opts.runId))
        : undefined,
    escalateReason: decision.escalateReason,
    costUsd: opts.costUsd,
    tokens: opts.tokens,
    judgeModel: opts.judgeModel,
  };
}

function escalate(reason: string, opts: BuildVerdictOptions): JudgeVerdict {
  return {
    kind: "ESCALATE",
    form: { ...EMPTY_FORM, concerns: [reason] },
    rationale: reason,
    escalateReason: reason,
    costUsd: opts.costUsd,
    tokens: opts.tokens,
    judgeModel: opts.judgeModel,
  };
}

/**
 * JD-4: the LLM's opinion never decides items code can decide. Criteria with
 * a `check` command get pass = (exit code 0); the `tests_pass` rubric item is
 * overridden with all-checks-passed whenever checks were run. Returns an
 * error string when the form is unusable (missing required items).
 */
export function applyCheckOverrides(
  form: JudgeForm,
  criteria: AcceptanceCriterion[],
  rubric: RubricItem[],
  checkRuns: CheckRun[],
): { form: JudgeForm } | { error: string } {
  const llmCriteria = new Map(form.criterionResults.map((r) => [r.id, r]));
  const llmRubric = new Map(form.rubricResults.map((r) => [r.id, r]));
  const checks = new Map(checkRuns.map((r) => [r.criterionId, r]));

  const criterionResults: JudgeForm["criterionResults"] = [];
  const missing: string[] = [];
  for (const criterion of criteria) {
    const check = checks.get(criterion.id);
    if (check) {
      criterionResults.push({
        id: criterion.id,
        pass: check.exitCode === 0,
        justification: `judge-executed check \`${check.command}\` exited ${check.exitCode}`,
      });
      continue;
    }
    const llm = llmCriteria.get(criterion.id);
    if (!llm) {
      missing.push(criterion.id);
      continue;
    }
    criterionResults.push(llm);
  }

  const rubricResults: JudgeForm["rubricResults"] = [];
  for (const item of rubric) {
    if (item.id === RUBRIC_TESTS_PASS && checkRuns.length > 0) {
      const failed = checkRuns.filter((r) => r.exitCode !== 0);
      rubricResults.push({
        id: item.id,
        pass: failed.length === 0,
        justification:
          failed.length === 0
            ? `all ${checkRuns.length} judge-executed checks exited 0`
            : `${failed.length}/${checkRuns.length} judge-executed checks failed: ${failed.map((r) => r.criterionId).join(", ")}`,
      });
      continue;
    }
    const llm = llmRubric.get(item.id);
    if (!llm) {
      missing.push(item.id);
      continue;
    }
    rubricResults.push(llm);
  }

  if (missing.length > 0) {
    return { error: `judge form missing required items: ${missing.join(", ")}` };
  }
  // Unknown ids are dropped: the verdict is computed only over declared
  // criteria and rubric items (the model cannot smuggle in new ones).
  return { form: { criterionResults, rubricResults, concerns: form.concerns } };
}

export interface RunJudgePassInput {
  runId: string;
  router: Router;
  /** Recorded on the verdict (and used for the span/journal), not for routing. */
  judgeModel: ModelChoice;
  workspaceDir: string;
  store: ArtifactStore;
  goal: string;
  criteria: AcceptanceCriterion[];
  /** Diff base: commit of the checkpoint covering the previous verdict (or run base). */
  sinceCommit: string;
  /** Resolved workspace repos for per-writable-repo evidence. */
  workspaceRepos?: EvidenceWorkspaceRepo[];
  /** Per-resolved-repo diff bases, keyed by workspace repo name. */
  repoDiffBases?: Record<string, string>;
  /** Per-criterion pass booleans from previous verdicts, oldest first. */
  criteriaHistory: Record<string, boolean[]>;
  stepSummaries: string[];
  /** Current bounded work chunk directive for this judge pass, when this step used one. */
  activeWorkChunkDirective?: string;
  lastGoodCheckpointId?: CheckpointId;
  rubric?: RubricItem[];
  checkTimeoutMs?: number;
}

export interface JudgePassResult {
  verdict: JudgeVerdict;
  collected: CollectedEvidence;
  durationMs: number;
}

export async function runJudgePass(input: RunJudgePassInput): Promise<JudgePassResult> {
  const started = Date.now();
  const rubric = input.rubric ?? STANDING_RUBRIC;
  const collected = await collectEvidence({
    workspaceDir: input.workspaceDir,
    store: input.store,
    criteria: input.criteria,
    sinceCommit: input.sinceCommit,
    workspaceRepos: input.workspaceRepos,
    repoDiffBases: input.repoDiffBases,
    criteriaHistory: input.criteriaHistory,
    stepSummaries: input.stepSummaries,
    checkTimeoutMs: input.checkTimeoutMs,
  });

  const result = await input.router.complete({
    stage: "judge",
    messages: buildJudgeMessages({
      goal: input.goal,
      evidence: collected.evidence,
      rubric,
      diffText: collected.diffText,
      diffSections: collected.diffSections,
      secretScanLabels: collected.secretScanLabels,
      newDependencyLabels: collected.newDependencyLabels,
      architectureLabels: collected.architectureLabels,
      checkRuns: collected.checkRuns,
      ...(input.activeWorkChunkDirective !== undefined
        ? { activeWorkChunkDirective: input.activeWorkChunkDirective }
        : {}),
    }),
    temperature: 0,
    responseSchema: JUDGE_FORM_RESPONSE_SCHEMA,
  });

  const baseOpts: BuildVerdictOptions = {
    runId: input.runId,
    judgeModel: input.judgeModel,
    costUsd: 0,
    tokens: ZERO_TOKENS,
    lastGoodCheckpointId: input.lastGoodCheckpointId,
    rubric,
  };

  if (result.status === "FAILED") {
    return {
      verdict: escalate(
        `judge LLM call failed after ${result.attempts} attempts: ${result.reason}`,
        baseOpts,
      ),
      collected,
      durationMs: Date.now() - started,
    };
  }

  const spent: BuildVerdictOptions = { ...baseOpts, costUsd: result.costUsd, tokens: result.tokens };
  const parsed = JudgeFormSchema.safeParse(JSON.parse(result.content));
  if (!parsed.success) {
    return {
      verdict: escalate(`judge form failed schema validation: ${parsed.error.message}`, spent),
      collected,
      durationMs: Date.now() - started,
    };
  }

  const overridden = applyCheckOverrides(parsed.data, input.criteria, rubric, collected.checkRuns);
  if ("error" in overridden) {
    return {
      verdict: escalate(overridden.error, spent),
      collected,
      durationMs: Date.now() - started,
    };
  }

  return {
    verdict: buildVerdict(overridden.form, input.criteriaHistory, spent),
    collected,
    durationMs: Date.now() - started,
  };
}
