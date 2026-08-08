/**
 * Task discrimination probe (WP-593) — mechanical proof that a task's requirement
 * checks fail on the untouched pinned base and pass on the real upstream fix.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { runBounded, scrubExecutorEnv } from "@chikory/sdk";

import { ensureGitWorkspace } from "./adapter.js";
import { verifyBaseGreen } from "./base-verify.js";
import { decideTargetNode, discoverNodeToolchains, pinnedNodeProvisioning } from "./engine.js";
import { publishableRepoPath } from "./results.js";
import { parseAuthoredTask } from "./task.js";

export interface ProbeRequirementResult {
  id: string;
  base: "red" | "green";
  fix: "red" | "green";
  classification: "discriminating" | "non-discriminating" | "unsatisfiable" | "inconclusive";
  reason: string;
}

export interface ProbeVerificationReport {
  green: boolean;
  reason: string;
}

export interface ProbeResult {
  taskId: string;
  baseRef: string;
  fixRef: string;
  baseWorkspace: string;
  fixWorkspace: string;
  baseVerification: ProbeVerificationReport;
  fixVerification: ProbeVerificationReport;
  verdict: "discriminating" | "not-discriminating" | "inconclusive";
  requirements: ProbeRequirementResult[];
}

const BASE_WORKSPACE_DIR = "base-workspace";
const FIX_WORKSPACE_DIR = "fix-workspace";

export interface RunProbeOptions {
  taskPath: string;
  outDir?: string;
  baseVerifyTimeoutMs?: number;
}

async function runCheck(
  command: string,
  cwd: string,
  timeoutMs = 120_000,
): Promise<{ code: number | null; output: string }> {
  const bounded = await runBounded("/bin/sh", ["-c", command], {
    cwd,
    env: scrubExecutorEnv(process.env, []),
    maxSeconds: timeoutMs / 1000,
  });
  const code = bounded.timedOut ? 1 : (bounded.exitCode ?? 1);
  const output = `${bounded.stdout}${bounded.stderr}${
    bounded.timedOut ? `\n[check timed out after ${timeoutMs}ms]` : ""
  }`;
  return { code, output };
}

export async function runProbe(options: RunProbeOptions): Promise<{ result: ProbeResult; outDir: string; code: number }> {
  const absoluteTaskPath = resolve(options.taskPath);
  if (!existsSync(absoluteTaskPath)) {
    throw new Error(`Task file not found: ${absoluteTaskPath}`);
  }

  const yamlContent = readFileSync(absoluteTaskPath, "utf8");
  const task = parseAuthoredTask(yamlContent, options.taskPath);

  if (!task.repo || !task.repo.fixRef) {
    throw new Error(`Task ${task.id} is missing repo.fix_ref required for probe`);
  }

  const repoUrl = task.repo.url;
  const baseRef = task.repo.ref;
  const fixRef = task.repo.fixRef;

  const targetOutDir = options.outDir
    ? resolve(options.outDir)
    : join(dirname(absoluteTaskPath), "probe-output");
  mkdirSync(targetOutDir, { recursive: true });

  const baseWorkspace = join(targetOutDir, BASE_WORKSPACE_DIR);
  const fixWorkspace = join(targetOutDir, FIX_WORKSPACE_DIR);
  mkdirSync(baseWorkspace, { recursive: true });
  mkdirSync(fixWorkspace, { recursive: true });

  ensureGitWorkspace(baseWorkspace, repoUrl, baseRef);
  ensureGitWorkspace(fixWorkspace, repoUrl, fixRef);

  // Determine Node toolchain provisioning if specified/needed
  const toolchains = discoverNodeToolchains();
  const ambientVersion = process.version;
  const baseProvisioning = task.nodeVersion
    ? pinnedNodeProvisioning(task.nodeVersion, toolchains)
    : decideTargetNode(null, toolchains, ambientVersion);
  const fixProvisioning = task.nodeVersion
    ? pinnedNodeProvisioning(task.nodeVersion, toolchains)
    : decideTargetNode(null, toolchains, ambientVersion);

  const baseVerifyCommand = task.baseVerificationCommand ?? "true";
  const timeoutMs = options.baseVerifyTimeoutMs;

  const baseVerifyRes = await verifyBaseGreen({
    command: baseVerifyCommand,
    cwd: baseWorkspace,
    provisioning: baseProvisioning,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });

  const fixVerifyRes = await verifyBaseGreen({
    command: baseVerifyCommand,
    cwd: fixWorkspace,
    provisioning: fixProvisioning,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });

  const baseVerificationReport: ProbeVerificationReport = {
    green: baseVerifyRes.green,
    reason: baseVerifyRes.reason,
  };
  const fixVerificationReport: ProbeVerificationReport = {
    green: fixVerifyRes.green,
    reason: fixVerifyRes.reason,
  };

  // F-270: anchor on the OUT DIR, not on each workspace. `ensureGitWorkspace`
  // materializes a `.git` INSIDE each workspace, so publishing the workspace
  // itself makes both collapse to "." — the two refs look like one. The out dir
  // is the artifact's own home, so `<out>/base-workspace` and
  // `<out>/fix-workspace` stay distinct AND resolve from where probe.json sits.
  const pubOutDir = publishableRepoPath(targetOutDir, "probe output directory");
  const pubBaseWs = join(pubOutDir, BASE_WORKSPACE_DIR);
  const pubFixWs = join(pubOutDir, FIX_WORKSPACE_DIR);

  const requirementsReport: ProbeRequirementResult[] = [];

  let overallVerdict: "discriminating" | "not-discriminating" | "inconclusive" = "inconclusive";
  let exitCode = 1;

  if (!baseVerifyRes.green || !fixVerifyRes.green) {
    overallVerdict = "inconclusive";
    exitCode = 1;
    for (const req of task.requirements) {
      requirementsReport.push({
        id: req.id,
        base: "red",
        fix: "red",
        classification: "inconclusive",
        reason: !baseVerifyRes.green
          ? `Base verification failed: ${baseVerifyRes.reason}`
          : `Fix verification failed: ${fixVerifyRes.reason}`,
      });
    }
  } else {
    let allDiscriminating = true;
    for (const req of task.requirements) {
      if (req.grading.kind !== "check") {
        requirementsReport.push({
          id: req.id,
          base: "red",
          fix: "red",
          classification: "inconclusive",
          reason: "Only check-kind requirements can be probed mechanically",
        });
        allDiscriminating = false;
        continue;
      }

      const baseCheck = await runCheck(req.grading.command, baseWorkspace);
      const fixCheck = await runCheck(req.grading.command, fixWorkspace);

      const baseGreen = baseCheck.code === 0;
      const fixGreen = fixCheck.code === 0;

      const baseTag: "red" | "green" = baseGreen ? "green" : "red";
      const fixTag: "red" | "green" = fixGreen ? "green" : "red";

      let classification: "discriminating" | "non-discriminating" | "unsatisfiable";
      let reason: string;

      if (!baseGreen && fixGreen) {
        classification = "discriminating";
        reason = "Requirement fails on base ref (exit non-zero) and passes on fix ref (exit 0)";
      } else if (baseGreen) {
        classification = "non-discriminating";
        reason = "Requirement passes on base ref (exit 0) — free for every arm";
        allDiscriminating = false;
      } else {
        classification = "unsatisfiable";
        reason = "Requirement fails on base ref and fails on fix ref (exit non-zero)";
        allDiscriminating = false;
      }

      requirementsReport.push({
        id: req.id,
        base: baseTag,
        fix: fixTag,
        classification,
        reason,
      });
    }

    if (allDiscriminating && requirementsReport.length > 0) {
      overallVerdict = "discriminating";
      exitCode = 0;
    } else {
      overallVerdict = "not-discriminating";
      exitCode = 1;
    }
  }

  const probeResult: ProbeResult = {
    taskId: task.id,
    baseRef,
    fixRef,
    baseWorkspace: pubBaseWs,
    fixWorkspace: pubFixWs,
    baseVerification: baseVerificationReport,
    fixVerification: fixVerificationReport,
    verdict: overallVerdict,
    requirements: requirementsReport,
  };

  const probeJsonPath = join(targetOutDir, "probe.json");
  writeFileSync(probeJsonPath, JSON.stringify(probeResult, null, 2));

  return { result: probeResult, outDir: targetOutDir, code: exitCode };
}
