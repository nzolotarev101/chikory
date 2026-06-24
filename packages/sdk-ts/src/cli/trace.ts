/**
 * Trajectory renderer (WP-142, exit-gate #5) — `chikory trace <run-id>`.
 *
 * Renders the journal so a person who didn't run the task can reconstruct
 * it: per-step tokens/cost/duration, judge verdicts + rationales,
 * checkpoints, JIF totals footer (cli.md §Trajectory renderer). Pure
 * functions over journal rows — no Temporal, works fully offline (RT-9).
 */
import type { RunRow, RunTotals } from "../journal/journal.js";
import type { JudgePayload, StepPayload } from "../runner/activities.js";
import type {
  ArtifactRef,
  Checkpoint,
  CompactionResult,
  JournalEntry,
  JudgeForm,
  VerdictKind,
} from "../types.js";

/** Judge- or runner-sourced verdict rows (journal-format.md §3 both shapes). */
interface VerdictRowPayload {
  atStep: number;
  source?: string;
  verdict: {
    kind: VerdictKind;
    rationale?: string;
    rollbackTo?: string;
    escalateReason?: string;
    form?: JudgeForm;
  };
}

interface TerminalPayload {
  status: string;
  reason?: string;
  lastCheckpoint?: string;
}

const SUMMARY_WIDTH = 36;
const RULE_WIDTH = 79;

/** 950 → "950", 3120 → "3.1k", 12345 → "12k" (cli.md example format). */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Table cells are one line: collapse newlines/runs of whitespace. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncate(text: string, width: number): string {
  const flat = oneLine(text);
  return flat.length <= width ? flat : `${flat.slice(0, width - 1)}…`;
}

/** Wrap a rationale into indented `judge: "…"` continuation lines. */
function wrapRationale(text: string, indent: string, width: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line.length > 0 && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line.length > 0 ? `${line} ${word}` : word;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines.map((l, i) => `${indent}${i === 0 ? 'judge: "' : "       "}${l}${i === lines.length - 1 ? '"' : ""}`);
}

function verdictCell(payload: VerdictRowPayload): string {
  const { verdict } = payload;
  switch (verdict.kind) {
    case "PROCEED": {
      const results = verdict.form?.criterionResults ?? [];
      const passing = results.filter((r) => r.pass).length;
      return `✓ PROCEED (${passing}/${results.length} criteria)`;
    }
    case "ROLLBACK":
      return `⟲ ROLLBACK → ${verdict.rollbackTo ?? "?"}`;
    case "HALT":
      return "⛔ HALT";
    case "ESCALATE":
      return payload.source === "runner" ? "⚠ ESCALATE (runner)" : "⚠ ESCALATE";
    case "BRANCH":
      return "⑂ BRANCH";
  }
}

/** Verdict rows keyed by the step they cover (last one wins per step). */
function verdictsByStep(entries: JournalEntry[]): Map<number, VerdictRowPayload> {
  const map = new Map<number, VerdictRowPayload>();
  for (const entry of entries) {
    if (entry.kind !== "verdict") continue;
    const payload = entry.payload as VerdictRowPayload;
    map.set(payload.atStep, payload);
  }
  return map;
}

function runDurationMs(run: RunRow, entries: JournalEntry[]): number {
  const start = Date.parse(run.startedAt);
  const lastEntry = entries[entries.length - 1];
  const end = run.endedAt ? Date.parse(run.endedAt) : lastEntry ? Date.parse(lastEntry.ts) : start;
  return Math.max(0, end - start);
}

function isUnpricedStep(record: StepPayload["record"]): boolean {
  return (
    record.costEstimated &&
    record.costUsd === 0 &&
    record.tokens.input + record.tokens.output > 0
  );
}

/** The `chikory trace <run-id>` body (cli.md WP-142 format). */
export function renderTrace(run: RunRow, entries: JournalEntry[], totals: RunTotals): string {
  const lines: string[] = [];
  const duration = formatDuration(runDurationMs(run, entries));
  const hasUnpricedStep = entries.some(
    (entry) => entry.kind === "step" && isUnpricedStep((entry.payload as StepPayload).record),
  );
  lines.push(
    `run ${run.runId} · ${run.status} · ${totals.steps} steps · ` +
      `$${totals.costUsd.toFixed(2)} / $${run.task.budgetUsd.toFixed(2)} · ${duration} · ` +
      `executor ${run.task.executor.adapter}(${run.task.executor.family}) · judge ${run.task.judge.family}` +
      `${hasUnpricedStep ? " · ⚠ cost meter blind (unpriced tokens)" : ""}`,
  );
  lines.push("─".repeat(RULE_WIDTH));
  lines.push(` #   ${"step".padEnd(SUMMARY_WIDTH)} tokens(in/out)   cost     verdict`);

  const verdicts = verdictsByStep(entries);
  for (const entry of entries) {
    if (entry.kind !== "step") continue;
    const payload = entry.payload as StepPayload;
    const { record } = payload;
    const tokens = `${formatTokens(record.tokens.input)}/${formatTokens(record.tokens.output)}`;
    const verdict = verdicts.get(payload.stepIndex);
    const cell = verdict
      ? verdictCell(verdict)
      : record.status === "FAILED"
        ? "✗ step FAILED"
        : "";
    lines.push(
      `${String(payload.stepIndex + 1).padStart(2)}   ` +
        `${truncate(record.summary, SUMMARY_WIDTH).padEnd(SUMMARY_WIDTH)} ` +
        `${tokens.padEnd(16)} ` +
        `$${record.costUsd.toFixed(2).padEnd(7)} ${cell}`.trimEnd(),
    );
    if (verdict && verdict.verdict.kind !== "PROCEED" && verdict.verdict.rationale) {
      lines.push(...wrapRationale(verdict.verdict.rationale, "        ", 60));
    }
  }

  const injections = entries.filter((e) => e.kind === "injection").length;
  const checkpoints = entries.filter((e) => e.kind === "checkpoint").length;
  const seams = entries.filter((e) => e.kind === "seam").length;
  const pacingEvents = entries.filter((e) => e.kind === "pacing").length;
  const issuesFound = entries.reduce((count, entry) => {
    if (entry.kind !== "judge") return count;
    const { form } = entry.payload as JudgePayload;
    return (
      count +
      form.criterionResults.filter((result) => result.pass === false).length +
      form.rubricResults.filter((result) => result.pass === false).length +
      form.concerns.length
    );
  }, 0);
  const changesMade = entries.filter(
    (entry) =>
      entry.kind === "step" && (entry.payload as StepPayload).record.diffRef.bytes > 0,
  ).length;
  const timelineTokens: string[] = [];
  for (const entry of entries) {
    if (entry.kind === "step") {
      timelineTokens.push(`s${(entry.payload as StepPayload).stepIndex}`);
    } else if (entry.kind === "judge") {
      timelineTokens.push(`j@${(entry.payload as JudgePayload).atStep}`);
    }
  }
  const timeline = timelineTokens.join(" ");
  lines.push(
    `totals: decisions ${totals.steps} · judge passes ${totals.judgePasses} ` +
      `($${totals.judgeCostUsd.toFixed(2)}, ${(totals.judgeCostShare * 100).toFixed(1)}%) · ` +
      `rollbacks ${totals.rollbacks} · escalations ${totals.escalations}`,
  );
  const feedback =
    totals.judgePasses > 0
      ? ` · feedback frequency 1/${Math.max(1, Math.round(totals.steps / totals.judgePasses))} steps`
      : "";
  const seamSummary = seams > 0 ? ` · seams fired ${seams}` : "";
  const pacingSummary = pacingEvents > 0 ? ` · pacing events ${pacingEvents}` : "";
  lines.push(
    `        injections ${injections} · checkpoints ${checkpoints}${seamSummary}${pacingSummary}${feedback}`,
  );
  lines.push(
    `        issues found ${issuesFound} · changes made ${changesMade} ` +
      `(issues:changes ${issuesFound}:${changesMade})`,
  );
  lines.push(`        components over time: ${timeline}`);

  const terminal = entries.find((e) => e.kind === "terminal");
  if (terminal) {
    const payload = terminal.payload as TerminalPayload;
    if (payload.status === "FAILED" && payload.reason) {
      lines.push(
        `failed: ${payload.reason}` +
          (payload.lastCheckpoint ? ` (last checkpoint ${payload.lastCheckpoint})` : ""),
      );
    }
  }
  return lines.join("\n");
}

function describeRef(ref: ArtifactRef): string {
  return `${ref.id.slice(0, 12)} · ${ref.kind} · ${ref.bytes} bytes · ${ref.summary}`;
}

/**
 * Per-step drill-down (`--step <n>`, 1-based display number): full diff ref,
 * judge form (per-criterion booleans + rationales), transcript pointer.
 */
export function renderStepDetail(entries: JournalEntry[], displayStep: number): string {
  const stepIndex = displayStep - 1;
  const stepEntry = entries.find(
    (e) => e.kind === "step" && (e.payload as StepPayload).stepIndex === stepIndex,
  );
  if (!stepEntry) {
    const steps = entries.filter((e) => e.kind === "step").length;
    return `no step ${displayStep} in this run (${steps} steps journaled)`;
  }
  const payload = stepEntry.payload as StepPayload;
  const { record } = payload;
  const lines: string[] = [];
  const costAnnotation = isUnpricedStep(record)
    ? ` (estimated — UNPRICED: ${record.tokens.input + record.tokens.output} tokens metered)`
    : record.costEstimated
      ? " (estimated)"
      : "";
  lines.push(
    `step ${displayStep} · ${record.status} · $${record.costUsd.toFixed(4)}` +
      `${costAnnotation} · ` +
      `${formatTokens(record.tokens.input)}/${formatTokens(record.tokens.output)} tokens · ` +
      `${formatDuration(record.durationMs)} · ${record.toolCalls} tool calls`,
  );
  lines.push(`instruction: ${payload.instruction}`);
  lines.push(`plan item:   ${payload.planItem}`);
  lines.push(`summary:     ${record.summary}`);
  if (record.failure) {
    lines.push(`failure:     ${record.failure.reason} (retriable: ${record.failure.retriable})`);
  }
  lines.push(`diff:        ${describeRef(record.diffRef)}`);
  lines.push(`transcript:  ${describeRef(record.transcriptRef)}`);

  for (const entry of entries) {
    if (entry.kind === "checkpoint") {
      const ckpt = entry.payload as Checkpoint & { stepIndex: number };
      if (ckpt.stepIndex === stepIndex) {
        const sha = Object.values(ckpt.gitCommits)[0] ?? "?";
        lines.push(
          `checkpoint:  ${ckpt.id} · commit ${sha.slice(0, 12)} · lastGood ${ckpt.lastGood}`,
        );
      }
    }
    if (entry.kind === "judge") {
      const judge = entry.payload as JudgePayload;
      if (judge.atStep !== stepIndex) continue;
      lines.push(
        `judge pass #${judge.judgeIndex + 1} · ${judge.judgeModel.provider}/${judge.judgeModel.model} · ` +
          `$${judge.costUsd.toFixed(4)} · ${judge.evidenceBytes} evidence bytes · ` +
          `${formatDuration(judge.durationMs)}`,
      );
      lines.push("  criteria:");
      for (const r of judge.form.criterionResults) {
        lines.push(`    ${r.pass ? "✓" : "✗"} ${r.id} — ${r.justification}`);
      }
      lines.push("  rubric:");
      for (const r of judge.form.rubricResults) {
        lines.push(`    ${r.pass ? "✓" : "✗"} ${r.id} — ${r.justification}`);
      }
      for (const concern of judge.form.concerns) lines.push(`  concern: ${concern}`);
      for (const ref of judge.evidenceRefs) lines.push(`  evidence: ${describeRef(ref)}`);
    }
    if (entry.kind === "verdict") {
      const verdict = entry.payload as VerdictRowPayload;
      if (verdict.atStep !== stepIndex) continue;
      lines.push(`verdict:     ${verdictCell(verdict)}`);
      if (verdict.verdict.rationale) lines.push(`rationale:   ${verdict.verdict.rationale}`);
    }
  }
  return lines.join("\n");
}

/** `--json`: the raw journal — the P3 benchmark/dataset interchange shape. */
export function traceJson(
  run: RunRow,
  entries: JournalEntry[],
  totals: RunTotals,
): Record<string, unknown> {
  return {
    run: {
      runId: run.runId,
      status: run.status,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      task: run.task,
    },
    totals,
    entries,
  };
}

/** One journal entry → one live line (`chikory run --watch`). */
export function formatEntryLine(entry: JournalEntry): string {
  const ts = entry.ts.slice(11, 19); // HH:MM:SS
  switch (entry.kind) {
    case "step": {
      const payload = entry.payload as StepPayload;
      return (
        `[${ts}] step ${payload.stepIndex + 1} ${payload.record.status} ` +
        `$${payload.record.costUsd.toFixed(4)} — ${oneLine(payload.record.summary)}`
      );
    }
    case "verdict": {
      const payload = entry.payload as VerdictRowPayload;
      return `[${ts}] verdict ${verdictCell(payload)} @ step ${payload.atStep + 1}`;
    }
    case "judge": {
      const payload = entry.payload as JudgePayload;
      return `[${ts}] judge pass #${payload.judgeIndex + 1} $${payload.costUsd.toFixed(4)}`;
    }
    case "checkpoint": {
      const payload = entry.payload as Checkpoint;
      return `[${ts}] checkpoint ${payload.id}${payload.lastGood ? " (lastGood)" : ""}`;
    }
    case "budget_event": {
      const payload = entry.payload as { event: string; remainingUsd: number };
      return `[${ts}] budget ${payload.event} — remaining $${payload.remainingUsd.toFixed(2)}`;
    }
    case "injection": {
      const payload = entry.payload as { text: string };
      return `[${ts}] injection: ${payload.text}`;
    }
    case "compaction": {
      const payload = entry.payload as CompactionResult;
      return (
        `[${ts}] compaction ${formatTokens(payload.tokensBefore)}→${formatTokens(payload.tokensAfter)} tokens` +
        (payload.digestRef ? ` (digest ${payload.digestRef.id.slice(0, 12)})` : " (no digest)")
      );
    }
    case "pacing": {
      const payload = entry.payload as {
        action: string;
        utilization: number;
        projectedTokens: number;
      };
      return (
        `[${ts}] pacing ${payload.action} — ${Math.round(payload.utilization * 100)}% window ` +
        `(${formatTokens(payload.projectedTokens)} proj)`
      );
    }
    case "terminal": {
      const payload = entry.payload as TerminalPayload;
      return `[${ts}] terminal ${payload.status}${payload.reason ? ` — ${payload.reason}` : ""}`;
    }
    default:
      return `[${ts}] ${entry.kind}`;
  }
}
