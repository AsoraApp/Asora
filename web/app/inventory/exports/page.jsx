"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { asoraGetJson, getStoredDevToken } from "@/lib/asoraFetch";
import { getLedgerEventsCached, clearLedgerCache } from "@/lib/ledgerCache";
import LedgerFreshnessBar from "@/app/_ui/LedgerFreshnessBar.jsx";
import { downloadCsvFromRows } from "@/app/_ui/csv.js";

export const runtime = "edge";

function utcNowIso() {
  return new Date().toISOString();
}

function asString(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

async function fetchBuildStampSafe() {
  try {
    const r = await asoraGetJson("/__build", {});
    return asString(r?.build || r?.BUILD || r?.stamp || r?.version || "");
  } catch {
    return "";
  }
}

export default function InventoryExportsPage() {
  const devToken = useMemo(() => getStoredDevToken(), []);
  const [busy, setBusy] = useState(false);
  const [lastFetchedUtc, setLastFetchedUtc] = useState("");
  const [cacheStatus, setCacheStatus] = useState("cached");

  async function primeLedger({ force = false } = {}) {
    setBusy(true);
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
      setBusy(false);
    }
  }

  async function exportMetadata() {
    setBusy(true);
    try {
      const exportTsUtc = utcNowIso();
      const buildStamp = await fetchBuildStampSafe();
      downloadCsvFromRows(
        `asora_metadata_${exportTsUtc.replace(/[:.]/g, "-")}.csv`,
        ["exportTsUtc", "tenant", "build"],
        [{ exportTsUtc, tenant: asString(devToken || ""), build: asString(buildStamp || "") }]
      );
    } finally {
      setBusy(false);
    }
  }

  async function exportLedgerRaw() {
    setBusy(true);
    try {
      const exportTsUtc = utcNowIso();
      const r = await getLedgerEventsCached(asoraGetJson);
      const events = Array.isArray(r?.events) ? r.events : [];

      downloadCsvFromRows(
        `asora_ledger_raw_${exportTsUtc.replace(/[:.]/g, "-")}.csv`,
        ["id", "ts", "eventType", "itemId", "qtyDelta", "tenantId", "ledgerEventId", "eventId"],
        events.map((e) => ({
          id: asString(e?.id),
          ts: asString(e?.ts),
          eventType: asString(e?.eventType),
          itemId: asString(e?.itemId),
          qtyDelta: e?.qtyDelta ?? "",
          tenantId: asString(e?.tenantId),
          ledgerEventId: asString(e?.ledgerEventId),
          eventId: asString(e?.eventId),
        }))
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={styles.shell}>
      <LedgerFreshnessBar
        lastFetchedUtc={lastFetchedUtc}
        cacheStatus={cacheStatus}
        loading={busy}
        onRefresh={() => primeLedger({ force: false })}
        onForceRefresh={() => primeLedger({ force: true })}
      />

      <section style={styles.card}>
        <div style={styles.actions}>
          <button style={styles.btn} onClick={() => primeLedger({ force: false })} disabled={busy}>
            Prime ledger (cached)
          </button>
          <button style={styles.btn} onClick={() => primeLedger({ force: true })} disabled={busy}>
            Prime ledger (force)
          </button>
          <button style={styles.btn} onClick={exportMetadata} disabled={busy}>
            Export Metadata (CSV)
          </button>
          <button style={styles.btn} onClick={exportLedgerRaw} disabled={busy}>
            Export Ledger Raw (CSV)
          </button>
        </div>
      </section>

      <section style={styles.card}>
        <div style={styles.links}>
          <Link style={styles.link} href="/inventory/snapshot">Inventory Snapshot</Link>
          <Link style={styles.link} href="/inventory/reconciliation">Inventory Reconciliation</Link>
          <Link style={styles.link} href="/inventory/anomalies">Inventory Anomalies</Link>
          <Link style={styles.linkSecondary} href="/">Home</Link>
        </div>
      </section>
    </main>
  );
}

const styles = {
  shell: { minHeight: "100vh", padding: 24 },
  card: { border: "1px solid #e5e5e5", borderRadius: 12, padding: 16, marginBottom: 16, background: "#fff" },
  actions: { display: "flex", flexWrap: "wrap", gap: 10 },
  btn: { padding: "10px 12px", borderRadius: 10, border: "1px solid #bbb", background: "#fff", cursor: "pointer" },
  links: { display: "flex", flexWrap: "wrap", gap: 10 },
  link: { color: "#0b57d0", textDecoration: "none" },
  linkSecondary: { color: "#444", textDecoration: "none" },
};
