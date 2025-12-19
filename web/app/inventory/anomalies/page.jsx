"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { asoraGetJson } from "@/lib/asoraFetch";
import CompactBar, { useDensity } from "../_ui/CompactBar.jsx";
import { clearLedgerCache, getLedgerEventsCached } from "@/lib/ledgerCache";
import AdminHeader from "../_ui/AdminHeader.jsx";
import LedgerFreshnessBar from "../_ui/LedgerFreshnessBar.jsx";
import IntegrityFooter from "../_ui/IntegrityFooter.jsx";
import { downloadCsvFromRows } from "../_ui/csv.js";

export const runtime = "edge";

function itemHref(itemId) {
  return `/inventory/item?itemId=${encodeURIComponent(String(itemId))}`;
}

export default function InventoryAnomaliesPage() {
  const { isCompact } = useDensity();
  const s = isCompact ? compact : styles;

  const [events, setEvents] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
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

      const r = await getLedgerEventsCached(asoraGetJson);
      const ev = Array.isArray(r?.events) ? r.events : [];
      setEvents(ev);

      // NOTE: anomaly derivation already existed in U6; this is display-only reuse
      const anomalies = [];
      let skippedMissingItemId = 0;
      let skippedMissingQtyDelta = 0;

      for (const e of ev) {
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
        if (q === 0) {
          anomalies.push({ itemId, ledgerEventId: e?.ledgerEventId || "", reason: "qtyDelta == 0" });
        }
      }

      anomalies.sort((a, b) => a.itemId.localeCompare(b.itemId));
      setRows(anomalies);
      setLastFetchedUtc(new Date().toISOString());

      return {
        skipped: [
          { reason: "missing itemId", count: skippedMissingItemId },
          { reason: "missing qtyDelta", count: skippedMissingQtyDelta },
        ],
        processed: ev.length,
      };
    } catch (e) {
      setErr(e?.message || "Failed to load anomalies.");
      setEvents([]);
      setRows([]);
      return { skipped: [], processed: 0 };
    } finally {
      setLoading(false);
    }
  }

  const [integrity, setIntegrity] = useState({ skipped: [], processed: 0 });

  useEffect(() => {
    load({ force: false }).then(setIntegrity);
  }, []);

  function exportCsv() {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    downloadCsvFromRows(
      `asora_inventory_anomalies_${ts}.csv`,
      ["itemId", "ledgerEventId", "reason"],
      rows.map((r) => ({
        itemId: r.itemId,
        ledgerEventId: r.ledgerEventId,
        reason: r.reason,
      }))
    );
  }

  return (
    <main style={s.shell}>
      <AdminHeader
        title="Inventory Anomalies"
        subtitle="Read-only integrity signals derived from ledger events."
        freshnessSlot={
          <LedgerFreshnessBar
            lastFetchedUtc={lastFetchedUtc}
            cacheStatus={cacheStatus}
            onRefresh={() => load({ force: false }).then(setIntegrity)}
            onForceRefresh={() => load({ force: true }).then(setIntegrity)}
          />
        }
      />

      <section style={s.card}>
        <div style={s.controls}>
          <button style={s.button} onClick={() => load({ force: false }).then(setIntegrity)} disabled={loading}>
            Refresh (cached)
          </button>
          <button style={s.buttonSecondary} onClick={() => load({ force: true }).then(setIntegrity)} disabled={loading}>
            Refresh (force)
          </button>
          <button style={s.buttonSecondary} onClick={exportCsv} disabled={rows.length === 0}>
            Export CSV
          </button>
        </div>

        {err ? <div style={s.err}>Error: {err}</div> : null}
        {rows.length === 0 && !loading ? <div style={s.empty}>No anomalies detected.</div> : null}

        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>itemId</th>
                <th style={s.th}>ledgerEventId</th>
                <th style={s.th}>reason</th>
                <th style={s.th}>Links</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.itemId}-${i}`}>
                  <td style={s.td}><span style={s.mono}>{r.itemId}</span></td>
                  <td style={s.td}><span style={s.mono}>{r.ledgerEventId}</span></td>
                  <td style={s.td}>{r.reason}</td>
                  <td style={s.td}>
                    <Link style={s.link} href={itemHref(r.itemId)}>Drill-down</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <IntegrityFooter
          ledgerEventsProcessed={integrity.processed}
          skipped={integrity.skipped}
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
  button: { padding: "8px 12px", borderRadius: 10, background: "#111", color: "#fff" },
  buttonSecondary: { padding: "8px 12px", borderRadius: 10, border: "1px solid #bbb", background: "#fff" },
  err: { color: "#b00020" },
  empty: { color: "#666" },
  tableWrap: { overflowX: "auto", marginTop: 12 },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", borderBottom: "1px solid #eee" },
  td: { padding: "8px" },
  link: { color: "#0b57d0", textDecoration: "none" },
  mono: { fontFamily: "ui-monospace, monospace" },
};

const compact = styles;
