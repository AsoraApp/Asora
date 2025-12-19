"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { asoraGetJson } from "@/lib/asoraFetch";

export const runtime = "edge";

function itemHref(itemId) {
  return `/inventory/item?itemId=${encodeURIComponent(String(itemId))}`;
}

export default function InventoryMovementsPage() {
  const sp = useSearchParams();
  const initialItemId = sp?.get("itemId") || "";

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [filterItemId, setFilterItemId] = useState(initialItemId);
  const [events, setEvents] = useState([]);

  useEffect(() => {
    // Keep deterministic behavior: only initialize from query on first render
    // Subsequent changes are user-driven in this session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const r = await asoraGetJson("/v1/ledger/events", {});
      const list = Array.isArray(r?.events) ? r.events : [];

      // Deterministic chronological sort (ascending).
      // If timestamps tie or are missing, fall back to stable string key.
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

  return (
    <main style={styles.shell}>
      <header style={styles.header}>
        <div style={styles.title}>Inventory Movements</div>
        <div style={styles.sub}>Chronological, ledger-derived movement timeline (read-only).</div>
      </header>

      <section style={styles.card}>
        <div style={styles.controls}>
          <label style={styles.label}>
            Filter by itemId
            <input
              style={styles.input}
              value={filterItemId}
              onChange={(e) => setFilterItemId(e.target.value)}
              placeholder="e.g. ITEM-123"
            />
          </label>

          <button style={styles.button} onClick={load} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>

          {filterItemId.trim() ? (
            <div style={styles.quickLinks}>
              <Link style={styles.link} href={itemHref(filterItemId.trim())}>
                Drill-down for {filterItemId.trim()}
              </Link>
            </div>
          ) : null}
        </div>

        {err ? <div style={styles.err}>Error: {err}</div> : null}
        {filtered.length === 0 && !loading ? <div style={styles.empty}>No movements to display.</div> : null}

        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>ts</th>
                <th style={styles.th}>itemId</th>
                <th style={styles.thRight}>qtyDelta</th>
                <th style={styles.th}>eventType</th>
                <th style={styles.th}>Links</th>
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
                    <td style={styles.td}>
                      <span style={styles.mono}>{ts}</span>
                    </td>
                    <td style={styles.td}>
                      {itemId ? <span style={styles.mono}>{itemId}</span> : <span style={styles.muted}>—</span>}
                    </td>
                    <td style={{ ...styles.tdRight, ...(neg ? styles.neg : null) }}>
                      <span style={styles.mono}>{typeof q === "number" ? q : "—"}</span>
                    </td>
                    <td style={styles.td}>{eventType}</td>
                    <td style={styles.td}>
                      {itemId ? (
                        <Link style={styles.link} href={itemHref(itemId)}>
                          Drill-down
                        </Link>
                      ) : (
                        <span style={styles.muted}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section style={styles.card}>
        <div style={styles.noteTitle}>Notes</div>
        <ul style={styles.ul}>
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
  card: {
    border: "1px solid #e5e5e5",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    background: "#fff",
  },
  controls: { display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" },
  label: { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "#222" },
  input: {
    width: 280,
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid #ccc",
    outline: "none",
    fontSize: 13,
  },
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
  tdRight: {
    padding: "10px 8px",
    borderBottom: "1px solid #f0f0f0",
    fontSize: 13,
    textAlign: "right",
    verticalAlign: "top",
  },
  neg: { color: "#b00020", fontWeight: 700 },
  muted: { color: "#777" },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },
  noteTitle: { fontSize: 14, fontWeight: 700, marginBottom: 8 },
  ul: { margin: 0, paddingLeft: 18, color: "#333", fontSize: 13, lineHeight: 1.5 },
};
