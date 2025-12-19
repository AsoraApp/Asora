"use client";

import { useEffect, useMemo, useState } from "react";
import { asoraGetJson } from "@/lib/asoraFetch";

export default function InventoryAnomaliesPage() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

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

  const analysis = useMemo(() => {
    let missingItemId = [];
    let missingQtyDelta = [];
    let negativeDeltas = [];
    const totals = new Map();

    events.forEach((e, idx) => {
      const id = e?.itemId;
      const delta = e?.qtyDelta;

      if (!id) {
        missingItemId.push({ idx, event: e });
        return;
      }

      if (typeof delta !== "number" || Number.isNaN(delta)) {
        missingQtyDelta.push({ idx, event: e });
        return;
      }

      if (!totals.has(id)) totals.set(id, 0);
      totals.set(id, totals.get(id) + delta);

      if (delta < 0) {
        negativeDeltas.push({ idx, event: e });
      }
    });

    const negativeOnHand = Array.from(totals.entries())
      .filter(([, qty]) => qty < 0)
      .map(([itemId, qty]) => ({ itemId, qty }));

    return {
      missingItemId,
      missingQtyDelta,
      negativeDeltas,
      negativeOnHand
    };
  }, [events]);

  return (
    <main style={styles.shell}>
      <header style={styles.header}>
        <h1 style={styles.title}>Inventory Anomalies</h1>
        <div style={styles.sub}>
          Read-only integrity signals derived from ledger data
        </div>
      </header>

      <section style={styles.card}>
        <button onClick={load} style={styles.button} disabled={loading}>
          Refresh
        </button>
      </section>

      {error && <section style={styles.cardError}>{error}</section>}

      <section style={styles.card}>
        <h3 style={styles.h3}>Summary</h3>
        <ul style={styles.ul}>
          <li>Events missing itemId: {analysis.missingItemId.length}</li>
          <li>Events missing qtyDelta: {analysis.missingQtyDelta.length}</li>
          <li>Events with negative qtyDelta: {analysis.negativeDeltas.length}</li>
          <li>Items with negative on-hand: {analysis.negativeOnHand.length}</li>
        </ul>
      </section>

      {analysis.negativeOnHand.length > 0 && (
        <section style={styles.card}>
          <h3 style={styles.h3}>Negative On-Hand Items</h3>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Item ID</th>
                <th style={styles.thRight}>Derived Quantity</th>
              </tr>
            </thead>
            <tbody>
              {analysis.negativeOnHand.map((r) => (
                <tr key={r.itemId}>
                  <td style={styles.td}>{r.itemId}</td>
                  <td style={{ ...styles.tdRight, color: "#ff7b7b" }}>
                    {r.qty}
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
  h3: { margin: "0 0 8px 0", fontSize: 15 },
  ul: { margin: 0, paddingLeft: 18, opacity: 0.9 },
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
