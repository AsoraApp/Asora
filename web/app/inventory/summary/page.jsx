"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { asoraGetJson } from "@/lib/asoraFetch";
import CompactBar, { useDensity } from "../_ui/CompactBar.jsx";

export const runtime = "edge";

export default function InventorySummaryPage() {
  const { isCompact } = useDensity();

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [ledgerTotals, setLedgerTotals] = useState(new Map());
  const [inventoryMap, setInventoryMap] = useState(new Map());

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const [ledR, invR] = await Promise.all([
        asoraGetJson("/v1/ledger/events", {}),
        asoraGetJson("/v1/inventory/items", {}),
      ]);

      // Ledger-derived totals
      const lMap = new Map();
      const events = Array.isArray(ledR?.events) ? ledR.events : [];
      for (const e of events) {
        if (!e || typeof e !== "object") continue;
        if (typeof e.itemId !== "string") continue;
        if (typeof e.qtyDelta !== "number") continue;
        lMap.set(e.itemId, (lMap.get(e.itemId) || 0) + e.qtyDelta);
      }

      // Inventory quantities (best-effort)
      const iMap = new Map();
      const items = Array.isArray(invR?.items) ? invR.items : Array.isArray(invR?.data?.items) ? invR.data.items : [];
      for (const it of items) {
        if (!it || typeof it !== "object") continue;
        if (typeof it.itemId !== "string") continue;
        if (typeof it.quantity !== "number") continue;
        iMap.set(it.itemId, it.quantity);
      }

      setLedgerTotals(lMap);
      setInventoryMap(iMap);
    } catch (e) {
      setErr(e?.message || "Failed to load summary data.");
      setLedgerTotals(new Map());
      setInventoryMap(new Map());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const stats = useMemo(() => {
    const itemIds = new Set([...ledgerTotals.keys(), ...inventoryMap.keys()]);

    let negativeTotals = 0;
    let mismatches = 0;

    for (const id of itemIds) {
      const led = ledgerTotals.get(id);
      const inv = inventoryMap.get(id);

      if (typeof led === "number" && led < 0) negativeTotals += 1;
      if (led !== inv) mismatches += 1;
    }

    return {
      totalItems: itemIds.size,
      negativeTotals,
      mismatches,
    };
  }, [ledgerTotals, inventoryMap]);

  const s = isCompact ? compact : styles;

  return (
    <main style={s.shell}>
      <CompactBar here="Summary" />

      <header style={s.header}>
        <div style={s.title}>Inventory Summary</div>
        <div style={s.sub}>
          Derived, read-only overview of inventory health. All values computed client-side from existing read endpoints.
        </div>
      </header>

      <section style={s.grid}>
        <div style={s.card}>
          <div style={s.cardLabel}>Total Items</div>
          <div style={s.cardValue}>{stats.totalItems}</div>
        </div>

        <div style={s.card}>
          <div style={s.cardLabel}>Negative On-Hand Totals</div>
          <div style={s.cardValue}>{stats.negativeTotals}</div>
          <Link style={s.cardLink} href="/inventory/anomalies">
            View anomalies →
          </Link>
        </div>

        <div style={s.card}>
          <div style={s.cardLabel}>Ledger ↔ Inventory Mismatches</div>
          <div style={s.cardValue}>{stats.mismatches}</div>
          <Link style={s.cardLink} href="/inventory/reconciliation">
            View reconciliation →
          </Link>
        </div>
      </section>

      {err ? <div style={s.err}>Error: {err}</div> : null}
      {loading ? <div style={s.loading}>Refreshing…</div> : null}
    </main>
  );
}

const styles = {
  shell: { minHeight: "100vh", padding: 24, fontFamily: "ui-sans-serif, system-ui" },
  header: { marginBottom: 20 },
  title: { fontSize: 22, fontWeight: 700 },
  sub: { marginTop: 6, fontSize: 13, color: "#555" },

  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 },

  card: {
    border: "1px solid #e5e5e5",
    borderRadius: 14,
    padding: 18,
    background: "#fff",
  },
  cardLabel: { fontSize: 13, color: "#666" },
  cardValue: { fontSize: 32, fontWeight: 800, marginTop: 6 },
  cardLink: { marginTop: 10, display: "inline-block", fontSize: 13, color: "#0b57d0", textDecoration: "none" },

  err: { marginTop: 14, color: "#b00020", fontSize: 13 },
  loading: { marginTop: 14, fontSize: 13, color: "#444" },
};

const compact = {
  ...styles,
  shell: { ...styles.shell, padding: 14 },
  card: { ...styles.card, padding: 14 },
  cardValue: { ...styles.cardValue, fontSize: 26 },
};
