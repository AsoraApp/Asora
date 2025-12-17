"use strict";

/**
 * RFC4180-style CSV escaping:
 * - Comma, quote, CR, LF => quoted field
 * - Quotes are doubled inside quoted fields
 * - UTF-8 output handled by Node strings/buffers
 */
function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  const needsQuotes = /[",\r\n]/.test(s);
  if (!needsQuotes) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

function toCsv(headers, rows) {
  const out = [];
  out.push(headers.map(csvEscape).join(","));
  for (const row of rows) {
    const line = headers.map((h) => csvEscape(row[h]));
    out.push(line.join(","));
  }
  // Always use CRLF for CSV
  return out.join("\r\n") + "\r\n";
}

function sendCsv(res, filename, csvText) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.end(csvText);
}

module.exports = { toCsv, sendCsv };
