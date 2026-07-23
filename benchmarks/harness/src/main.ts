/**
 * `chikory-bench` — WP-301 harness CLI (entry: `bin.ts`). Runs inside devbox
 * (`devbox run bench -- <command>`), never against host toolchains.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { chikoryAdapter, commandAdapter, type RunnerAdapter } from "./adapter.js";
import { fetchDevAIInstances } from "./devai.js";
import { commandComplete, makeJudgeGrader } from "./judge-grader.js";
import { loadTaskDir, runSuite } from "./suite.js";
import { isRunnable } from "./task.js";

const USAGE = `usage: chikory-bench <command> [options]

commands:
  validate <task-dir>...   validate every task file (authored YAML + DevAI JSON);
                           exit 1 if any file is invalid
  list <task-dir>...       list loaded tasks (id, class, status, requirements)
  fetch-devai              download the 55 DevAI instance JSONs
      [--ref <git-ref>]      upstream ref (default main)
      [--out <dir>]          default benchmarks/devai/instances
  run --tasks <dir>        run a suite through one adapter and grade it
      --adapter <name>       chikory | command
      [--executor <name>]    chikory executor: gemini | claude-code | codex
                             (default claude-code; also CHIKORY_BENCH_EXECUTOR)
      [--cmd <template>]     command adapter template; placeholders
                             {workspace} {goalFile} {taskId}
      [--judge-cmd <tmpl>]   grade judge-kind requirements via a CLI judge;
                             {promptFile} is replaced with the prompt path
                             (keyless CLI-subscription judge, e.g.
                             'claude -p "$(cat {promptFile})"')
      [--out <dir>]          results root (default benchmarks/results)
      [--filter <substr>]    only tasks whose id contains substr
      [--suite <name>]       summary label (default the tasks dir)

exit codes: 0 ok · 1 invalid input or failed run
`;

interface Flags {
  values: Record<string, string>;
  positionals: string[];
}

/** Map a friendly `--executor` name to a Chikory `{adapter, family}` pair. */
function resolveExecutor(name: string): { adapter: string; family: string } | undefined {
  switch (name) {
    case "gemini":
    case "gemini-cli":
      return { adapter: "gemini-cli", family: "gemini" };
    case "claude":
    case "claude-code":
      return { adapter: "claude-code", family: "anthropic" };
    case "codex":
      return { adapter: "codex", family: "openai" };
    default:
      return undefined;
  }
}

function parseFlags(argv: string[]): Flags {
  const values: Record<string, string> = {};
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        values[key] = "true";
      } else {
        values[key] = next;
        i++;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { values, positionals };
}

export async function main(argv: string[], io = { out: console.log, err: console.error }): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    io.out(USAGE);
    return command === undefined ? 1 : 0;
  }
  const { values, positionals } = parseFlags(rest);

  if (command === "validate" || command === "list") {
    if (positionals.length === 0) {
      io.err("chikory-bench: at least one task dir required");
      return 1;
    }
    let bad = 0;
    for (const dir of positionals) {
      const { tasks, invalid } = loadTaskDir(resolve(dir));
      for (const [file, issues] of Object.entries(invalid)) {
        bad++;
        io.err(`INVALID ${join(dir, file)}`);
        for (const issue of issues) io.err(`  - ${issue}`);
      }
      if (command === "list") {
        for (const t of tasks) {
          io.out(
            `${t.id}  ${t.class}/${t.source}  ${t.status}${isRunnable(t) ? "" : " (not runnable)"}  ` +
              `${t.requirements.length} requirements`,
          );
        }
      } else {
        io.out(`${dir}: ${tasks.length} valid, ${Object.keys(invalid).length} invalid`);
      }
    }
    return bad > 0 ? 1 : 0;
  }

  if (command === "fetch-devai") {
    const ref = values["ref"] ?? "main";
    const out = resolve(values["out"] ?? "benchmarks/devai/instances");
    io.out(`fetching DevAI instances @ ${ref} → ${out}`);
    const instances = await fetchDevAIInstances(ref);
    mkdirSync(out, { recursive: true });
    for (const inst of instances) writeFileSync(join(out, inst.name), inst.content);
    writeFileSync(
      join(out, "manifest.json"),
      JSON.stringify(
        {
          source: "metauto-ai/agent-as-a-judge",
          ref,
          fetchedAt: new Date().toISOString(),
          files: instances.map((i) => ({ name: i.name, sha: i.sha })),
        },
        null,
        2,
      ),
    );
    io.out(`${instances.length} instances written`);
    return instances.length > 0 ? 0 : 1;
  }

  if (command === "run") {
    const tasksDir = values["tasks"];
    const adapterName = values["adapter"];
    if (!tasksDir || !adapterName) {
      io.err("chikory-bench run: --tasks and --adapter are required");
      return 1;
    }
    let adapter: RunnerAdapter;
    if (adapterName === "chikory") {
      // Executor override (directive: Gemini executes / Codex judges). Absent =
      // the adapter's own default. Also readable from CHIKORY_BENCH_EXECUTOR.
      const executorName = values["executor"] ?? process.env.CHIKORY_BENCH_EXECUTOR;
      const executor = executorName ? resolveExecutor(executorName) : undefined;
      if (executorName && !executor) {
        io.err(`chikory-bench run: unknown --executor '${executorName}' (gemini | claude-code | codex)`);
        return 1;
      }
      adapter = chikoryAdapter(executor ? { executor } : {});
    } else if (adapterName === "command") {
      const template = values["cmd"];
      if (!template) {
        io.err("chikory-bench run: --adapter command requires --cmd");
        return 1;
      }
      adapter = commandAdapter("command", template);
    } else {
      io.err(`chikory-bench run: unknown adapter '${adapterName}'`);
      return 1;
    }

    const { tasks, invalid } = loadTaskDir(resolve(tasksDir));
    if (Object.keys(invalid).length > 0) {
      for (const [file, issues] of Object.entries(invalid)) {
        io.err(`INVALID ${file}: ${issues.join("; ")}`);
      }
      return 1;
    }
    const filter = values["filter"];
    const selected = filter ? tasks.filter((t) => t.id.includes(filter)) : tasks;
    if (selected.length === 0) {
      io.err("chikory-bench run: no tasks selected");
      return 1;
    }

    const judgeCmd = values["judge-cmd"];
    const judge = judgeCmd ? makeJudgeGrader(commandComplete(judgeCmd)) : undefined;

    const { summary, outDir } = await runSuite({
      suite: values["suite"] ?? tasksDir,
      tasks: selected,
      adapter,
      resultsDir: resolve(values["out"] ?? "benchmarks/results"),
      judge,
      log: io.out,
    });
    io.out(
      `suite ${summary.suite}: ${summary.tasks} tasks, ` +
        `${summary.requirementsSatisfied}/${summary.requirementsTotal} requirements satisfied ` +
        `(I-SR ${(summary.iSr * 100).toFixed(1)}%, D-SR ${(summary.dSr * 100).toFixed(1)}%)`,
    );
    io.out(`artifacts: ${outDir}`);
    return 0;
  }

  io.err(`chikory-bench: unknown command '${command}'`);
  io.err(USAGE);
  return 1;
}
