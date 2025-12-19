"use client";

import { useEffect, useMemo, useState } from "react";
import { asoraGetJson } from "@/lib/asoraFetch";

export default function InventorySnapshotPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [events, setEvents] = useState([]);
  const [computedAt, setComputedAt] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await asoraGetJson("/v1/ledger/events", {});
      setEvents(Array.isArray(r?.events) ? r.events : []);
      setComputedAt(new Date().toISOString());
    } catch {
      setError("Failed to load ledger events");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const derived = useMemo(() => {
    const map = new Map();
    let skippedMissingItem = 0;
    let skippedMissingDelta = 0;

    events.forEach((ev) => {
      const itemId = ev?.itemId;
      const delta = ev?.qtyDelta;

      if (!itemId) {
        skippedMissingItem++;
        return;
      }
      if (typeof delta !== "number" || Number.isNaN(delta)) {
        skippedMissingDelta++;
        return;
      }

      if (!map.has(itemId)) {
        map.set(itemId, { itemId, quantity: 0 });
      }
      map.get(itemId).quantity += delta;
    });

    const rows = Array.from(map.values()).sort((a, b) =>
      a.itemId.localeCompare(b.itemId)
    );

    return {
      rows,
      skippedMissingItem,
      skippedMissingDelta
    };
  }, [events]);

  function exportCsv() {
    if (!derived.rows.length) return;

    const header = ["itemId", "derivedQuantity"];
    const lines = derived.rows.map((r) =>
      [r.itemId, r.quantity].join(",")
    );

    const csv =
      header.join(",") +
      "\n" +
      lines.join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `inventory_snapshot_${computedAt || "unknown"}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <main style={styles.shell}>
      <header style={styles.header}>
        <h1 style={styles.title}>Inventory Snapshot</h1>
        <div style={styles.sub}>
          Derived client-side from ledger events. Not stored state.
        </div>
      </header>

      <section style={styles.card}>
        <div style={styles.meta}>
          <div>Computed at: {computedAt || "—"}</div>
          <div style={styles.actions}>
            <button onClick={load} style={styles.button} disabled={loading}>
              Recompute
            </button>
            <button
              onClick={exportCsv}
              style={styles.buttonSecondary}
              disabled={!derived.rows.length}
            >
              Export CSV
            </button>
          </div>
        </div>
      </section>

      {error && <section style={styles.cardError}>{error}</section>}

      {!loading && derived.rows.length === 0 && (
        <section style={styles.card}>
          <div>No inventory deltas available to compute snapshot.</div>
        </section>
      )}

      {derived.rows.length > 0 && (
        <section style={styles.card}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Item ID</th>
                <th style={styles.thRight}>Derived On-Hand</th>
              </tr>
            </thead>
            <tbody>
              {derived.rows.map((r) => (
                <tr key={r.itemId}>
                  <td style={styles.td}>{r.itemId}</td>
                  <td
                    style={{
                      ...styles.tdRight,
                      color: r.quantity < 0 ? "#ff7b7b" : undefined
                    }}
                  >
                    {r.quantity}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section style={styles.cardNote}>
        <div>
          Events skipped (missing <code>itemId</code>):{" "}
          {derived.skippedMissingItem}
        </div>
        <div>
          Events skipped (missing <code>qtyDelta</code>):{" "}
          {derived.skippedMissingDelta}
        </div>
      </section>
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
  header: { marginBottom: 18 },
  title: { fontSize: 22, fontWeight: 700 },
  sub: { fontSize: 13, opacity: 0.75 },
  card: {
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    background: "rgba(255,255,255,0.02)"
  },
  cardError: {
    border: "1px solid rgba(255,0,0,0.4)",
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    background: "rgba(255,0,0,0.05)"
  },
  cardNote: {
    border: "1px dashed rgba(255,255,255,0.12)",
    borderRadius: 12,
    padding: 12,
    opacity: 0.8
  },
  meta: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap"
  },
  actions: { display: "flex", gap: 8 },
  button: {
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.2)",
    background: "rgba(255,255,255,0.05)",
    color: "#e6edf3",
    cursor: "pointer"
  },
  buttonSecondary: {
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px dashed rgba(255,255,255,0.25)",
    background: "rgba(255,255,255,0.03)",
    color: "#e6edf3",
    cursor: "pointer"
  },
  table: {
    width: "100%",
    borderCollapse: "collapse"
  },
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
