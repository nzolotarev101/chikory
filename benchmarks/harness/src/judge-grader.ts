/**
 * Judge grader (WP-301) — grades a DevAI natural-language criterion against a
 * task workspace, DevAI-style: locate the files the criterion names, read
 * them, judge. Provider access is an injected `complete` function, so the
 * grader is vendor-neutral and — via `commandComplete` — works with keyless
 * CLI subscriptions (`claude -p`, `codex exec`), the CLI-auth/no-secrets shape.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { z } from "zod";

import type { JudgeFn, JudgeVerdict } from "./grade.js";

/** LLM call: system + user in, raw assistant text out. */
export type CompleteFn = (input: { system: string; user: string }) => Promise<string>;

const MAX_TREE_ENTRIES = 400;
const MAX_FILE_CHARS = 8_000;
const MAX_TOTAL_EVIDENCE_CHARS = 32_000;
const SKIP_DIRS = new Set([".git", "node_modules", "__pycache__", ".venv", "dist"]);

function listTree(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (out.length >= MAX_TREE_ENTRIES) return;
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of names) {
      if (out.length >= MAX_TREE_ENTRIES) return;
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(full);
      } else {
        out.push(relative(root, full));
      }
    }
  };
  walk(root);
  return out;
}

/** Paths the criterion names in backticks — DevAI criteria are file-anchored. */
export function referencedPaths(criteria: string): string[] {
  const paths: string[] = [];
  for (const match of criteria.matchAll(/`([^`\n]+)`/g)) {
    const candidate = match[1]!;
    if (candidate.includes("/") || /\.[a-z0-9]{1,6}$/i.test(candidate)) paths.push(candidate);
  }
  return [...new Set(paths)];
}

/** Workspace evidence for one criterion: file tree + referenced file contents. */
export function buildEvidence(criteria: string, workspaceDir: string): string {
  const tree = listTree(workspaceDir);
  const sections: string[] = [
    `## Workspace file tree (${tree.length} entries${tree.length >= MAX_TREE_ENTRIES ? ", truncated" : ""})`,
    tree.join("\n") || "(empty workspace)",
  ];
  let budget = MAX_TOTAL_EVIDENCE_CHARS - sections.join("\n").length;
  for (const ref of referencedPaths(criteria)) {
    if (budget <= 0) break;
    // Referenced paths may be dirs (`models/saved_models/`) — match tree files under them.
    const hits = tree.filter((p) => p === ref || p.startsWith(ref.replace(/\/$/, "") + "/"));
    for (const hit of hits.slice(0, 5)) {
      if (budget <= 0) break;
      let content: string;
      try {
        content = readFileSync(join(workspaceDir, hit), "utf8");
      } catch {
        continue;
      }
      const clipped = content.slice(0, Math.min(MAX_FILE_CHARS, budget));
      sections.push(`## File: ${hit}${content.length > clipped.length ? " (truncated)" : ""}`, clipped);
      budget -= clipped.length;
    }
    if (hits.length === 0) sections.push(`## File: ${ref}`, "(not found in workspace)");
  }
  return sections.join("\n\n");
}

export const JUDGE_GRADER_SYSTEM_PROMPT = [
  "You are grading one requirement of a software-engineering benchmark task.",
  "Judge ONLY from the workspace evidence provided — file tree and file contents.",
  "A requirement is satisfied only if the evidence concretely shows it; absence of evidence means unsatisfied.",
  'Reply with EXACTLY one JSON object, no markdown fence: {"satisfied": true|false, "rationale": "<one sentence citing the evidence>"}',
].join("\n");

const VerdictReply = z.object({ satisfied: z.boolean(), rationale: z.string() });

/** Fail-closed parse: an unparseable judge reply grades unsatisfied. */
export function parseJudgeReply(raw: string): JudgeVerdict {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = VerdictReply.safeParse(JSON.parse(raw.slice(start, end + 1)));
      if (parsed.success) return parsed.data;
    } catch {
      // fall through to fail-closed
    }
  }
  return { satisfied: false, rationale: `unparseable judge reply: ${raw.slice(0, 200)}` };
}

export function makeJudgeGrader(complete: CompleteFn): JudgeFn {
  return async ({ criteria, workspaceDir }) => {
    const evidence = buildEvidence(criteria, workspaceDir);
    const user = `# Requirement\n${criteria}\n\n# Workspace evidence\n${evidence}`;
    const raw = await complete({ system: JUDGE_GRADER_SYSTEM_PROMPT, user });
    return parseJudgeReply(raw);
  };
}

/**
 * `complete` via an arbitrary CLI command — `{promptFile}` is replaced with a
 * temp file holding system+user prompt; stdout is the reply. E.g.
 * `claude -p "$(cat {promptFile})"` — a keyless CLI-subscription judge.
 */
export function commandComplete(template: string, timeoutMs = 300_000): CompleteFn {
  return ({ system, user }) =>
    new Promise((resolve, reject) => {
      const dir = mkdtempSync(join(tmpdir(), "chikory-bench-judge-"));
      const promptFile = join(dir, "prompt.md");
      writeFileSync(promptFile, `${system}\n\n${user}\n`);
      const command = template.replaceAll("{promptFile}", promptFile);
      const child = spawn("bash", ["-c", command], { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
      child.stderr.on("data", (c: Buffer) => {
        if (stderr.length < 4_096) stderr += c.toString();
      });
      const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(stdout);
        else reject(new Error(`judge command exit ${code}: ${stderr.slice(0, 500)}`));
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
}
