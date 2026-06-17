import type { ArtifactRef } from "../types.js";

/**
 * WP-202 / CM-3 policy for deciding whether tool output stays inline or is
 * replaced by a memory pointer reference.
 */
export interface MemoryPointerPolicy {
  maxInlineBytes: number;
}

/**
 * WP-202 / CM-3 pure decision helper: outputs above the inline byte threshold
 * are pointerized; outputs at or below the threshold remain inline.
 */
export function shouldPointerize(bytes: number, policy: MemoryPointerPolicy): boolean {
  return bytes > policy.maxInlineBytes;
}

/**
 * WP-202 / CM-3 pure renderer for the short context-facing memory pointer
 * reference that replaces externally stored artifact content.
 */
export function formatPointerReference(ref: ArtifactRef): string {
  return `[memory ${ref.kind} ${ref.id.slice(0, 12)}] ${ref.bytes}B — ${ref.summary}`;
}
