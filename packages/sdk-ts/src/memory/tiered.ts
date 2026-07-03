export const CORE_MEMORY_TIER = "CORE";
export const ARCHIVAL_MEMORY_TIER = "archival";
export const DEFAULT_CORE_MEMORY_MAX_ENTRIES = 128;

export type MemoryTier = typeof CORE_MEMORY_TIER | typeof ARCHIVAL_MEMORY_TIER;

export interface TieredMemoryOptions {
  readonly maxEntries?: number;
}

export type RecallOrder = "best-match" | "most-recent";

export interface RecallQuery<TValue> {
  readonly text: string;
  readonly order?: RecallOrder;
  readonly limit?: number;
  readonly toText?: (record: TieredMemoryRecord<TValue>) => string;
}

export type MemoryProvenance =
  | {
      readonly sourceRef: string;
      readonly origin?: string;
    }
  | {
      readonly sourceRef?: string;
      readonly origin: string;
    };

export interface TieredMemoryWriteOptions {
  readonly provenance: MemoryProvenance;
}

export interface TieredMemoryRecord<TValue> {
  readonly id: string;
  readonly tier: MemoryTier;
  readonly value: TValue;
  readonly provenance: MemoryProvenance;
  readonly sequence: number;
  readonly updatedSequence: number;
}

export class TieredMemory<TValue = unknown> {
  readonly maxEntries: number;

  private readonly records = new Map<string, TieredMemoryRecord<TValue>>();
  private readonly archivalRecords: TieredMemoryRecord<TValue>[] = [];
  private nextSequence = 0;

  constructor(options: TieredMemoryOptions = {}) {
    this.maxEntries = validateMaxEntries(options.maxEntries ?? DEFAULT_CORE_MEMORY_MAX_ENTRIES);
  }

  put(id: string, value: TValue, options: TieredMemoryWriteOptions): TieredMemoryRecord<TValue> {
    const normalizedId = validateId(id);
    const provenance = validateProvenance(options?.provenance);
    const existing = this.records.get(normalizedId);
    const updatedSequence = this.nextSequence;
    const sequence = existing?.sequence ?? updatedSequence;
    this.nextSequence += 1;

    const record: TieredMemoryRecord<TValue> = {
      id: normalizedId,
      tier: CORE_MEMORY_TIER,
      value,
      provenance,
      sequence,
      updatedSequence,
    };

    this.records.set(normalizedId, record);
    this.evictOldestIfNeeded();

    return copyRecord(record);
  }

  get(id: string): TieredMemoryRecord<TValue> | undefined {
    const normalizedId = validateId(id);
    const record = this.records.get(normalizedId);

    return record === undefined ? undefined : copyRecord(record);
  }

  list(): ReadonlyArray<TieredMemoryRecord<TValue>> {
    return [...this.records.values()].map((record) => copyRecord(record));
  }

  getArchival(id: string): ReadonlyArray<TieredMemoryRecord<TValue>> {
    const normalizedId = validateId(id);

    return this.archivalRecords
      .filter((record) => record.id === normalizedId)
      .map((record) => copyRecord(record));
  }

  listArchival(): ReadonlyArray<TieredMemoryRecord<TValue>> {
    return this.archivalRecords.map((record) => copyRecord(record));
  }

  recall(query: RecallQuery<TValue>): ReadonlyArray<TieredMemoryRecord<TValue>> {
    return recall([...this.archivalRecords, ...this.records.values()], query);
  }

  private evictOldestIfNeeded(): void {
    while (this.records.size > this.maxEntries) {
      const oldestId = this.records.keys().next().value;

      if (oldestId === undefined) {
        return;
      }

      const oldestRecord = this.records.get(oldestId);
      this.records.delete(oldestId);

      if (oldestRecord !== undefined) {
        this.archivalRecords.push({ ...oldestRecord, tier: ARCHIVAL_MEMORY_TIER });
      }
    }
  }
}

export function recall<TValue>(
  records: ReadonlyArray<TieredMemoryRecord<TValue>>,
  query: RecallQuery<TValue>,
): ReadonlyArray<TieredMemoryRecord<TValue>> {
  const normalizedQuery = validateRecallText(query.text);
  const order = query.order ?? "best-match";
  const limit = validateRecallLimit(query.limit);
  const tokens = tokenize(normalizedQuery);
  const toText = query.toText ?? defaultRecallText;

  const matches = records
    .map((record) => ({
      record,
      score: scoreRecord(toText(record), normalizedQuery, tokens),
    }))
    .filter((match) => match.score > 0);

  matches.sort((left, right) => {
    if (order === "most-recent") {
      return compareByMostRecent(left.record, right.record);
    }

    return right.score - left.score || compareByMostRecent(left.record, right.record);
  });

  return matches.slice(0, limit).map((match) => copyRecord(match.record));
}

function validateId(id: string): string {
  if (id.trim().length === 0) {
    throw new TypeError("TieredMemory id must be a non-empty string");
  }

  return id;
}

function validateMaxEntries(maxEntries: number): number {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new RangeError("TieredMemory maxEntries must be a positive integer");
  }

  return maxEntries;
}

function validateRecallText(text: string): string {
  const normalized = text.trim().toLocaleLowerCase();
  if (normalized.length === 0) {
    throw new TypeError("TieredMemory recall text must be a non-empty string");
  }

  return normalized;
}

function validateRecallLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) {
    return undefined;
  }

  if (!Number.isInteger(limit) || limit < 0) {
    throw new RangeError("TieredMemory recall limit must be a non-negative integer");
  }

  return limit;
}

function validateProvenance(provenance: MemoryProvenance | undefined): MemoryProvenance {
  const sourceRef = provenance?.sourceRef?.trim();
  const origin = provenance?.origin?.trim();

  if (sourceRef !== undefined && sourceRef.length > 0) {
    if (origin !== undefined && origin.length > 0) {
      return { sourceRef, origin };
    }

    return { sourceRef };
  }

  if (origin !== undefined && origin.length > 0) {
    return { origin };
  }

  throw new TypeError("TieredMemory provenance must include a non-empty sourceRef or origin");
}

function copyRecord<TValue>(record: TieredMemoryRecord<TValue>): TieredMemoryRecord<TValue> {
  return { ...record, provenance: { ...record.provenance } };
}

function tokenize(text: string): ReadonlyArray<string> {
  return text
    .split(/[^a-z0-9]+/iu)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function scoreRecord(recordText: string, normalizedQuery: string, tokens: ReadonlyArray<string>): number {
  const text = recordText.toLocaleLowerCase();
  let score = text.includes(normalizedQuery) ? normalizedQuery.length + 1 : 0;

  for (const token of tokens) {
    score += countOccurrences(text, token);
  }

  return score;
}

function countOccurrences(text: string, token: string): number {
  let count = 0;
  let index = text.indexOf(token);

  while (index !== -1) {
    count += 1;
    index = text.indexOf(token, index + token.length);
  }

  return count;
}

function compareByMostRecent<TValue>(
  left: TieredMemoryRecord<TValue>,
  right: TieredMemoryRecord<TValue>,
): number {
  return right.updatedSequence - left.updatedSequence || right.sequence - left.sequence;
}

function defaultRecallText<TValue>(record: TieredMemoryRecord<TValue>): string {
  return `${record.id} ${record.tier} ${stringifyRecallValue(record.value)}`;
}

function stringifyRecallValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (
    value === undefined ||
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
