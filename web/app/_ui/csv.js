// web/app/_ui/csv.js
"use client";

/**
 * U8 — Standardized CSV Utility
 * - Stable column ordering: caller passes headers array in desired order
 * - Header-safe: coerces to string, escapes quotes/commas/newlines/CR
 * - Quote escaping: RFC4180-style double quotes
 * - UTF-8 BOM optional (default OFF)
 * - Deterministic row ordering: caller must provide rows already sorted
 */

export function csvStringifyValue(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function csvEscape(v) {
  const s = csvStringifyValue(v);
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(headers, rows, { bom = false, eol = "\n" } = {}) {
  const headerLine = headers.map(csvEscape).join(",");
  const lines = [headerLine];

  for (const r of rows) {
    // r can be:
    // - array (positional, assumed aligned with headers)
    // - object (keys from headers)
    if (Array.isArray(r)) {
      lines.push(r.map(csvEscape).join(","));
    } else {
      lines.push(headers.map((h) => csvEscape(r?.[h])).join(","));
    }
  }

  const text = lines.join(eol) + eol;
  if (!bom) return text;

  // UTF-8 BOM
  return "\uFEFF" + text;
}

export function downloadCsv(filename, csvText) {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
