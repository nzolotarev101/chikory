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
import { describeCompactionPressure } from "../runner/compaction-pressure.js";
import { summarizeCompaction } from "../runner/compaction-summary.js";
import { summarizePacing } from "../runner/pacing-summary.js";
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
  /** WP-520 (ADR-009 D4): this FAILED seal is healable — `chikory resume` re-enters it. */
  resumable?: boolean;
}

/** journal-format.md §3 `remediation` entry (WP-519, ADR-009 D3). */
interface RemediationTracePayload {
  remediationIndex: number;
  atStep: number;
  trigger: string;
  rollbackTo?: string;
}

interface ControlEventPayload {
  event?: string;
  source?: string;
  details?: Record<string, number>;
}

interface SoakTraceSummary {
  reentries: number;
  sleptMs: number;
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

function summarizeSoakTrace(entries: JournalEntry[]): SoakTraceSummary {
  let reentries = 0;
  let sleptMs = 0;

  for (const entry of entries) {
    if (entry.kind !== "control_event") continue;
    const payload = entry.payload as ControlEventPayload;
    if (payload.source !== "soak" || payload.event !== "resume") continue;

    const completedReentries = payload.details?.["completedReentries"];
    const totalSleptMs = payload.details?.["totalSleptMs"];
    const sleepMs = payload.details?.["sleepMs"];

    if (typeof completedReentries === "number") {
      reentries = Math.max(reentries, completedReentries);
    } else {
      reentries += 1;
    }

    if (typeof totalSleptMs === "number") {
      sleptMs = Math.max(sleptMs, totalSleptMs);
    } else if (typeof sleepMs === "number") {
      sleptMs += sleepMs;
    }
  }

  return { reentries, sleptMs };
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
  const pacing = summarizePacing(entries);
  const compaction = summarizeCompaction(entries);
  const compactionPressure = describeCompactionPressure(entries);
  const soak = summarizeSoakTrace(entries);
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
  const remediationSummary =
    (totals.remediations ?? 0) > 0 ? ` · remediations ${totals.remediations}` : "";
  lines.push(
    `totals: decisions ${totals.steps} · judge passes ${totals.judgePasses} ` +
      `($${totals.judgeCostUsd.toFixed(2)}, ${(totals.judgeCostShare * 100).toFixed(1)}%) · ` +
      `rollbacks ${totals.rollbacks} · escalations ${totals.escalations}${remediationSummary}`,
  );
  const feedback =
    totals.judgePasses > 0
      ? ` · feedback frequency 1/${Math.max(1, Math.round(totals.steps / totals.judgePasses))} steps`
      : "";
  const seamSummary = seams > 0 ? ` · seams fired ${seams}` : "";
  const pacingSummary =
    pacingEvents > 0
      ? ` · pacing events ${pacingEvents} · peak window ${Math.round(pacing.peakUtilization * 100)}% (compact ${pacing.compactRecommended} · park ${pacing.parkRecommended})`
      : "";
  const compactionSummary =
    compaction.folds > 0
      ? ` · compactions ${compaction.folds} (pacing ${compaction.pacingFolds})`
      : "";
  const compactionPressureSummary =
    compactionPressure.pressureSteps > 0 || compactionPressure.pacingFolds > 0
      ? ` · pressure-steps ${compactionPressure.pressureSteps} (unfolded ${compactionPressure.unfoldedPressureSteps})`
      : "";
  const memoryRecalls = totals.memoryRecalls ?? 0;
  const memoryEvictions = totals.memoryEvictions ?? 0;
  const memorySummary =
    memoryRecalls > 0 || memoryEvictions > 0
      ? ` · memory recalls ${memoryRecalls} · evicted ${memoryEvictions}`
      : "";
  const soakSummary =
    soak.reentries > 0 || soak.sleptMs > 0
      ? ` · re-entries ${soak.reentries} · soak-slept ${formatDuration(soak.sleptMs)}`
      : "";
  lines.push(
    `        injections ${injections} · checkpoints ${checkpoints}${seamSummary}${pacingSummary}${compactionSummary}${compactionPressureSummary}${memorySummary}${soakSummary}${feedback}`,
  );
  lines.push(
    `        issues found ${issuesFound} · changes made ${changesMade} ` +
      `(issues:changes ${issuesFound}:${changesMade})`,
  );
  lines.push(`        components over time: ${timeline}`);

  // A reopened resumable-FAILED run (WP-520) may hold several terminal
  // entries — the LAST one is the current seal.
  const terminal = [...entries].reverse().find((e) => e.kind === "terminal");
  if (terminal) {
    const payload = terminal.payload as TerminalPayload;
    if (payload.status === "FAILED" && payload.reason) {
      lines.push(
        `failed: ${payload.reason}` +
          (payload.lastCheckpoint ? ` (last checkpoint ${payload.lastCheckpoint})` : "") +
          (payload.resumable === true ? " — resumable: chikory resume re-enters this seal" : ""),
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
/** Helper to format step summary to a multi-line colorized string */
function formatStepSummary(summary: string, indent: string): string {
  if (!summary) return "";

  const reset = "\x1b[0m";
  const bold = "\x1b[1m";
  const dim = "\x1b[2m";
  const green = "\x1b[32m";
  const red = "\x1b[31m";
  const yellow = "\x1b[33m";
  const blue = "\x1b[34m";
  const cyan = "\x1b[36m";

  const cleanSummary = summary.replace(/\bCHIKORY_TASK_COMPLETE\b/g, "").trim();

  let description = cleanSummary;
  let changesSection = "";
  let verificationSection = "";

  const changedIndex = cleanSummary.search(/\b(Changed|Changes):/i);
  const verificationIndex = cleanSummary.search(/\bVerification:/i);

  if (changedIndex !== -1) {
    description = cleanSummary.slice(0, changedIndex).trim();
    if (verificationIndex !== -1 && verificationIndex > changedIndex) {
      changesSection = cleanSummary.slice(changedIndex, verificationIndex).trim();
      verificationSection = cleanSummary.slice(verificationIndex).trim();
    } else {
      changesSection = cleanSummary.slice(changedIndex).trim();
    }
  } else if (verificationIndex !== -1) {
    description = cleanSummary.slice(0, verificationIndex).trim();
    verificationSection = cleanSummary.slice(verificationIndex).trim();
  }

  const lines: string[] = [];

  let descText = description;
  if (descText.startsWith("Done:")) {
    descText = descText.slice(5).trim();
  }

  descText = descText.replace(/`([^`]+)`/g, `${cyan}$1${reset}`);

  const wrapWidth = 80 - indent.length;
  const words = descText.split(/\s+/);
  let currentLine = "";
  for (const word of words) {
    if (currentLine.length + word.length + 1 > wrapWidth) {
      lines.push(indent + currentLine);
      currentLine = word;
    } else {
      currentLine = currentLine ? `${currentLine} ${word}` : word;
    }
  }
  if (currentLine) {
    lines.push(indent + currentLine);
  }

  if (changesSection) {
    lines.push("");
    lines.push(`${indent}${bold}${yellow}Changes:${reset}`);
    const items = changesSection.split(/(?:^|\n|\r)\s*-\s+/);
    for (const item of items) {
      const cleanItem = item.trim();
      const lower = cleanItem.toLowerCase();
      if (!cleanItem || lower.startsWith("changed:") || lower.startsWith("changes:")) continue;

      const linkMatch = cleanItem.match(/^\[([^\]]+)\]\(([^)]+)\):?\s*(.*)/s);
      if (linkMatch) {
        const [, label, , desc] = linkMatch;
        const shortLabel = label.split("/").slice(-3).join("/");
        const cleanDesc = desc.replace(/`([^`]+)`/g, `${cyan}$1${reset}`);
        lines.push(`${indent}  • ${bold}${blue}${shortLabel}${reset}: ${cleanDesc}`);
      } else {
        const parts = cleanItem.split(/:\s*(.*)/s);
        const name = parts[0]?.trim() || "";
        const desc = parts[1]?.trim() || "";
        const cleanDesc = desc.replace(/`([^`]+)`/g, `${cyan}$1${reset}`);
        if (name) {
          lines.push(`${indent}  • ${bold}${blue}${name}${reset}${desc ? `: ${cleanDesc}` : ""}`);
        }
      }
    }
  }

  if (verificationSection) {
    lines.push("");
    lines.push(`${indent}${bold}${yellow}Verification:${reset}`);

    if (verificationSection.includes("|")) {
      const tableLines = verificationSection.split(/\r?\n/);
      for (const tLine of tableLines) {
        if (
          !tLine.trim() ||
          tLine.includes("---|---") ||
          tLine.toLowerCase().includes("command | result") ||
          tLine.toLowerCase().includes("verification:")
        ) {
          continue;
        }
        const cells = tLine
          .split("|")
          .map((c) => c.trim())
          .filter(Boolean);
        if (cells.length >= 2) {
          const command = cells[0] ?? "";
          const result = cells[1] ?? "";
          let statusIndicator = `${dim}•${reset}`;
          if (
            result.toLowerCase().includes("pass") ||
            result.toLowerCase().includes("success") ||
            result.toLowerCase().includes("✓")
          ) {
            statusIndicator = `${green}✔${reset}`;
          } else if (result.toLowerCase().includes("fail") || result.toLowerCase().includes("✗")) {
            statusIndicator = `${red}✘${reset}`;
          }
          lines.push(`${indent}  ${statusIndicator} ${bold}${cyan}${command}${reset}: ${result}`);
        }
      }
    } else {
      const items = verificationSection.split(/(?:^|\n|\r)\s*-\s+/);
      for (const item of items) {
        const cleanItem = item.trim();
        if (!cleanItem || cleanItem.toLowerCase().startsWith("verification:")) continue;
        const cleanText = cleanItem.replace(/`([^`]+)`/g, `${cyan}$1${reset}`);
        lines.push(`${indent}  ✔ ${cleanText}`);
      }
    }
  }

  return lines.join("\n");
}

/** One journal entry → one live line (`chikory run --watch`). */
export function formatEntryLine(entry: JournalEntry): string {
  const ts = entry.ts.slice(11, 19); // HH:MM:SS
  const reset = "\x1b[0m";
  const bold = "\x1b[1m";
  const dim = "\x1b[2m";
  const green = "\x1b[32m";
  const red = "\x1b[31m";
  const yellow = "\x1b[33m";
  const cyan = "\x1b[36m";

  switch (entry.kind) {
    case "step": {
      const payload = entry.payload as StepPayload;
      const isSuccess = payload.record.status === "SUCCESS";
      const statusColor = isSuccess ? green : red;
      const statusIcon = isSuccess ? "🟢" : "🔴";
      const header =
        `[${ts}] ${statusIcon} step ${payload.stepIndex + 1} ${statusColor}${bold}${payload.record.status}${reset} ` +
        `${dim}($${payload.record.costUsd.toFixed(4)})${reset}`;
      const formatted = formatStepSummary(payload.record.summary, "  ");
      return formatted ? `${header}\n${formatted}\n` : `${header}\n`;
    }
    case "verdict": {
      const payload = entry.payload as VerdictRowPayload;
      const isProceed = payload.verdict.kind === "PROCEED";
      const verdictColor = isProceed ? green : (payload.verdict.kind === "ESCALATE" ? yellow : red);
      return `[${ts}] verdict ${verdictColor}${bold}${verdictCell(payload)}${reset} @ step ${payload.atStep + 1}`;
    }
    case "judge": {
      const payload = entry.payload as JudgePayload;
      return `[${ts}] ⚖️ judge pass #${payload.judgeIndex + 1} ${dim}($${payload.costUsd.toFixed(4)})${reset}`;
    }
    case "checkpoint": {
      const payload = entry.payload as Checkpoint;
      return `[${ts}] 💾 checkpoint ${cyan}${payload.id}${reset}${payload.lastGood ? ` ${green}(lastGood)${reset}` : ""}`;
    }
    case "budget_event": {
      const payload = entry.payload as { event: string; remainingUsd: number };
      const eventColor = payload.event === "halt" ? red : yellow;
      return `[${ts}] 💰 budget ${eventColor}${bold}${payload.event}${reset} — remaining ${bold}$${payload.remainingUsd.toFixed(2)}${reset}`;
    }
    case "injection": {
      const payload = entry.payload as { text: string };
      return `[${ts}] 💉 injection: ${payload.text}`;
    }
    case "compaction": {
      const payload = entry.payload as CompactionResult & { trigger?: "pacing" | "count" };
      return (
        `[${ts}] 🗜️ compaction ${formatTokens(payload.tokensBefore)}→${formatTokens(payload.tokensAfter)} tokens` +
        (payload.digestRef ? ` ${dim}(digest ${payload.digestRef.id.slice(0, 12)})${reset}` : " (no digest)") +
        (payload.trigger === "pacing" ? ` ${yellow}(pacing)${reset}` : "")
      );
    }
    case "pacing": {
      const payload = entry.payload as {
        action: string;
        utilization: number;
        projectedTokens: number;
      };
      const actionColor = payload.action === "compact" ? yellow : (payload.action === "park" ? red : green);
      return (
        `[${ts}] ⏱️ pacing ${actionColor}${bold}${payload.action}${reset} — ${bold}${Math.round(payload.utilization * 100)}%${reset} window ` +
        `${dim}(${formatTokens(payload.projectedTokens)} proj)${reset}`
      );
    }
    case "remediation": {
      const payload = entry.payload as RemediationTracePayload;
      return (
        `[${ts}] 🩹 remediation attempt ${payload.remediationIndex + 1} @ step ${payload.atStep + 1} — ${payload.trigger}` +
        (payload.rollbackTo ? ` ${dim}(rolled back to ${payload.rollbackTo})${reset}` : "")
      );
    }
    case "terminal": {
      const payload = entry.payload as TerminalPayload;
      const statusColor = payload.status === "SUCCESS" ? green : red;
      const statusIcon = payload.status === "SUCCESS" ? "🏁" : "⚠️";
      return (
        `[${ts}] ${statusIcon} terminal ${statusColor}${bold}${payload.status}${reset}${payload.reason ? ` — ${payload.reason}` : ""}` +
        (payload.resumable === true ? ` ${yellow}(resumable)${reset}` : "")
      );
    }
    default:
      return `[${ts}] ${entry.kind}`;
  }
}
