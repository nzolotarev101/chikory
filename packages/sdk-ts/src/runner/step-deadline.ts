/**
 * WP-255 pure per-step deadline telemetry descriptor. Derives the wall-clock
 * overrun facts that killed-step journals and trace rendering need to make a
 * maxSeconds breach visible even when token/cost counters are zeroed.
 */

/**
 * WP-255: the wall-clock facts of a step that hit (or may hit) its per-step `maxSeconds`
 * cap. `startedAtMs` and `endedAtMs` are epoch-millisecond timestamps (the runner's step
 * start and the moment it stopped/was killed); `maxSeconds` is the per-step wall-clock cap
 * (`StepLimits.maxSeconds`).
 */
export interface StepDeadlineInput {
  startedAtMs: number;
  endedAtMs: number;
  maxSeconds: number;
}

/**
 * WP-255: the derived deadline telemetry the killed-step journal entry + `chikory trace`
 * render so a cap overrun is VISIBLE instead of masked by zeroed token/cost counters.
 */
export interface StepDeadlineStatus {
  elapsedSeconds: number;
  maxSeconds: number;
  overran: boolean;
  remainingSeconds: number;
  overrunRatio: number;
}

/**
 * WP-255: describe whether a step exceeded its per-step wall-clock cap. Pure;
 * does not mutate the input.
 */
export function describeStepDeadline(input: StepDeadlineInput): StepDeadlineStatus {
  const elapsedSeconds = Math.max(0, (input.endedAtMs - input.startedAtMs) / 1000);
  const remainingSeconds = Math.max(0, input.maxSeconds - elapsedSeconds);
  const overrunRatio = input.maxSeconds > 0 ? elapsedSeconds / input.maxSeconds : 0;

  return {
    elapsedSeconds,
    maxSeconds: input.maxSeconds,
    overran: elapsedSeconds > input.maxSeconds,
    remainingSeconds,
    overrunRatio,
  };
}
