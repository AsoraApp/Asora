"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { asoraGetJson } from "@/lib/asoraFetch";
import CompactBar, { useDensity } from "../_ui/CompactBar.jsx";

export const runtime = "edge";

function nowUtcIso() {
  return new Date().toISOString();
}

function toCsv(rows) {
  const header = ["itemId", "derivedQuantity"];
  const lines = [header.join(",")];
  for (const r of rows) {
    const item = String(r.itemId ?? "");
    const qty = String(r.derivedQuantity ?? "");
    lines.push([item, qty].map((v) => `"${v.replaceAll('"', '""')}"`).join(","));
  }
  return lines.join("\n");
}

function downloadText(filename, text, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2500);
}

function itemHref(itemId) {
  return `/inventory/item?itemId=${encodeURIComponent(String(itemId))}`;
}

function movementsHref(itemId) {
  return `/inventory/movements?itemId=${encodeURIComponent(String(itemId))}`;
}

export default function InventorySnapshotPage() {
  const { isCompact } = useDensity();

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [snapshotUtc, setSnapshotUtc] = useState("");
  const [rows, setRows] = useState([]);
  const [skipped, setSkipped] = useState({ missingItemId: 0, badQtyDelta: 0, nonObject: 0 });

  const derived = useMemo(() => rows, [rows]);

  const compute = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await asoraGetJson("/v1/ledger/events", {});
      const events = Array.isArray(r?.events) ? r.events : [];

      const totals = new Map();
      let missingItemId = 0;
      let badQtyDelta = 0;
      let nonObject = 0;

      for (const e of events) {
        if (!e || typeof e !== "object") {
          nonObject += 1;
          continue;
        }
        const itemId = e.itemId;
        if (typeof itemId !== "string" || itemId.trim() === "") {
          missingItemId += 1;
          continue;
        }
        const q = e.qtyDelta;
        if (typeof q !== "number" || Number.isNaN(q) || !Number.isFinite(q)) {
          badQtyDelta += 1;
          continue;
        }
        totals.set(itemId, (totals.get(itemId) || 0) + q);
      }

      const out = Array.from(totals.entries())
        .map(([itemId, derivedQuantity]) => ({ itemId, derivedQuantity }))
        .sort((a, b) => a.itemId.localeCompare(b.itemId));

      setRows(out);
      setSkipped({ missingItemId, badQtyDelta, nonObject });
      setSnapshotUtc(nowUtcIso());
    } catch (e) {
      setErr(e?.message || "Failed to load ledger events.");
      setRows([]);
      setSkipped({ missingItemId: 0, badQtyDelta: 0, nonObject: 0 });
      setSnapshotUtc(nowUtcIso());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    compute();
  }, [compute]);

  function exportCsv() {
    const csv = toCsv(derived);
    const stamp = (snapshotUtc || nowUtcIso()).replaceAll(":", "-");
    downloadText(`inventory_snapshot_${stamp}.csv`, csv, "text/csv;charset=utf-8");
  }

  const s = isCompact ? compact : styles;

  return (
    <main style={s.shell}>
      <CompactBar here="Snapshot" />

      <header style={s.header}>
        <div style={s.title}>Inventory Snapshot</div>
        <div style={s.sub}>Derived on-hand state from ledger events (read-only; not stored). Deterministic ordering by itemId.</div>
      </header>

      <section style={s.card}>
        <div style={s.actionsRow}>
          <button style={s.button} onClick={compute} disabled={loading}>
            {loading ? "Recomputing..." : "Recompute"}
          </button>
          <button style={s.buttonSecondary} onClick={exportCsv} disabled={loading || derived.length === 0}>
            Export CSV
          </button>
          <div style={s.meta}>
            <div>
              Snapshot UTC: <span style={s.mono}>{snapshotUtc || "—"}</span>
            </div>
            <div style={s.muted}>
              Skipped events — missing itemId: <span style={s.mono}>{skipped.missingItemId}</span>, bad qtyDelta:{" "}
              <span style={s.mono}>{skipped.badQtyDelta}</span>, non-object: <span style={s.mono}>{skipped.nonObject}</span>
            </div>
          </div>
        </div>

        {err ? <div style={s.err}>Error: {err}</div> : null}

        {derived.length === 0 && !loading ? (
          <div style={s.empty}>No derived quantities to display.</div>
        ) : (
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>itemId</th>
                  <th style={s.thRight}>derivedQuantity</th>
                  <th style={s.th}>Links</th>
                </tr>
              </thead>
              <tbody>
                {derived.map((r) => {
                  const neg = typeof r.derivedQuantity === "number" && r.derivedQuantity < 0;
                  return (
                    <tr key={r.itemId}>
                      <td style={s.td}>
                        <span style={s.mono}>{r.itemId}</span>
                      </td>
                      <td style={{ ...s.tdRight, ...(neg ? s.neg : null) }}>
                        <span style={s.mono}>{r.derivedQuantity}</span>
                      </td>
                      <td style={s.td}>
                        <div style={s.linkRow}>
                          <Link style={s.link} href={itemHref(r.itemId)}>
                            Drill-down
                          </Link>
                          <Link style={s.linkSecondary} href={movementsHref(r.itemId)}>
                            Movements
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={s.card}>
        <div style={s.noteTitle}>Notes</div>
        <ul style={s.ul}>
          <li>Negative totals are allowed (no clamping).</li>
          <li>Only events with string itemId and numeric qtyDelta contribute to totals.</li>
          <li>Links pass itemId via query string for cross-view coherence.</li>
        </ul>
      </section>
    </main>
  );
}

const styles = {
  shell: { minHeight: "100vh", padding: 24, fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto" },
  header: { marginBottom: 16 },
  title: { fontSize: 22, fontWeight: 700 },
  sub: { marginTop: 6, color: "#555", fontSize: 13, lineHeight: 1.35 },

  card: { border: "1px solid #e5e5e5", borderRadius: 12, padding: 16, marginBottom: 16, background: "#fff" },
  actionsRow: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
  button: { padding: "8px 12px", borderRadius: 10, border: "1px solid #111", background: "#111", color: "#fff", cursor: "pointer", fontSize: 13 },
  buttonSecondary: { padding: "8px 12px", borderRadius: 10, border: "1px solid #bbb", background: "#fff", color: "#111", cursor: "pointer", fontSize: 13 },
  meta: { display: "flex", flexDirection: "column", gap: 4, marginLeft: 8, fontSize: 13 },
  muted: { color: "#666" },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },
  err: { marginTop: 10, color: "#b00020", fontSize: 13 },
  empty: { marginTop: 12, color: "#666", fontSize: 13 },

  tableWrap: { width: "100%", overflowX: "auto", marginTop: 12 },
  table: { borderCollapse: "collapse", width: "100%" },
  th: { textAlign: "left", fontSize: 12, color: "#444", borderBottom: "1px solid #eee", padding: "10px 8px" },
  thRight: { textAlign: "right", fontSize: 12, color: "#444", borderBottom: "1px solid #eee", padding: "10px 8px" },
  td: { padding: "10px 8px", borderBottom: "1px solid #f0f0f0", fontSize: 13, verticalAlign: "top" },
  tdRight: { padding: "10px 8px", borderBottom: "1px solid #f0f0f0", fontSize: 13, textAlign: "right", verticalAlign: "top" },
  neg: { color: "#b00020", fontWeight: 700 },

  linkRow: { display: "flex", gap: 10, flexWrap: "wrap" },
  link: { color: "#0b57d0", textDecoration: "none", fontSize: 13 },
  linkSecondary: { color: "#444", textDecoration: "none", fontSize: 13 },

  noteTitle: { fontSize: 14, fontWeight: 700, marginBottom: 8 },
  ul: { margin: 0, paddingLeft: 18, color: "#333", fontSize: 13, lineHeight: 1.5 },
};

const compact = {
  ...styles,
  shell: { ...styles.shell, padding: 14 },
  header: { marginBottom: 10 },
  title: { fontSize: 18, fontWeight: 750 },
  sub: { ...styles.sub, fontSize: 12 },

  card: { ...styles.card, padding: 12, marginBottom: 12 },
  button: { ...styles.button, padding: "6px 10px", fontSize: 12 },
  buttonSecondary: { ...styles.buttonSecondary, padding: "6px 10px", fontSize: 12 },

  meta: { ...styles.meta, fontSize: 12 },
  err: { ...styles.err, fontSize: 12 },
  empty: { ...styles.empty, fontSize: 12 },

  th: { ...styles.th, padding: "8px 6px", fontSize: 11 },
  thRight: { ...styles.thRight, padding: "8px 6px", fontSize: 11 },
  td: { ...styles.td, padding: "8px 6px", fontSize: 12 },
  tdRight: { ...styles.tdRight, padding: "8px 6px", fontSize: 12 },

  link: { ...styles.link, fontSize: 12 },
  linkSecondary: { ...styles.linkSecondary, fontSize: 12 },

  noteTitle: { ...styles.noteTitle, fontSize: 13 },
  ul: { ...styles.ul, fontSize: 12 },
};
