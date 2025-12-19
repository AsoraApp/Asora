"use client";

import { useEffect, useState } from "react";
import { asoraGetJson } from "@/lib/asoraFetch";
import { clearLedgerCache, getLedgerEventsCached } from "@/lib/ledgerCache";
import AdminHeader from "../_ui/AdminHeader.jsx";
import LedgerFreshnessBar from "../_ui/LedgerFreshnessBar.jsx";
import { downloadCsvFromRows } from "../_ui/csv.js";

export const runtime = "edge";

export default function InventoryExportsPage() {
  const [loading, setLoading] = useState(false);
  const [lastFetchedUtc, setLastFetchedUtc] = useState("");
  const [cacheStatus, setCacheStatus] = useState("cached");

  async function load({ force = false } = {}) {
    setLoading(true);
    try {
      if (force) {
        clearLedgerCache();
        setCacheStatus("fresh");
      } else {
        setCacheStatus("cached");
      }
      await getLedgerEventsCached(asoraGetJson);
      setLastFetchedUtc(new Date().toISOString());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load({ force: false });
  }, []);

  function exportLedgerRaw() {
    getLedgerEventsCached(asoraGetJson).then((r) => {
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      downloadCsvFromRows(
        `asora_ledger_raw_${ts}.csv`,
        ["ts", "ledgerEventId", "eventType", "itemId", "qtyDelta", "tenantId"],
        (r?.events || []).map((e) => ({
          ts: e?.ts || "",
          ledgerEventId: e?.ledgerEventId || "",
          eventType: e?.eventType || "",
          itemId: e?.itemId || "",
          qtyDelta: e?.qtyDelta ?? "",
          tenantId: e?.tenantId || "",
        }))
      );
    });
  }

  return (
    <main style={{ minHeight: "100vh", padding: 24 }}>
      <AdminHeader
        title="Integrity Exports"
        subtitle="Deterministic, read-only CSV exports for audit and review."
        freshnessSlot={
          <LedgerFreshnessBar
            lastFetchedUtc={lastFetchedUtc}
            cacheStatus={cacheStatus}
            onRefresh={() => load({ force: false })}
            onForceRefresh={() => load({ force: true })}
          />
        }
      />

      <section style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 16 }}>
        <button onClick={exportLedgerRaw} disabled={loading}>
          Export Raw Ledger CSV
        </button>
      </section>
    </main>
  );
}
