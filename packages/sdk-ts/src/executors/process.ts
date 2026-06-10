/**
 * Bounded subprocess execution (WP-111) — the enforcement half of the step
 * contract: a step may never outlive `limits.maxSeconds`. Overrun ⇒ SIGTERM,
 * then SIGKILL after a grace window; the caller turns that into
 * FAILED(retriable: true) per executors.md.
 */
import { spawn } from "node:child_process";

export interface BoundedProcessOptions {
  cwd: string;
  env?: Record<string, string | undefined>;
  /** Wall-clock cap for the whole invocation. */
  maxSeconds: number;
  /** SIGTERM → SIGKILL grace. */
  killGraceMs?: number;
}

export interface BoundedProcessResult {
  /** null when killed by signal. */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export const DEFAULT_KILL_GRACE_MS = 5_000;

export function runBounded(
  command: string,
  args: string[],
  opts: BoundedProcessOptions,
): Promise<BoundedProcessResult> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    // CLI agents read prompts from argv; stdin is closed so none can block on it.
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env as NodeJS.ProcessEnv | undefined,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;

    const deadline = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(
        () => child.kill("SIGKILL"),
        opts.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
      );
    }, opts.maxSeconds * 1000);

    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));

    child.on("error", (err) => {
      clearTimeout(deadline);
      if (killTimer) clearTimeout(killTimer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(deadline);
      if (killTimer) clearTimeout(killTimer);
      resolve({
        exitCode: code,
        stdout,
        stderr,
        timedOut,
        durationMs: Date.now() - start,
      });
    });
  });
}
