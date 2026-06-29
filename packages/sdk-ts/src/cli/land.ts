import { execFileSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { Journal } from "../journal/journal.js";
import { journalPath, workspaceDir } from "../runner/paths.js";
import type { CliDeps, CommonFlags } from "./commands.js";

interface LandArgs extends CommonFlags {
  runId: string;
  branch?: string;
  repo?: string;
  verify?: boolean;
}

export interface LandDeps extends CliDeps {
  runCheck?: (command: string, cwd: string) => void;
  /** WP-249: the landed run's own acceptance `check` commands, re-run against the landed
   * commit under `--verify`. Defaults to reading them from the run journal. */
  loadAcceptanceChecks?: (runId: string, dataDir: string | undefined) => string[];
}

export const VERIFY_COMMANDS: readonly string[] = [
  "devbox run build",
  "devbox run lint",
  "devbox run typecheck",
  "devbox run test",
];

function git(cwd: string, args: string[], input?: string): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 100 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
    ...(input === undefined ? {} : { input }),
  });
}

function hasRef(cwd: string, ref: string): boolean {
  try {
    git(cwd, ["rev-parse", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const collapsedMessage = message.replace(/\s+/g, " ").trim();
  if (
    typeof error === "object" &&
    error !== null &&
    "stderr" in error &&
    typeof error.stderr === "string"
  ) {
    const stderr = error.stderr.replace(/\s+/g, " ").trim();
    if (stderr !== "") return `${collapsedMessage}: ${stderr}`;
  }
  return collapsedMessage;
}

function defaultLoadAcceptanceChecks(runId: string, dataDir: string | undefined): string[] {
  const journal = new Journal(journalPath(dataDir ?? ".chikory", runId));
  const criteria = journal.getRun()?.task.acceptanceCriteria ?? [];
  return criteria
    .filter((c) => typeof c.check === "string" && c.check.trim() !== "")
    .map((c) => c.check as string);
}

/**
 * Land a finished run's net workspace diff as one auditable commit.
 */
export async function cmdLand(args: LandArgs, deps: LandDeps = {}): Promise<number> {
  const out = deps.out ?? (() => {});
  const err = deps.err ?? (() => {});
  const runCheck =
    deps.runCheck ??
    ((command: string, cwd: string): void => {
      execSync(command, { cwd, stdio: ["ignore", "inherit", "inherit"] });
    });
  const loadAcceptanceChecks = deps.loadAcceptanceChecks ?? defaultLoadAcceptanceChecks;
  const workspace = workspaceDir(args.dataDir, args.runId);
  const repo = resolve(args.repo ?? process.cwd());
  const branch = args.branch ?? `land-${args.runId}`;
  let acceptanceChecks: string[] = [];

  if (!existsSync(workspace)) {
    err(`chikory: workspace for run '${args.runId}' not found at ${workspace}`);
    return 1;
  }

  try {
    if (git(repo, ["status", "--porcelain"]).trim() !== "") {
      err(
        `chikory: target repository '${repo}' has uncommitted changes; ` +
          `commit or stash them before landing`,
      );
      return 1;
    }

    const baseRef = hasRef(workspace, "chikory-base") ? "chikory-base" : "main";
    const diff = git(workspace, ["diff", `${baseRef}..HEAD`]);
    if (diff.trim() === "") {
      err(`chikory: run '${args.runId}' has no workspace changes to land`);
      return 1;
    }

    if (hasRef(repo, `refs/heads/${branch}`)) {
      git(repo, ["checkout", branch]);
    } else {
      git(repo, ["checkout", "-b", branch]);
    }
    git(repo, ["apply", "-"], diff);
    git(repo, ["add", "--all"]);
    git(repo, [
      "commit",
      "-m",
      `feat: land ${args.runId}`,
      "-m",
      [
        `Run-ID: ${args.runId}`,
        `Source workspace: ${workspace}`,
        `Verification: ${VERIFY_COMMANDS.join(" && ")}`,
      ].join("\n"),
    ]);
    const sha = git(repo, ["rev-parse", "HEAD"]).trim();

    if (args.verify === true) {
      for (const command of VERIFY_COMMANDS) {
        if (!args.json) out(`verify: ${command}`);
        try {
          runCheck(command, repo);
        } catch {
          err(`chikory: verification failed: ${command}`);
          err(`chikory: commit kept: ${sha} — inspect with: git -C ${repo} show ${sha}`);
          return 1;
        }
      }
      acceptanceChecks = loadAcceptanceChecks(args.runId, args.dataDir);
      for (const check of acceptanceChecks) {
        if (!args.json) out(`acceptance: ${check}`);
        try {
          runCheck(check, repo);
        } catch {
          err(`chikory: acceptance check failed against landed commit: ${check}`);
          err(`chikory: commit kept: ${sha} — inspect with: git -C ${repo} show ${sha}`);
          return 1;
        }
      }
    }

    if (args.json) {
      out(
        JSON.stringify({
          runId: args.runId,
          branch,
          commit: sha,
          workspace,
          ...(args.verify === true ? { verified: true, acceptanceChecks: acceptanceChecks.length } : {}),
        }),
      );
    } else {
      if (args.verify === true) {
        out(`verified: ${VERIFY_COMMANDS.length}/${VERIFY_COMMANDS.length} checks green`);
        out(`acceptance: ${acceptanceChecks.length}/${acceptanceChecks.length} checks green`);
      }
      out(`branch: ${branch}`);
      out(`commit: ${sha}`);
      out(`forensics: chikory trace ${args.runId}`);
    }
    return 0;
  } catch (error) {
    err(`chikory: land failed: ${errorMessage(error)}`);
    return 1;
  }
}
