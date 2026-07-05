import type { ArtifactRef } from "../types.js";

/**
 * WP-202 / CM-3 policy for deciding whether tool output stays inline or is
 * replaced by a memory pointer reference.
 */
export interface MemoryPointerPolicy {
  maxInlineBytes: number;
}

/**
 * Local opt-in bounds for carried memory refs. Later refs are treated as more
 * recent, so eviction removes the coldest refs from the front of the list.
 */
export interface MemoryEvictionPolicy {
  maxRefs?: number;
  maxBytes?: number;
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
 * Pure carried-memory eviction helper. With no policy, it is a no-op. When
 * bounds are present, it keeps the most-recent suffix that satisfies every
 * active max-count / max-bytes bound and evicts colder refs.
 */
export function decideMemoryEviction(
  refs: ArtifactRef[],
  policy?: MemoryEvictionPolicy,
): { keep: ArtifactRef[]; evicted: ArtifactRef[] } {
  if (policy === undefined || (policy.maxRefs === undefined && policy.maxBytes === undefined)) {
    return { keep: refs.slice(), evicted: [] };
  }

  const maxRefs = policy.maxRefs === undefined ? undefined : Math.max(0, Math.floor(policy.maxRefs));
  const maxBytes = policy.maxBytes === undefined ? undefined : Math.max(0, Math.floor(policy.maxBytes));
  const totalBytes = refs.reduce((sum, ref) => sum + ref.bytes, 0);
  let keepStart = 0;
  let keptBytes = totalBytes;

  while (
    keepStart < refs.length &&
    ((maxRefs !== undefined && refs.length - keepStart > maxRefs) ||
      (maxBytes !== undefined && keptBytes > maxBytes))
  ) {
    keptBytes -= refs[keepStart]?.bytes ?? 0;
    keepStart += 1;
  }

  return {
    keep: refs.slice(keepStart),
    evicted: refs.slice(0, keepStart),
  };
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
 * WP-202 / CM-3 pure parser for executor-originated recall requests. The executor
 * asks for a carried pointer by emitting `[memory recall <id>]`, where `<id>` is
 * either the full `ArtifactRef.id` or the 12-char id prefix shown in context.
 */
export function resolveMemoryRecallRequest(executorText: string, refs: ArtifactRef[]): ArtifactRef | null {
  const match = /(?:^|\n)\[memory recall ([^\s\]]+)\](?=\n|$)/u.exec(executorText);
  if (match === null) {
    return null;
  }

  const [, requestedId] = match;
  return refs.find((ref) => requestedId === ref.id || requestedId === ref.id.slice(0, 12)) ?? null;
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
