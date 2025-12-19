"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { asoraGetJson } from "@/lib/asoraFetch";
import CompactBar, { useDensity } from "../_ui/CompactBar.jsx";

export const runtime = "edge";

function itemHref(itemId) {
  return `/inventory/item?itemId=${encodeURIComponent(String(itemId))}`;
}

export default function InventoryMovementsPage() {
  const { isCompact } = useDensity();

  const sp = useSearchParams();
  const initialItemId = sp?.get("itemId") || "";

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [filterItemId, setFilterItemId] = useState(initialItemId);
  const [events, setEvents] = useState([]);

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const r = await asoraGetJson("/v1/ledger/events", {});
      const list = Array.isArray(r?.events) ? r.events : [];

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
    load();
  }, []);

  const filtered = useMemo(() => {
    const item = (filterItemId || "").trim();
    if (!item) return events;
    return events.filter((e) => typeof e?.itemId === "string" && e.itemId === item);
  }, [events, filterItemId]);

  const focus = (filterItemId || "").trim();

  const s = isCompact ? compact : styles;

  return (
    <main style={s.shell}>
      <CompactBar here="Movements" />

      <header style={s.header}>
        <div style={s.title}>Inventory Movements</div>
        <div style={s.sub}>Chronological, ledger-derived movement timeline (read-only).</div>
      </header>

      <section style={s.card}>
        <div style={s.controls}>
          <label style={s.label}>
            Filter by itemId
            <input
              style={s.input}
              value={filterItemId}
              onChange={(e) => setFilterItemId(e.target.value)}
              placeholder="e.g. ITEM-123"
            />
          </label>

          <button style={s.button} onClick={load} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>

          {focus ? (
            <div style={s.quickLinks}>
              <Link style={s.link} href={itemHref(focus)}>
                Drill-down for {focus}
              </Link>
            </div>
          ) : null}
        </div>

        {err ? <div style={s.err}>Error: {err}</div> : null}
        {filtered.length === 0 && !loading ? <div style={s.empty}>No movements to display.</div> : null}

        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>ts</th>
                <th style={s.th}>itemId</th>
                <th style={s.thRight}>qtyDelta</th>
                <th style={s.th}>eventType</th>
                <th style={s.th}>Links</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e, idx) => {
                const itemId = typeof e?.itemId === "string" ? e.itemId : "";
                const q = e?.qtyDelta;
                const neg = typeof q === "number" && q < 0;
                const ts = typeof e?.ts === "string" ? e.ts : "—";
                const eventType = typeof e?.eventType === "string" ? e.eventType : "—";
                const key = (typeof e?.id === "string" && e.id) || `${ts}:${itemId}:${idx}`;

                return (
                  <tr key={key}>
                    <td style={s.td}>
                      <span style={s.mono}>{ts}</span>
                    </td>
                    <td style={s.td}>
                      {itemId ? <span style={s.mono}>{itemId}</span> : <span style={s.muted}>—</span>}
                    </td>
                    <td style={{ ...s.tdRight, ...(neg ? s.neg : null) }}>
                      <span style={s.mono}>{typeof q === "number" ? q : "—"}</span>
                    </td>
                    <td style={s.td}>{eventType}</td>
                    <td style={s.td}>
                      {itemId ? (
                        <Link style={s.link} href={itemHref(itemId)}>
                          Drill-down
                        </Link>
                      ) : (
                        <span style={s.muted}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section style={s.card}>
        <div style={s.noteTitle}>Notes</div>
        <ul style={s.ul}>
          <li>Sorting is deterministic: ts ascending, then id as a tie-breaker if present.</li>
          <li>Query parameter support: /inventory/movements?itemId=… pre-fills the filter.</li>
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
  quickLinks: { fontSize: 13, paddingBottom: 2 },
  link: { color: "#0b57d0", textDecoration: "none", fontSize: 13 },

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
