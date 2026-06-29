import type { ArtifactRef } from "../types.js";

/**
 * WP-202 / CM-3 policy for deciding whether tool output stays inline or is
 * replaced by a memory pointer reference.
 */
export interface MemoryPointerPolicy {
  maxInlineBytes: number;
}

/**
 * WP-202: the parsed fields of a context-facing memory pointer reference, the inverse of
 * `formatPointerReference`. `idPrefix` is the 12-char `ArtifactRef.id.slice(0, 12)` the
 * renderer emits, not the full content hash.
 */
export interface ParsedPointerReference {
  kind: string;
  idPrefix: string;
  bytes: number;
  summary: string;
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

/**
 * WP-202 / CM-3 pure parser for the context-facing memory pointer reference
 * emitted by `formatPointerReference`.
 */
export function parsePointerReference(line: string): ParsedPointerReference | null {
  const match = /^\[memory ([^\s]+) ([^\s]+)\] ([0-9]+)B — (.*)$/u.exec(line);
  if (match === null) {
    return null;
  }

  const [, kind, idPrefix, bytes, summary] = match;
  return {
    kind,
    idPrefix,
    bytes: Number.parseInt(bytes, 10),
    summary,
  };
}

/**
 * WP-202 / CM-3 pure recall helper that dereferences a parsed memory pointer
 * through an injected excerpt source.
 */
export async function recallPointerExcerpt(
  line: string,
  excerptFn: (idPrefix: string, bytes: number) => Promise<string>,
): Promise<string | null> {
  const parsed = parsePointerReference(line);
  if (parsed === null) {
    return null;
  }

  return await excerptFn(parsed.idPrefix, parsed.bytes);
}
