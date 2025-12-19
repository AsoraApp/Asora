"use client";

import { useEffect, useMemo, useState } from "react";
import { asoraGetJson } from "@/lib/asoraFetch";

export default function InventoryMovementsPage() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [filterItemId, setFilterItemId] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await asoraGetJson("/v1/ledger/events", {});
      setEvents(Array.isArray(r?.events) ? r.events : []);
    } catch {
      setError("Failed to load ledger events");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const rows = useMemo(() => {
    return events
      .filter((e) => {
        if (!e?.itemId) return false;
        if (filterItemId && e.itemId !== filterItemId) return false;
        return true;
      })
      .sort((a, b) =>
        String(a.timestamp || "").localeCompare(String(b.timestamp || ""))
      );
  }, [events, filterItemId]);

  return (
    <main style={styles.shell}>
      <header style={styles.header}>
        <h1 style={styles.title}>Inventory Movements</h1>
        <div style={styles.sub}>
          Ledger-derived, chronological movement view (read-only)
        </div>
      </header>

      <section style={styles.card}>
        <input
          placeholder="Filter by itemId"
          value={filterItemId}
          onChange={(e) => setFilterItemId(e.target.value)}
          style={styles.input}
        />
        <button onClick={load} style={styles.button} disabled={loading}>
          Refresh
        </button>
      </section>

      {error && <section style={styles.cardError}>{error}</section>}

      {rows.length === 0 && !loading && (
        <section style={styles.card}>No matching movements.</section>
      )}

      {rows.length > 0 && (
        <section style={styles.card}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Timestamp</th>
                <th style={styles.th}>Item ID</th>
                <th style={styles.thRight}>qtyDelta</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e, i) => (
                <tr key={`${e.eventId || i}`}>
                  <td style={styles.td}>{e.timestamp || "—"}</td>
                  <td style={styles.td}>{e.itemId}</td>
                  <td
                    style={{
                      ...styles.tdRight,
                      color:
                        typeof e.qtyDelta === "number" && e.qtyDelta < 0
                          ? "#ff7b7b"
                          : undefined
                    }}
                  >
                    {typeof e.qtyDelta === "number" ? e.qtyDelta : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}

const styles = {
  shell: {
    minHeight: "100vh",
    background: "#0b0f14",
    color: "#e6edf3",
    padding: 24
  },
  header: { marginBottom: 16 },
  title: { fontSize: 22, fontWeight: 700 },
  sub: { fontSize: 13, opacity: 0.75 },
  card: {
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    background: "rgba(255,255,255,0.02)",
    display: "flex",
    gap: 10,
    flexWrap: "wrap"
  },
  cardError: {
    border: "1px solid rgba(255,0,0,0.4)",
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    background: "rgba(255,0,0,0.05)"
  },
  input: {
    flex: "1 1 240px",
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.2)",
    background: "#0b0f14",
    color: "#e6edf3"
  },
  button: {
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.2)",
    background: "rgba(255,255,255,0.05)",
    color: "#e6edf3",
    cursor: "pointer"
  },
  table: { width: "100%", borderCollapse: "collapse" },
  th: {
    textAlign: "left",
    paddingBottom: 8,
    borderBottom: "1px solid rgba(255,255,255,0.12)"
  },
  thRight: {
    textAlign: "right",
    paddingBottom: 8,
    borderBottom: "1px solid rgba(255,255,255,0.12)"
  },
  td: {
    padding: "8px 0",
    borderBottom: "1px solid rgba(255,255,255,0.06)"
  },
  tdRight: {
    padding: "8px 0",
    textAlign: "right",
    borderBottom: "1px solid rgba(255,255,255,0.06)"
  }
};
