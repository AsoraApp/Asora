function escapeCsvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Deterministic CSV generation.
 * - Stable column ordering (caller provides `columns`)
 * - Deterministic row ordering (caller must provide sorted rows)
 * - Header-safe, quote-escaped output
 * - BOM optional (off by default)
 */
export function rowsToCsv({ columns, rows, includeBom = false }) {
  const header = columns.map(escapeCsvCell).join(",");
  const lines = rows.map((row) => columns.map((c) => escapeCsvCell(row?.[c])).join(","));
  const csv = [header, ...lines].join("\n") + "\n";
  return includeBom ? "\uFEFF" + csv : csv;
}
