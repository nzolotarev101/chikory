export type WpStatus = "red" | "yellow" | "green";

const STATUS_ICONS: Record<string, WpStatus> = {
  "🔴": "red",
  "🟡": "yellow",
  "🟢": "green",
};

function splitMarkdownRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) {
    return null;
  }

  const withoutOuterPipes = trimmed.replace(/^\|/, "").replace(/\|$/, "");

  return withoutOuterPipes
    .split("|")
    .map((cell) => cell.trim());
}

function isSeparatorRow(cells: readonly string[]): boolean {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function normalizeHeader(cell: string): string {
  return cell.replace(/\*\*/g, "").trim().toLowerCase();
}

function normalizeIdCell(cell: string): string {
  const linkMatch = cell.match(/^\[([^\]]+)\]\([^)]+\)$/);
  const withoutLink = linkMatch?.[1] ?? cell;

  return withoutLink.replace(/[`*_]/g, "").trim();
}

function statusFromCell(cell: string): WpStatus | null {
  for (const [icon, status] of Object.entries(STATUS_ICONS)) {
    if (cell.includes(icon)) {
      return status;
    }
  }

  return null;
}

// F-81: production plan.md §6 has NO `status` column — its columns are
// `| WP | Title | Tag | Notes |`, where `Tag` encodes COMPLEXITY (🔴 architect /
// 🟡 builder / 🟢 mechanical), NOT completion, and completion lives in the Notes
// prose. Reading the Tag emoji as status would invert the gate (every open 🟢 WP
// would read done). Instead we read completion from the CURRENT-STATUS segment of
// the Notes cell — the prefix before any preserved historical tail (a row keeps
// its old build record after an italic separator like `_Below: original build
// record._` / `_History …` / `_(…`, which may still carry stale `Queued`/`Next
// up` prose). Detection is deliberately conservative and FAIL-OPEN: a WP is
// "done" (→ `green` → stale) only on an unambiguous done-marker with no
// open-qualifier IN THAT CURRENT SEGMENT; everything else in the table reads
// `red` (fresh), so a fragile heuristic can never block a legitimate run.
const HISTORICAL_TAIL_RE = /_Below:|_History|_\(/;
const NOTES_SEGMENT_CHARS = 300;
// Explicit completion words only — a bare ✅ is too broad (it also prefixes gate
// verdicts like "✅ PROCEED" and rubric ticks). Require the bolded done phrase.
const DONE_MARKERS: readonly string[] = ["**Done**", "LANDED", "**DONE", "LIVE-CONFIRMED"];
// Strong, unambiguous open signals only — avoid broad words (e.g. "pending"
// matches "commit pending review" inside a done row's prose).
const OPEN_QUALIFIERS: readonly string[] = [
  "REOPENED",
  "Queued",
  "Next up",
  "**Slice",
  "in-progress",
  "UNBLOCKED",
];

function statusFromNotes(cell: string): WpStatus {
  // Drop the preserved historical build record, then bound the current segment.
  const current = cell.split(HISTORICAL_TAIL_RE)[0]!.slice(0, NOTES_SEGMENT_CHARS);
  const done = DONE_MARKERS.some((marker) => current.includes(marker));
  const open = OPEN_QUALIFIERS.some((marker) => current.includes(marker));
  return done && !open ? "green" : "red";
}

export function parseWpStatus(markdown: string, wpId: string): WpStatus | null {
  const lines = markdown.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const header = splitMarkdownRow(lines[index] ?? "");
    const separator = splitMarkdownRow(lines[index + 1] ?? "");

    if (header === null || separator === null || !isSeparatorRow(separator)) {
      continue;
    }

    const statusColumn = header.findIndex((cell) => normalizeHeader(cell) === "status");
    // F-81: fall back to the plan.md §6 `Tag`/`Notes` schema when no explicit
    // `status` column exists — read completion from Notes, never the Tag emoji.
    const notesColumn = header.findIndex((cell) => normalizeHeader(cell) === "notes");
    const hasTagColumn = header.some((cell) => normalizeHeader(cell) === "tag");
    const useNotes = statusColumn === -1 && notesColumn !== -1 && hasTagColumn;

    if (statusColumn === -1 && !useNotes) {
      continue;
    }

    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const row = splitMarkdownRow(lines[rowIndex] ?? "");
      if (row === null) {
        break;
      }

      if (!row.some((cell) => normalizeIdCell(cell) === wpId)) {
        continue;
      }

      return useNotes
        ? statusFromNotes(row[notesColumn] ?? "")
        : statusFromCell(row[statusColumn] ?? "");
    }
  }

  return null;
}
