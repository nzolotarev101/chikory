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
    // `detached: true` makes the child its own process-group leader so the deadline
    // can signal the WHOLE group — a bare `child.kill()` reaches only the direct
    // child, and grandchildren (e.g. a `codex` sandbox subprocess) keep the stdout
    // pipe open, so `close` never fires and the step outlives `maxSeconds` ~2.45×
    // (WP-255 / F-59: dogfood-064 ran 24m32s on a 600s cap).
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env as NodeJS.ProcessEnv | undefined,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;

    // Signal the child's whole process group (negative pid), falling back to the
    // direct child if the pid is unavailable. ESRCH (group already gone) is benign.
    const killGroup = (signal: NodeJS.Signals): void => {
      try {
        if (child.pid !== undefined) {
          process.kill(-child.pid, signal);
        } else {
          child.kill(signal);
        }
      } catch {
        // group/process already exited — nothing to reap.
      }
    };

    const deadline = setTimeout(() => {
      timedOut = true;
      killGroup("SIGTERM");
      killTimer = setTimeout(
        () => killGroup("SIGKILL"),
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
