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

export function parseWpStatus(markdown: string, wpId: string): WpStatus | null {
  const lines = markdown.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const header = splitMarkdownRow(lines[index] ?? "");
    const separator = splitMarkdownRow(lines[index + 1] ?? "");

    if (header === null || separator === null || !isSeparatorRow(separator)) {
      continue;
    }

    const statusColumn = header.findIndex((cell) => normalizeHeader(cell) === "status");
    if (statusColumn === -1) {
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

      return statusFromCell(row[statusColumn] ?? "");
    }
  }

  return null;
}
