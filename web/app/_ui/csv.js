// web/app/_ui/csv.js

/**
 * U8 — Standardized CSV Utility (shared across U6/U7/U8)
 *
 * Guarantees:
 * - Stable column ordering (caller provides columns array)
 * - Header-safe output
 * - RFC4180-ish quoting + quote escaping
 * - Deterministic row ordering (caller must provide already-sorted rows)
 * - UTF-8 BOM optional (OFF by default)
 *
 * This file contains:
 *  - csvEscape(value)
 *  - toCsv(columns, rows, { bom })
 *  - downloadCsv(filename, csvText)
 *  - downloadCsvFromRows(filename, columns, rows, { bom })
 */

function asString(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function csvEscape(value) {
  const s = asString(value);

  // Normalize newlines to LF for deterministic output across platforms
  const normalized = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Quote if necessary: comma, quote, newline
  if (normalized.includes('"') || normalized.includes(",") || normalized.includes("\n")) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

export function toCsv(columns, rows, opts) {
  const bom = Boolean(opts?.bom);

  const cols = Array.isArray(columns) ? columns.map((c) => String(c)) : [];
  const safeCols = cols.map((c) => csvEscape(c)).join(",");

  const lines = [safeCols];

  const list = Array.isArray(rows) ? rows : [];
  for (const r of list) {
    // rows may be arrays (positional) or objects (keyed by column)
    if (Array.isArray(r)) {
      const line = cols.map((_, i) => csvEscape(r[i])).join(",");
      lines.push(line);
    } else {
      const line = cols.map((c) => csvEscape(r?.[c])).join(",");
      lines.push(line);
    }
  }

  const body = lines.join("\n") + "\n";
  if (!bom) return body;

  // UTF-8 BOM (optional, off by default)
  return "\uFEFF" + body;
}

export function downloadCsv(filename, csvText) {
  const text = String(csvText || "");
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = String(filename || "export.csv");
  document.body.appendChild(a);
  a.click();
  a.remove();
  // deterministic enough; no timers required for correctness
  URL.revokeObjectURL(url);
}

export function downloadCsvFromRows(filename, columns, rows, opts) {
  const csv = toCsv(columns, rows, opts);
  downloadCsv(filename, csv);
}
