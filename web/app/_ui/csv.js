"use client";

function csvEscape(v) {
  const s = String(v ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function downloadCsvFromRows(filename, headers, rows) {
  const h = Array.isArray(headers) ? headers : [];
  const r = Array.isArray(rows) ? rows : [];

  const lines = [];
  lines.push(h.map(csvEscape).join(","));

  for (const row of r) {
    const line = h.map((k) => csvEscape(row?.[k]));
    lines.push(line.join(","));
  }

  const blob = new Blob([lines.join("\n") + "\n"], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "export.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}
