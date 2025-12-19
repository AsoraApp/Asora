"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { asoraGetJson } from "@/lib/asoraFetch";
import CompactBar, { useDensity } from "../_ui/CompactBar.jsx";
import { usePersistedString } from "../_ui/useViewState.jsx";
import { clearLedgerCache, getLedgerEventsCached } from "@/lib/ledgerCache";
import AdminHeader from "../_ui/AdminHeader.jsx";
import LedgerFreshnessBar from "../_ui/LedgerFreshnessBar.jsx";
import IntegrityFooter from "../_ui/IntegrityFooter.jsx";
import { downloadCsvFromRows } from "../_ui/csv.js";

export const runtime = "edge";

const PAGE_SIZE = 500;
const FOCUS_STORE_KEY = "asora_view:reconciliation:focusItemId";

function itemHref(itemId) {
  return `/inventory/item?itemId=${encodeURIComponent(String(itemId))}`;
}

export default function InventoryReconciliationPage() {
  const { isCompact } = useDensity();
  const s = isCompact ? compact : styles;

  const [focusItemId, setFocusItemId] = usePersistedString(FOCUS_STORE_KEY, "");
  const [events, setEvents] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [page, setPage] = useState(1);
  const [lastFetchedUtc, setLastFetchedUtc] = useState("");
  const [cacheStatus, setCacheStatus] = useState("cached");

  async function load({ force = false } = {}) {
    setLoading(true);
    setErr("");
    try {
      if (force) {
        clearLedgerCache();
        setCacheStatus("fresh");
      } else {
        setCacheStatus("cached");
      }

      const [ledger, inv] = await Promise.all([
        getLedgerEventsCached(asoraGetJson),
        asoraGetJson("/v1/inventory/items", {}),
      ]);

      const ev = Array.isArray(ledger?.events) ? ledger.events : [];
      const it = Array.isArray(inv?.items) ? inv.items : inv?.data?.items || [];

      setEvents(ev);
      setItems(it);
      setLastFetchedUtc(new Date().toISOString());
    } catch (e) {
      setErr(e?.message || "Failed to reconcile inventory.");
      setEvents([]);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load({ force: false });
  }, []);

  const focus = (focusItemId || "").trim();

  const derived = useMemo(() => {
    const ledgerTotals = new Map();
    let skippedMissingItemId = 0;
    let skippedMissingQtyDelta = 0;

    for (const e of events) {
      const itemId = typeof e?.itemId === "string" ? e.itemId : "";
      if (!itemId) {
        skippedMissingItemId += 1;
        continue;
      }
      const q = e?.qtyDelta;
      if (typeof q !== "number" || !Number.isFinite(q)) {
        skippedMissingQtyDelta += 1;
        continue;
      }
      ledgerTotals.set(itemId, (ledgerTotals.get(itemId) || 0) + q);
    }

    const rows = [];
    for (const it of items) {
      const itemId = it?.itemId;
      if (!itemId) continue;
      const ledgerQty = ledgerTotals.get(itemId) || 0;
      const invQty = typeof it?.quantity === "number" ? it.quantity : null;
      const delta = invQty === null ? null : ledgerQty - invQty;
      if (focus && itemId !== focus) continue;
      rows.push({ itemId, ledgerQty, invQty, delta });
    }

    rows.sort((a, b) => a.itemId.localeCompare(b.itemId));
    return {
      rows,
      skipped: [
        { reason: "missing itemId", count: skippedMissingItemId },
        { reason: "missing qtyDelta", count: skippedMissingQtyDelta },
      ],
      processed: events.length,
    };
  }, [events, items, focus]);

  useEffect(() => setPage(1), [derived.rows.length, focus]);

  const pageCount = Math.max(1, Math.ceil(derived.rows.length / PAGE_SIZE));
  const visible = derived.rows.slice(0, Math.min(derived.rows.length, page * PAGE_SIZE));

  function exportCsv() {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    downloadCsvFromRows(
      `asora_inventory_reconciliation_${ts}.csv`,
      ["itemId", "ledgerQty", "inventoryQty", "delta"],
      visible.map((r) => ({
        itemId: r.itemId,
        ledgerQty: r.ledgerQty,
        inventoryQty: r.invQty ?? "",
        delta: r.delta ?? "",
      }))
    );
  }

  return (
    <main style={s.shell}>
      <AdminHeader
        title="Inventory Reconciliation"
        subtitle="Ledger-derived quantities compared to inventory records."
        freshnessSlot={
          <LedgerFreshnessBar
            lastFetchedUtc={lastFetchedUtc}
            cacheStatus={cacheStatus}
            onRefresh={() => load({ force: false })}
            onForceRefresh={() => load({ force: true })}
          />
        }
      />

      <section style={s.card}>
        <div style={s.controls}>
          <button style={s.button} onClick={() => load({ force: false })} disabled={loading}>
            Refresh (cached)
          </button>
          <button style={s.buttonSecondary} onClick={() => load({ force: true })} disabled={loading}>
            Refresh (force)
          </button>
          <button style={s.buttonSecondary} onClick={exportCsv} disabled={visible.length === 0}>
            Export CSV
          </button>

          <label style={s.label}>
            Focus itemId
            <input
              style={s.input}
              value={focusItemId}
              onChange={(e) => setFocusItemId(e.target.value)}
              placeholder="exact itemId"
            />
          </label>
        </div>

        {err ? <div style={s.err}>Error: {err}</div> : null}
        {visible.length === 0 && !loading ? <div style={s.empty}>No reconciliation deltas.</div> : null}

        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>itemId</th>
                <th style={s.thRight}>ledgerQty</th>
                <th style={s.thRight}>inventoryQty</th>
                <th style={s.thRight}>delta</th>
                <th style={s.th}>Links</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.itemId}>
                  <td style={s.td}><span style={s.mono}>{r.itemId}</span></td>
                  <td style={s.tdRight}><span style={s.mono}>{r.ledgerQty}</span></td>
                  <td style={s.tdRight}><span style={s.mono}>{r.invQty ?? "—"}</span></td>
                  <td style={s.tdRight}><span style={s.mono}>{r.delta ?? "—"}</span></td>
                  <td style={s.td}>
                    <Link style={s.link} href={itemHref(r.itemId)}>Drill-down</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <IntegrityFooter
          ledgerEventsProcessed={derived.processed}
          skipped={derived.skipped}
          renderUtc={new Date().toISOString()}
        />
      </section>
    </main>
  );
}

const styles = {
  shell: { minHeight: "100vh", padding: 24 },
  card: { border: "1px solid #e5e5e5", borderRadius: 12, padding: 16 },
  controls: { display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" },
  label: { display: "flex", flexDirection: "column", fontSize: 13 },
  input: { width: 260, padding: "8px 10px", borderRadius: 10, border: "1px solid #ccc" },
  button: { padding: "8px 12px", borderRadius: 10, background: "#111", color: "#fff" },
  buttonSecondary: { padding: "8px 12px", borderRadius: 10, border: "1px solid #bbb", background: "#fff" },
  err: { color: "#b00020" },
  empty: { color: "#666" },
  tableWrap: { overflowX: "auto", marginTop: 12 },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", borderBottom: "1px solid #eee" },
  thRight: { textAlign: "right", borderBottom: "1px solid #eee" },
  td: { padding: "8px" },
  tdRight: { padding: "8px", textAlign: "right" },
  link: { color: "#0b57d0", textDecoration: "none" },
  mono: { fontFamily: "ui-monospace, monospace" },
};

const compact = styles;
