"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { asoraGetJson } from "@/lib/asoraFetch";
import CompactBar, { useDensity } from "../_ui/CompactBar.jsx";
import { usePersistedString } from "../_ui/useViewState.jsx";
import { clearLedgerCache, getLedgerEventsCached } from "@/lib/ledgerCache";
import SavedViewsBar from "@/app/ui/SavedViewsBar";

export const runtime = "edge";

const PAGE_SIZE = 500;

// Snapshot focus (local-only)
const FOCUS_STORE_KEY = "asora_view:snapshot:focusItemId";
const SAVED_VIEWS_KEY = "asora_saved_views:snapshot:focusItemId";

function itemHref(itemId) {
  return `/inventory/item?itemId=${encodeURIComponent(String(itemId))}`;
}

function movementsHref(itemId) {
  return `/inventory/movements?itemId=${encodeURIComponent(String(itemId))}`;
}

function csvEscape(v) {
  const s = String(v ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadCsv(filename, header, rows) {
  const lines = [];
  lines.push(header.map(csvEscape).join(","));
  for (const r of rows) lines.push(r.map(csvEscape).join(","));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function InventorySnapshotPage() {
  const { isCompact } = useDensity();
  const s = isCompact ? compact : styles;

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [events, setEvents] = useState([]);
  const [computedAtUtc, setComputedAtUtc] = useState("");

  // Focus itemId (optional, persisted)
  const [focusItemId, setFocusItemId] = usePersistedString(FOCUS_STORE_KEY, "");

  // Paging
  const [page, setPage] = useState(1);

  async function load({ force = false } = {}) {
    setLoading(true);
    setErr("");
    try {
      if (force) clearLedgerCache();

      const r = await getLedgerEventsCached(asoraGetJson);
      const list = Array.isArray(r?.events) ? r.events : [];

      // Deterministic order for compute pass: ts asc, then id
      const sorted = [...list].sort((a, b) => {
        const ta = typeof a?.ts === "string" ? a.ts : "";
        const tb = typeof b?.ts === "string" ? b.ts : "";
        if (ta < tb) return -1;
        if (ta > tb) return 1;
        const ia = typeof a?.id === "string" ? a.id : "";
        const ib = typeof b?.id === "string" ? b.id : "";
        return ia.localeCompare(ib);
      });

      setEvents(sorted);
      setComputedAtUtc(new Date().toISOString());
    } catch (e) {
      setErr(e?.message || "Failed to load ledger events.");
      setEvents([]);
      setComputedAtUtc("");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load({ force: false });
  }, []);

  const focus = (focusItemId || "").trim();

  const derived = useMemo(() => {
    const m = new Map();
    let skippedMissingItemId = 0;
    let skippedMissingQtyDelta = 0;

    for (const e of events) {
      if (!e || typeof e !== "object") continue;

      const itemId = e.itemId;
      if (typeof itemId !== "string" || itemId.trim() === "") {
        skippedMissingItemId += 1;
        continue;
      }

      const q = e.qtyDelta;
      if (typeof q !== "number" || Number.isNaN(q) || !Number.isFinite(q)) {
        skippedMissingQtyDelta += 1;
        continue;
      }

      m.set(itemId, (m.get(itemId) || 0) + q);
    }

    const rows = Array.from(m.entries())
      .map(([itemId, derivedQuantity]) => ({ itemId, derivedQuantity }))
      .sort((a, b) => a.itemId.localeCompare(b.itemId));

    return {
      rows,
      skippedMissingItemId,
      skippedMissingQtyDelta,
    };
  }, [events]);

  const filteredRows = useMemo(() => {
    if (!focus) return derived.rows;
    // Exact match only (deterministic)
    return derived.rows.filter((r) => r.itemId === focus);
  }, [derived.rows, focus]);

  useEffect(() => {
    setPage(1);
  }, [filteredRows.length, focus]);

  const pageCount = useMemo(() => Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE)), [filteredRows.length]);

  const visible = useMemo(() => {
    const end = Math.min(filteredRows.length, page * PAGE_SIZE);
    return filteredRows.slice(0, end);
  }, [filteredRows, page]);

  function exportCsv() {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const safeFocus = focus ? `_focus_${focus.replace(/[^a-zA-Z0-9_-]/g, "_")}` : "";
    const filename = `asora_inventory_snapshot_${ts}${safeFocus}.csv`;

    const header = ["itemId", "derivedQuantity"];
    const rows = filteredRows.map((r) => [r.itemId, r.derivedQuantity]);
    downloadCsv(filename, header, rows);
  }

  function applySaved(value) {
    const v = (value || "").trim();
    setFocusItemId(v);
  }

  return (
    <main style={s.shell}>
      <CompactBar here="Snapshot" />

      <header style={s.header}>
        <div style={s.title}>Inventory Snapshot (Derived)</div>
        <div style={s.sub}>
          Derived on-hand state computed client-side from ledger events. This view stores nothing and performs no writes.
          Ledger fetch is cached per tab.
        </div>
      </header>

      <section style={s.card}>
        <div style={s.controls}>
          <button style={s.button} onClick={() => load({ force: false })} disabled={loading}>
            {loading ? "Refreshing..." : "Recompute (cached)"}
          </button>

          <button style={s.buttonSecondary} onClick={() => load({ force: true })} disabled={loading}>
            Recompute (force)
          </button>

          <button style={s.buttonSecondary} onClick={exportCsv} disabled={loading || filteredRows.length === 0}>
            Export CSV
          </button>

          <label style={s.label}>
            Focus itemId (optional)
            <input
              style={s.input}
              value={focusItemId}
              onChange={(e) => setFocusItemId(e.target.value)}
              placeholder="exact itemId (filters table)"
            />
          </label>

          <div style={s.meta}>
            Items: <span style={s.mono}>{derived.rows.length}</span> | Focus rows:{" "}
            <span style={s.mono}>{filteredRows.length}</span> | Events: <span style={s.mono}>{events.length}</span> |
            Computed at (UTC): <span style={s.mono}>{computedAtUtc || "—"}</span>
            {focus ? (
              <>
                {" "}
                | Focus: <span style={s.mono}>{focus}</span>
              </>
            ) : null}
          </div>

          <div style={s.metaSmall}>
            Skipped events — missing itemId: <span style={s.mono}>{derived.skippedMissingItemId}</span>, missing numeric
            qtyDelta: <span style={s.mono}>{derived.skippedMissingQtyDelta}</span>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <SavedViewsBar
            storageKey={SAVED_VIEWS_KEY}
            valueLabel="focus itemId"
            currentValue={focus}
            onApply={applySaved}
          />
        </div>

        {err ? <div style={s.err}>Error: {err}</div> : null}
        {filteredRows.length === 0 && !loading ? (
          <div style={s.empty}>{focus ? "No derived rows for this focus itemId." : "No derived inventory rows to display."}</div>
        ) : null}

        {filteredRows.length > 0 ? (
          <div style={s.pagerRow}>
            <button style={s.pagerBtn} onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              Prev
            </button>
            <div style={s.pagerText}>
              Page <span style={s.mono}>{page}</span> / <span style={s.mono}>{pageCount}</span> (page size{" "}
              <span style={s.mono}>{PAGE_SIZE}</span>, showing <span style={s.mono}>{visible.length}</span>)
            </div>
            <button
              style={s.pagerBtn}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={page >= pageCount}
            >
              Next
            </button>
            <button
              style={s.pagerBtnSecondary}
              onClick={() => setPage(pageCount)}
              disabled={page >= pageCount}
              title="Jump to last page"
            >
              End
            </button>
          </div>
        ) : null}

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
              {visible.map((r) => (
                <tr key={r.itemId}>
                  <td style={s.td}>
                    <span style={s.mono}>{r.itemId}</span>
                  </td>
                  <td style={s.tdRight}>
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
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section style={s.card}>
        <div style={s.noteTitle}>Notes</div>
        <ul style={s.ul}>
          <li>Negative totals are allowed and shown as-is (no clamping).</li>
          <li>Derivation ignores events missing itemId or numeric qtyDelta.</li>
          <li>“Force” recompute clears the in-tab cache and refetches ledger events.</li>
          <li>Focus itemId filters the derived rows table only; derivation rules are unchanged.</li>
          <li>Saved Views are local-only (localStorage) and do not affect backend behavior.</li>
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
  controls: { display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" },

  button: { padding: "8px 12px", borderRadius: 10, border: "1px solid #111", background: "#111", color: "#fff", cursor: "pointer", fontSize: 13, height: 34 },
  buttonSecondary: { padding: "8px 12px", borderRadius: 10, border: "1px solid #bbb", background: "#fff", color: "#111", cursor: "pointer", fontSize: 13, height: 34 },

  label: { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "#222" },
  input: { width: 280, padding: "8px 10px", borderRadius: 10, border: "1px solid #ccc", outline: "none", fontSize: 13 },

  meta: { fontSize: 13, color: "#444" },
  metaSmall: { fontSize: 13, color: "#666" },

  pagerRow: { marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  pagerBtn: { padding: "6px 10px", borderRadius: 10, border: "1px solid #bbb", background: "#fff", cursor: "pointer", fontSize: 13 },
  pagerBtnSecondary: { padding: "6px 10px", borderRadius: 10, border: "1px solid #bbb", background: "#f7f7f7", cursor: "pointer", fontSize: 13 },
  pagerText: { fontSize: 13, color: "#333" },

  err: { marginTop: 10, color: "#b00020", fontSize: 13 },
  empty: { marginTop: 12, color: "#666", fontSize: 13 },

  tableWrap: { width: "100%", overflowX: "auto", marginTop: 12 },
  table: { borderCollapse: "collapse", width: "100%" },
  th: { textAlign: "left", fontSize: 12, color: "#444", borderBottom: "1px solid #eee", padding: "10px 8px" },
  thRight: { textAlign: "right", fontSize: 12, color: "#444", borderBottom: "1px solid #eee", padding: "10px 8px" },
  td: { padding: "10px 8px", borderBottom: "1px solid #f0f0f0", fontSize: 13, verticalAlign: "top" },
  tdRight: { padding: "10px 8px", borderBottom: "1px solid #f0f0f0", fontSize: 13, textAlign: "right", verticalAlign: "top" },

  linkRow: { display: "flex", gap: 10, flexWrap: "wrap" },
  link: { color: "#0b57d0", textDecoration: "none", fontSize: 13 },
  linkSecondary: { color: "#444", textDecoration: "none", fontSize: 13 },

  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },

  noteTitle: { fontSize: 14, fontWeight: 700, marginBottom: 8 },
  ul: { margin: 0, paddingLeft: 18, color: "#333", fontSize: 13, lineHeight: 1.5 },
};

const compact = {
  ...styles,
  shell: { ...styles.shell, padding: 14 },
  title: { fontSize: 18, fontWeight: 750 },
  sub: { ...styles.sub, fontSize: 12 },
  card: { ...styles.card, padding: 12, marginBottom: 12 },

  button: { ...styles.button, padding: "6px 10px", fontSize: 12, height: 30 },
  buttonSecondary: { ...styles.buttonSecondary, padding: "6px 10px", fontSize: 12, height: 30 },

  label: { ...styles.label, fontSize: 12 },
  input: { ...styles.input, padding: "6px 8px", fontSize: 12, width: 240 },

  meta: { ...styles.meta, fontSize: 12 },
  metaSmall: { ...styles.metaSmall, fontSize: 12 },

  pagerBtn: { ...styles.pagerBtn, fontSize: 12 },
  pagerBtnSecondary: { ...styles.pagerBtnSecondary, fontSize: 12 },
  pagerText: { ...styles.pagerText, fontSize: 12 },

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
