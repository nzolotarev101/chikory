/**
 * Minimal local-FS artifact store (P1 slice of artifacts.md) — enough for
 * diffs/transcripts/test logs. Content-addressed (sha256) so refs are stable
 * across resume/branch (AR-1, CM-3). WP-202 (P2) completes excerpting and
 * the Memory Pointer workflow; P4 adds an S3-compatible backend behind the
 * same frozen `ArtifactStore` interface.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ArtifactKind, ArtifactRef, ArtifactStore } from "../types.js";

/** CONTRACTS.md §5: summary is the only part that enters context by default. */
export const MAX_SUMMARY_CHARS = 200;

function toRef(
  content: Uint8Array,
  meta: { kind: ArtifactKind; summary: string; repo?: string },
): ArtifactRef {
  return {
    id: createHash("sha256").update(content).digest("hex"),
    kind: meta.kind,
    bytes: content.byteLength,
    summary: meta.summary.slice(0, MAX_SUMMARY_CHARS),
    ...(meta.repo !== undefined ? { repo: meta.repo } : {}),
  };
}

function toBytes(content: Uint8Array | string): Uint8Array {
  return typeof content === "string" ? new TextEncoder().encode(content) : content;
}

/**
 * P1 excerpt semantics: artifacts we store in P1 (diffs, transcripts, logs)
 * are line-oriented text. `range` selects 1-based inclusive line numbers;
 * `query` returns matching lines prefixed with their line number. WP-202
 * extends this for binary/structured kinds.
 */
function excerptText(text: string, sel: { range?: [number, number]; query?: string }): string {
  const lines = text.split("\n");
  if (sel.range) {
    const [start, end] = sel.range;
    return lines.slice(Math.max(0, start - 1), end).join("\n");
  }
  if (sel.query !== undefined) {
    const q = sel.query;
    return lines
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => line.includes(q))
      .map(({ line, n }) => `${n}: ${line}`)
      .join("\n");
  }
  return text;
}

/** Store artifacts as content-addressed files under `rootDir`. */
export function createLocalArtifactStore(rootDir: string): ArtifactStore {
  return {
    async put(content, meta) {
      const bytes = toBytes(content);
      const ref = toRef(bytes, meta);
      await mkdir(rootDir, { recursive: true });
      // Content-addressed: same id ⇒ same bytes, overwrite is a no-op.
      await writeFile(join(rootDir, ref.id), bytes);
      return ref;
    },
    async get(ref) {
      return new Uint8Array(await readFile(join(rootDir, ref.id)));
    },
    async excerpt(ref, sel) {
      const bytes = await readFile(join(rootDir, ref.id));
      return excerptText(bytes.toString("utf8"), sel);
    },
  };
}

/** In-memory store for tests and ephemeral runs. */
export function createMemoryArtifactStore(): ArtifactStore {
  const blobs = new Map<string, Uint8Array>();
  return {
    put(content, meta) {
      const bytes = toBytes(content);
      const ref = toRef(bytes, meta);
      blobs.set(ref.id, bytes);
      return Promise.resolve(ref);
    },
    get(ref) {
      const bytes = blobs.get(ref.id);
      if (!bytes) return Promise.reject(new Error(`artifact not found: ${ref.id}`));
      return Promise.resolve(bytes);
    },
    excerpt(ref, sel) {
      const bytes = blobs.get(ref.id);
      if (!bytes) return Promise.reject(new Error(`artifact not found: ${ref.id}`));
      return Promise.resolve(excerptText(new TextDecoder().decode(bytes), sel));
    },
  };
}
