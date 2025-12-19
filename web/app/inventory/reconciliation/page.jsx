"use client";

import { useEffect, useMemo, useState } from "react";
import { asoraGetJson } from "@/lib/asoraFetch";

export default function InventoryReconciliationPage() {
  const [items, setItems] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [itemsResp, ledgerResp] = await Promise.all([
        asoraGetJson("/v1/inventory/items", {}),
        asoraGetJson("/v1/ledger/events", {})
      ]);
      setItems(Array.isArray(itemsResp?.items) ? itemsResp.items : []);
      setEvents(Array.isArray(ledgerResp?.events) ? ledgerResp.events : []);
    } catch {
      setError("Failed to load inventory or ledger data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const ledgerDerived = useMemo(() => {
    const map = new Map();
    events.forEach((e) => {
      if (!e?.itemId) return;
      if (typeof e.qtyDelta !== "number" || Number.isNaN(e.qtyDelta)) return;
      map.set(e.itemId, (map.get(e.itemId) || 0) + e.qtyDelta);
    });
    return map;
  }, [events]);

  const rows = useMemo(() => {
    const byId = new Map(items.map((i) => [i.itemId, i]));
    const allIds = new Set([
      ...Array.from(byId.keys()),
      ...Array.from(ledgerDerived.keys())
    ]);

    const out = [];
    allIds.forEach((itemId) => {
      const item = byId.get(itemId);
      const catalogQty =
        typeof item?.quantity === "number"
          ? item.quantity
          : typeof item?.qty === "number"
          ? item.qty
          : null;
      const ledgerQty = ledgerDerived.has(itemId)
        ? ledgerDerived.get(itemId)
        : null;

      const mismatch =
        catalogQty !== null &&
        ledgerQty !== null &&
        catalogQty !== ledgerQty;

      out.push({
        itemId,
        catalogQty,
        ledgerQty,
        mismatch
      });
    });

    return out.sort((a, b) => a.itemId.localeCompare(b.itemId));
  }, [items, ledgerDerived]);

  return (
    <main style={styles.shell}>
      <header style={styles.header}>
        <h1 style={styles.title}>Inventory Reconciliation</h1>
        <div style={styles.sub}>
          Side-by-side comparison of inventory read vs ledger-derived state
        </div>
      </header>

      <section style={styles.card}>
        <button onClick={load} style={styles.button} disabled={loading}>
          Refresh
        </button>
      </section>

      {error && <section style={styles.cardError}>{error}</section>}

      {rows.length === 0 && !loading && (
        <section style={styles.card}>No data available.</section>
      )}

      {rows.length > 0 && (
        <section style={styles.card}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Item ID</th>
                <th style={styles.thRight}>Inventory Read</th>
                <th style={styles.thRight}>Ledger-Derived</th>
                <th style={styles.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.itemId}>
                  <td style={styles.td}>{r.itemId}</td>
                  <td style={styles.tdRight}>
                    {r.catalogQty ?? "—"}
                  </td>
                  <td style={styles.tdRight}>
                    {r.ledgerQty ?? "—"}
                  </td>
                  <td
                    style={{
                      ...styles.td,
                      color: r.mismatch ? "#ffb86b" : "#8bd5a8"
                    }}
                  >
                    {r.mismatch ? "Mismatch" : "OK"}
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
