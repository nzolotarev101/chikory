/**
 * `chikory` argument parsing + dispatch (WP-141). Pure node:util parseArgs —
 * no CLI framework (NF-1: minimal abstraction). The bin entry is `bin.ts`;
 * `main` is directly invokable (and is how the CLI tests drive commands).
 */
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { DEFAULT_DATA_DIR } from "../runner/paths.js";
import {
  cmdApprove,
  cmdCancel,
  cmdResume,
  cmdRun,
  cmdStatus,
  cmdTrace,
  type CommonFlags,
} from "./commands.js";
import { cmdLand, type LandDeps } from "./land.js";

export const HELP = `chikory — vendor-neutral control plane for long-running, self-correcting agents

usage: chikory <command> [options]

commands:
  run <task.yaml>     validate the TaskSpec, start a gated run, follow it to
                      its terminal state (hosts the runner worker in-process)
  resume <run-id>     reattach a worker and continue a run from its last
                      checkpoint (budget halts, escalations, machine moves)
  status [<run-id>]   live run state: current step, spend vs budget, last
                      verdict, checkpoints; no argument lists all local runs
  approve <run-id>    answer an ESCALATE (default approves)
  cancel <run-id>     graceful stop at the next step boundary (final
                      checkpoint is written)
  trace <run-id>      trajectory forensics from the journal: per-step
                      tokens/cost, judge verdicts + rationales, totals
  land <run-id>       apply a finished run's workspace diff as one commit

options (every command):
  --json                machine-readable output
  --data-dir <dir>      run data root (default: ${DEFAULT_DATA_DIR})
  --address <host:port> Temporal server (default: $TEMPORAL_ADDRESS or localhost:7233)
  -h, --help            this text

run options:
  --watch               stream journal entries live while following the run

resume options:
  --add-budget <usd>    top up the budget (continues a budget-halted run)
  --watch               stream journal entries live

approve options:
  --reject <reason>     reject the escalation instead of approving

trace options:
  --step <n>            per-step drill-down: diff/transcript refs, judge form

land options:
  --branch <name>       target branch (default: land-<run-id>)
  --repo <dir>          target repository (default: current directory)
  --verify   run devbox build/lint/typecheck/ test after committing; exit 1 on red (commit kept)

exit codes:
  0  command succeeded; run/resume: run sealed SUCCESS
  1  error; run/resume: run sealed FAILED or CANCELLED; status: run FAILED

quickstart: devbox run temporal-dev, then: chikory run examples/fix-failing-test.yaml`;

interface ParsedCommon {
  flags: CommonFlags;
  positionals: string[];
  values: Record<string, string | boolean | undefined>;
}

function parseCommand(
  args: string[],
  extra: Record<string, { type: "string" | "boolean"; short?: string }>,
): ParsedCommon {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      json: { type: "boolean" },
      "data-dir": { type: "string" },
      address: { type: "string" },
      help: { type: "boolean", short: "h" },
      ...extra,
    },
  });
  const flags: CommonFlags = {
    json: values["json"] === true,
    // Absolute: workspace paths flow into executor CLI flags (codex -C) that
    // must not re-resolve against their own cwd (caught by dogfood-001).
    dataDir: resolve(
      typeof values["data-dir"] === "string" ? values["data-dir"] : DEFAULT_DATA_DIR,
    ),
  };
  if (typeof values["address"] === "string") flags.address = values["address"];
  return { flags, positionals, values: values as ParsedCommon["values"] };
}

function requireArg(positionals: string[], what: string, io: Io): string | undefined {
  const value = positionals[0];
  if (value === undefined) io.err(`chikory: missing ${what} (see chikory --help)`);
  return value;
}

interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
}

export async function main(argv: string[], deps: LandDeps = {}): Promise<number> {
  const io: Io = {
    out: deps.out ?? ((line) => console.log(line)),
    err: deps.err ?? ((line) => console.error(line)),
  };
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    io.out(HELP);
    return command === undefined ? 1 : 0;
  }

  let parsed: ParsedCommon;
  try {
    switch (command) {
      case "run":
        parsed = parseCommand(rest, { watch: { type: "boolean" } });
        break;
      case "resume":
        parsed = parseCommand(rest, {
          "add-budget": { type: "string" },
          watch: { type: "boolean" },
        });
        break;
      case "approve":
        parsed = parseCommand(rest, { reject: { type: "string" } });
        break;
      case "trace":
        parsed = parseCommand(rest, { step: { type: "string" } });
        break;
      case "land":
        parsed = parseCommand(rest, {
          branch: { type: "string" },
          repo: { type: "string" },
          verify: { type: "boolean" },
        });
        break;
      case "status":
      case "cancel":
        parsed = parseCommand(rest, {});
        break;
      default:
        io.err(`chikory: unknown command '${command}'`);
        io.out(HELP);
        return 1;
    }
  } catch (err) {
    io.err(`chikory: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  if (parsed.values["help"] === true) {
    io.out(HELP);
    return 0;
  }
  const { flags, positionals, values } = parsed;

  switch (command) {
    case "run": {
      const file = requireArg(positionals, "task spec file", io);
      if (file === undefined) return 1;
      return cmdRun({ file, watch: values["watch"] === true, ...flags }, deps);
    }
    case "resume": {
      const runId = requireArg(positionals, "run-id", io);
      if (runId === undefined) return 1;
      let addBudgetUsd: number | undefined;
      if (typeof values["add-budget"] === "string") {
        addBudgetUsd = Number.parseFloat(values["add-budget"]);
        if (!Number.isFinite(addBudgetUsd) || addBudgetUsd <= 0) {
          io.err(`chikory: --add-budget must be a positive number of USD`);
          return 1;
        }
      }
      return cmdResume({ runId, addBudgetUsd, watch: values["watch"] === true, ...flags }, deps);
    }
    case "status":
      return cmdStatus({ runId: positionals[0], ...flags }, deps);
    case "approve": {
      const runId = requireArg(positionals, "run-id", io);
      if (runId === undefined) return 1;
      const reject = typeof values["reject"] === "string" ? values["reject"] : undefined;
      return cmdApprove({ runId, reject, ...flags }, deps);
    }
    case "cancel": {
      const runId = requireArg(positionals, "run-id", io);
      if (runId === undefined) return 1;
      return cmdCancel({ runId, ...flags }, deps);
    }
    case "trace": {
      const runId = requireArg(positionals, "run-id", io);
      if (runId === undefined) return 1;
      let step: number | undefined;
      if (typeof values["step"] === "string") {
        step = Number.parseInt(values["step"], 10);
        if (!Number.isInteger(step) || step < 1) {
          io.err(`chikory: --step must be a step number ≥ 1`);
          return 1;
        }
      }
      return cmdTrace({ runId, step, ...flags }, deps);
    }
    case "land": {
      const runId = requireArg(positionals, "run-id", io);
      if (runId === undefined) return 1;
      const branch = typeof values["branch"] === "string" ? values["branch"] : undefined;
      const repo = typeof values["repo"] === "string" ? values["repo"] : undefined;
      return cmdLand(
        { runId, branch, repo, verify: values["verify"] === true, ...flags },
        { ...deps, out: io.out, err: io.err },
      );
    }
    /* v8 ignore next 2 — unreachable: unknown commands return above */
    default:
      return 1;
  }
}
