export function rowsToCsv({
  columns,
  rows,
  includeBom = false,
}) {
  const escape = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (s.includes('"') || s.includes(",") || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const header = columns.map(escape).join(",");
  const body = rows.map((row) =>
    columns.map((c) => escape(row[c])).join(",")
  );

  const csv = [header, ...body].join("\n");
  if (!includeBom) return csv;

  return "\uFEFF" + csv;
}
