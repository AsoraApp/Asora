"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { asoraGetJson } from "@/lib/asoraFetch";
import CompactBar, { useDensity } from "../_ui/CompactBar.jsx";
import { usePersistedString } from "../_ui/useViewState.jsx";
import { clearLedgerCache, getLedgerEventsCached } from "@/lib/ledgerCache";
import SavedViewsBar from "@/app/ui/SavedViewsBar";

export const runtime = "edge";

const STORE_KEY = "asora_view:item:itemId";
const SAVED_VIEWS_KEY = "asora_saved_views:item:itemId";

function movementsHref(itemId) {
  return `/inventory/movements?itemId=${encodeURIComponent(String(itemId))}`;
}

function itemHref(itemId) {
  return `/inventory/item?itemId=${encodeURIComponent(String(itemId))}`;
}

function csvEscape(v) {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadCsv(filename, rows) {
  const content = rows.map((r) => r.join(",")).join("\n") + "\n";
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function InventoryItemDrillDownPage() {
  const { isCompact } = useDensity();

  const sp = useSearchParams();
  const qpItemId = sp?.get("itemId") || "";

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [persistedItemId, setPersistedItemId] = usePersistedString(STORE_KEY, "");

  // URL param wins; otherwise persisted.
  const [itemId, setItemId] = useState(qpItemId || persistedItemId);

  const [events, setEvents] = useState([]);

  // If URL itemId changes, adopt it and persist it.
  useEffect(() => {
    if (qpItemId && qpItemId !== itemId) {
      setItemId(qpItemId);
      setPersistedItemId(qpItemId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qpItemId]);

  async function load({ force = false } = {}) {
    setLoading(true);
    setErr("");
    try {
      if (force) clearLedgerCache();

      const r = await getLedgerEventsCached(asoraGetJson);
      const list = Array.isArray(r?.events) ? r.events : [];

      // Deterministic sort: ts asc, then id tie-break
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
    } catch (e) {
      setErr(e?.message || "Failed to load ledger events.");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load({ force: false });
  }, []);

  const focus = (itemId || "").trim();

  const filtered = useMemo(() => {
    if (!focus) return [];
    return events.filter((e) => typeof e?.itemId === "string" && e.itemId === focus);
  }, [events, focus]);

  const derivedTotalQtyDelta = useMemo(() => {
    let sum = 0;
    for (const e of filtered) {
      const q = e?.qtyDelta;
      if (typeof q === "number" && Number.isFinite(q)) sum += q;
    }
    return sum;
  }, [filtered]);

  function applySaved(value) {
    const v = (value || "").trim();
    setItemId(v);
    setPersistedItemId(v);
  }

  function exportCsv() {
    const v = focus;
    const header = ["itemId", "derivedTotalQtyDelta", "ts", "qtyDelta", "eventType", "eventId"].map(csvEscape);

    // Header-only export if no focus or no rows (operator-safe)
    if (!v || filtered.length === 0) {
      const name = `asora_item_${(v || "empty").replace(/[^a-zA-Z0-9_-]/g, "_")}.csv`;
      downloadCsv(name, [header]);
      return;
    }

    const rows = filtered.map((e) => {
      const ts = typeof e?.ts === "string" ? e.ts : "";
      const qtyDelta = typeof e?.qtyDelta === "number" ? e.qtyDelta : "";
      const eventType = typeof e?.eventType === "string" ? e.eventType : "";
      const eventId = typeof e?.id === "string" ? e.id : "";

      return [
        csvEscape(v),
        csvEscape(String(derivedTotalQtyDelta)),
        csvEscape(ts),
        csvEscape(String(qtyDelta)),
        csvEscape(eventType),
        csvEscape(eventId),
      ];
    });

    const name = `asora_item_${v.replace(/[^a-zA-Z0-9_-]/g, "_")}.csv`;
    downloadCsv(name, [header, ...rows]);
  }

  const s = isCompact ? compact : styles;

  return (
    <main style={s.shell}>
      <CompactBar here="Item Drill-Down" />

      <header style={s.header}>
        <div style={s.title}>Item Drill-Down</div>
        <div style={s.sub}>
          Ledger-derived item timeline and derived total (read-only). ItemId is persisted locally. URL param overrides
          saved state. Ledger fetch is cached per tab.
        </div>
      </header>

      <section style={s.card}>
        <div style={s.controls}>
          <label style={s.label}>
            itemId
            <input
              style={s.input}
              value={itemId}
              onChange={(e) => {
                const v = e.target.value;
                setItemId(v);
                setPersistedItemId(v);
              }}
              placeholder="e.g. ITEM-123"
            />
          </label>

          <button style={s.button} onClick={() => load({ force: false })} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh (cached)"}
          </button>

          <button style={s.buttonSecondary} onClick={() => load({ force: true })} disabled={loading}>
            Refresh (force)
          </button>

          <button style={s.buttonSecondary} onClick={exportCsv} disabled={loading}>
            Export CSV
          </button>

          {focus ? (
            <div style={s.quickLinks}>
              <Link style={s.link} href={movementsHref(focus)}>
                Movements for {focus}
              </Link>
            </div>
          ) : null}

          <div style={s.meta}>
            Focus: <span style={s.mono}>{focus || "—"}</span> | Rows:{" "}
            <span style={s.mono}>{filtered.length}</span> | Derived total qtyDelta:{" "}
            <span style={s.mono}>{focus ? derivedTotalQtyDelta : "—"}</span>
          </div>
        </div>

        {/* Saved Views (localStorage only) */}
        <div style={{ marginTop: 12 }}>
          <SavedViewsBar
            storageKey={SAVED_VIEWS_KEY}
            valueLabel="itemId"
            currentValue={focus}
            onApply={applySaved}
          />
        </div>

        {err ? <div style={s.err}>Error: {err}</div> : null}
        {!focus ? <div style={s.empty}>Enter an itemId to view its ledger-derived timeline.</div> : null}
        {focus && filtered.length === 0 && !loading ? (
          <div style={s.empty}>No ledger events found for this itemId.</div>
        ) : null}

        {focus && filtered.length > 0 ? (
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>ts</th>
                  <th style={s.thRight}>qtyDelta</th>
                  <th style={s.th}>eventType</th>
                  <th style={s.th}>eventId</th>
                  <th style={s.th}>Links</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e, idx) => {
                  const ts = typeof e?.ts === "string" ? e.ts : "—";
                  const q = e?.qtyDelta;
                  const neg = typeof q === "number" && q < 0;
                  const eventType = typeof e?.eventType === "string" ? e.eventType : "—";
                  const eventId = typeof e?.id === "string" ? e.id : "";
                  const key = eventId || `${ts}:${idx}`;

                  return (
                    <tr key={key}>
                      <td style={s.td}>
                        <span style={s.mono}>{ts}</span>
                      </td>
                      <td style={{ ...s.tdRight, ...(neg ? s.neg : null) }}>
                        <span style={s.mono}>{typeof q === "number" ? q : "—"}</span>
                      </td>
                      <td style={s.td}>{eventType}</td>
                      <td style={s.td}>
                        {eventId ? <span style={s.mono}>{eventId}</span> : <span style={s.muted}>—</span>}
                      </td>
                      <td style={s.td}>
                        <Link style={s.link} href={itemHref(focus)}>
                          Permalink
                        </Link>
                        <span style={s.muted}> · </span>
                        <Link style={s.link} href={movementsHref(focus)}>
                          Movements
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section style={s.card}>
        <div style={s.noteTitle}>Notes</div>
        <ul style={s.ul}>
          <li>Deterministic ordering: ts ascending, then id as tie-breaker.</li>
          <li>Derived total is the sum of numeric qtyDelta for this itemId (negative values allowed).</li>
          <li>Saved Views are local-only (localStorage) and do not affect backend behavior.</li>
          <li>Cached refresh avoids re-downloading ledger events across views in the same tab.</li>
          <li>Force refresh explicitly clears the cache and re-fetches.</li>
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
  controls: { display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" },
  label: { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "#222" },
  input: { width: 280, padding: "8px 10px", borderRadius: 10, border: "1px solid #ccc", outline: "none", fontSize: 13 },

  button: {
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid #111",
    background: "#111",
    color: "#fff",
    cursor: "pointer",
    fontSize: 13,
    height: 34,
  },
  buttonSecondary: {
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid #bbb",
    background: "#fff",
    color: "#111",
    cursor: "pointer",
    fontSize: 13,
    height: 34,
  },

  quickLinks: { fontSize: 13, paddingBottom: 2 },
  link: { color: "#0b57d0", textDecoration: "none", fontSize: 13 },

  meta: { fontSize: 13, color: "#444", paddingBottom: 2 },

  err: { marginTop: 10, color: "#b00020", fontSize: 13 },
  empty: { marginTop: 12, color: "#666", fontSize: 13 },

  tableWrap: { width: "100%", overflowX: "auto", marginTop: 12 },
  table: { borderCollapse: "collapse", width: "100%" },
  th: { textAlign: "left", fontSize: 12, color: "#444", borderBottom: "1px solid #eee", padding: "10px 8px" },
  thRight: { textAlign: "right", fontSize: 12, color: "#444", borderBottom: "1px solid #eee", padding: "10px 8px" },
  td: { padding: "10px 8px", borderBottom: "1px solid #f0f0f0", fontSize: 13, verticalAlign: "top" },
  tdRight: { padding: "10px 8px", borderBottom: "1px solid #f0f0f0", fontSize: 13, textAlign: "right", verticalAlign: "top" },

  neg: { color: "#b00020", fontWeight: 700 },
  muted: { color: "#777" },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },

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
  label: { ...styles.label, fontSize: 12 },
  input: { ...styles.input, padding: "6px 8px", fontSize: 12 },

  button: { ...styles.button, padding: "6px 10px", fontSize: 12, height: 30 },
  buttonSecondary: { ...styles.buttonSecondary, padding: "6px 10px", fontSize: 12, height: 30 },

  meta: { ...styles.meta, fontSize: 12 },

  err: { ...styles.err, fontSize: 12 },
  empty: { ...styles.empty, fontSize: 12 },

  th: { ...styles.th, padding: "8px 6px", fontSize: 11 },
  thRight: { ...styles.thRight, padding: "8px 6px", fontSize: 11 },
  td: { ...styles.td, padding: "8px 6px", fontSize: 12 },
  tdRight: { ...styles.tdRight, padding: "8px 6px", fontSize: 12 },

  link: { ...styles.link, fontSize: 12 },

  noteTitle: { ...styles.noteTitle, fontSize: 13 },
  ul: { ...styles.ul, fontSize: 12 },
};
