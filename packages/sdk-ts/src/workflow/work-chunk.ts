/**
 * Pure per-step work-chunk decision. This keeps chunk selection deterministic
 * and separate from Temporal replay, executor adapters, clocks, and I/O.
 */
import type { BoundedWorkUnitPolicy, WorkChunk } from "../types.js";

export interface WorkChunkState {
  /** Work chunks already handed to executor steps and sealed as checkpoints. */
  consumedChunks: number;
}

export type WorkChunkDecision =
  | {
      action: "use_chunk";
      chunk: WorkChunk;
    }
  | {
      action: "all_chunks_consumed";
      chunk?: undefined;
    }
  | {
      action: "no_chunks";
      chunk?: undefined;
    };

export function decideWorkChunk(
  state: WorkChunkState,
  policy?: BoundedWorkUnitPolicy,
): WorkChunkDecision {
  const chunks = policy?.workChunks;
  if (chunks === undefined || chunks.length === 0) {
    return { action: "no_chunks" };
  }

  const consumedChunks = Number.isFinite(state.consumedChunks)
    ? Math.max(0, Math.trunc(state.consumedChunks))
    : 0;
  const next = chunks[consumedChunks];
  if (next === undefined) {
    return { action: "all_chunks_consumed" };
  }

  return { action: "use_chunk", chunk: next };
}
