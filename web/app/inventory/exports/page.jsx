// web/app/inventory/exports/page.jsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { asoraGetJson, getStoredDevToken } from "@/lib/asoraFetch";
import { getLedgerEventsCached, clearLedgerCache } from "@/lib/ledgerCache";

export const runtime = "edge";

/**
 * U7 — READ-ONLY INTEGRITY EXPORTS (EVIDENCE MODE)
 *
 * Guarantees:
 * - UI-only
 * - Read-only
 * - No new endpoints
 * - No writes
 * - Deterministic outputs
 * - UTC timestamps only
 * - Evidence-grade CSV rules: stable columns, explicit headers, exact values, blanks for missing
 */

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

function csvEscape(value) {
  const s = asString(value);
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(headers, rows) {
  const headerLine = headers.map(csvEscape).join(",");
  const lines = rows.map((r) => headers.map((h) => csvEscape(r?.[h])).join(","));
  return [headerLine, ...lines].join("\n") + "\n";
}

function downloadText(filename, text, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function coerceNumber(x) {
  if (typeof x === "number") return x;
  if (typeof x === "string" && x.trim() !== "") {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isFiniteNumber(x) {
  return typeof x === "number" && Number.isFinite(x);
}

function normalizeEvents(raw) {
  const events = Array.isArray(raw?.events) ? raw.events : Array.isArray(raw) ? raw : [];
  return [...events].sort((a, b) => {
    const ta = asString(a?.ts);
    const tb = asString(b?.ts);
    if (ta < tb) return -1;
    if (ta > tb) return 1;
    const ia = asString(a?.id);
    const ib = asString(b?.id);
    if (ia < ib) return -1;
    if (ia > ib) return 1;
    return 0;
  });
}

function deriveSnapshotFromEvents(events) {
  const totals = new Map(); // itemId -> total qtyDelta
  for (const ev of events) {
    const itemId = ev?.itemId;
    const qtyDelta = coerceNumber(ev?.qtyDelta);
    if (itemId === null || itemId === undefined || itemId === "") continue;
    if (qtyDelta === null) continue;
    const key = String(itemId);
    totals.set(key, (totals.get(key) || 0) + qtyDelta);
  }
  return Array.from(totals.entries())
    .map(([itemId, derivedQty]) => ({ itemId, derivedQty }))
    .sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
}

async function fetchAllInventoryItems() {
  const r = await asoraGetJson("/v1/inventory/items", {});
  const items = Array.isArray(r?.items) ? r.items : Array.isArray(r) ? r : [];
  return items;
}

function buildReconciliationMismatches(items, snapshotRows) {
  const inv = new Map(); // itemId -> qty (assumed qty)
  for (const it of items) {
    const itemId = it?.itemId ?? it?.id;
    if (itemId === null || itemId === undefined || itemId === "") continue;
    const qty = coerceNumber(it?.qty);
    inv.set(String(itemId), qty);
  }

  const led = new Map(); // itemId -> derived qty
  for (const r of snapshotRows) {
    if (r?.itemId === null || r?.itemId === undefined || r?.itemId === "") continue;
    led.set(String(r.itemId), coerceNumber(r.derivedQty) ?? 0);
  }

  const allIds = new Set([...inv.keys(), ...led.keys()]);
  const idsSorted = Array.from(allIds).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const rows = [];
  for (const itemId of idsSorted) {
    const hasInv = inv.has(itemId);
    const hasLed = led.has(itemId);

    const inventoryQty = hasInv ? inv.get(itemId) : null;
    const ledgerQty = hasLed ? led.get(itemId) : null;

    let status = "MATCH";
    if (!hasInv && hasLed) status = "MISSING_INVENTORY";
    else if (hasInv && !hasLed) status = "MISSING_LEDGER";
    else {
      if (!isFiniteNumber(inventoryQty) || !isFiniteNumber(ledgerQty) || inventoryQty !== ledgerQty) status = "MISMATCH";
    }

    if (status !== "MATCH") {
      rows.push({
        itemId,
        status,
        inventoryQty: isFiniteNumber(inventoryQty) ? inventoryQty : "",
        ledgerQty: isFiniteNumber(ledgerQty) ? ledgerQty : "",
      });
    }
  }
  return rows;
}

function buildAnomalies(events, snapshotRows) {
  const missingItemId = [];
  const missingQtyDelta = [];
  const negativeQtyDelta = [];

  for (const ev of events) {
    const itemId = ev?.itemId;
    const qtyDelta = coerceNumber(ev?.qtyDelta);

    const base = {
      id: asString(ev?.id),
      ts: asString(ev?.ts),
      type: asString(ev?.type),
      itemId: itemId === null || itemId === undefined ? "" : asString(itemId),
      qtyDelta: qtyDelta === null ? "" : qtyDelta,
    };

    if (itemId === null || itemId === undefined || itemId === "") missingItemId.push(base);
    if (qtyDelta === null) missingQtyDelta.push(base);
    else if (qtyDelta < 0) negativeQtyDelta.push(base);
  }

  const negativeTotals = [];
  for (const r of snapshotRows) {
    const dq = coerceNumber(r?.derivedQty);
    if (dq !== null && dq < 0) negativeTotals.push({ itemId: asString(r?.itemId), derivedQty: dq });
  }

  const counts = {
    missingItemId: missingItemId.length,
    missingQtyDelta: missingQtyDelta.length,
    negativeQtyDelta: negativeQtyDelta.length,
    negativeDerivedTotals: negativeTotals.length,
  };

  return { counts, missingItemId, missingQtyDelta, negativeQtyDelta, negativeTotals };
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

  async function exportMetadata() {
    const exportTsUtc = utcNowIso();
    const buildStamp = await fetchBuildStampSafe();

    const headers = ["exportTsUtc", "tenant", "build"];
    const rows = [{ exportTsUtc, tenant: asString(devToken || ""), build: asString(buildStamp || "") }];

    downloadText(`asora_metadata_${exportTsUtc}.csv`, toCsv(headers, rows));
  }

  async function exportLedgerRaw() {
    const exportTsUtc = utcNowIso();
    const raw = await getLedgerEventsCached();
    const events = normalizeEvents(raw);

    const headers = ["id", "ts", "type", "itemId", "qtyDelta", "refType", "refId", "actor", "reason"];
    const rows = events.map((e) => ({
      id: asString(e?.id),
      ts: asString(e?.ts),
      type: asString(e?.type),
      itemId: e?.itemId === null || e?.itemId === undefined ? "" : asString(e?.itemId),
      qtyDelta: e?.qtyDelta === null || e?.qtyDelta === undefined ? "" : asString(e?.qtyDelta),
      refType: e?.refType === null || e?.refType === undefined ? "" : asString(e?.refType),
      refId: e?.refId === null || e?.refId === undefined ? "" : asString(e?.refId),
      actor: e?.actor === null || e?.actor === undefined ? "" : asString(e?.actor),
      reason: e?.reason === null || e?.reason === undefined ? "" : asString(e?.reason),
    }));

    downloadText(`asora_ledger_raw_${exportTsUtc}.csv`, toCsv(headers, rows));
  }

  async function exportSnapshotDerived() {
    const exportTsUtc = utcNowIso();
    const raw = await getLedgerEventsCached();
    const events = normalizeEvents(raw);
    const snapshot = deriveSnapshotFromEvents(events);

    const headers = ["itemId", "derivedQty"];
    const rows = snapshot.map((r) => ({ itemId: asString(r.itemId), derivedQty: r.derivedQty }));

    downloadText(`asora_snapshot_derived_${exportTsUtc}.csv`, toCsv(headers, rows));
  }

  async function exportReconciliationMismatchesOnly() {
    const exportTsUtc = utcNowIso();
    const [raw, items] = await Promise.all([getLedgerEventsCached(), fetchAllInventoryItems()]);
    const events = normalizeEvents(raw);
    const snapshot = deriveSnapshotFromEvents(events);

    const mismatches = buildReconciliationMismatches(items, snapshot);

    const headers = ["itemId", "status", "inventoryQty", "ledgerQty"];
    const rows = mismatches.map((r) => ({
      itemId: asString(r.itemId),
      status: asString(r.status),
      inventoryQty: r.inventoryQty === "" ? "" : asString(r.inventoryQty),
      ledgerQty: r.ledgerQty === "" ? "" : asString(r.ledgerQty),
    }));

    downloadText(`asora_reconciliation_mismatches_${exportTsUtc}.csv`, toCsv(headers, rows));
  }

  async function exportAnomaliesSummary() {
    const exportTsUtc = utcNowIso();
    const raw = await getLedgerEventsCached();
    const events = normalizeEvents(raw);
    const snapshot = deriveSnapshotFromEvents(events);

    const a = buildAnomalies(events, snapshot);

    const countHeaders = ["metric", "count"];
    const countRows = [
      { metric: "missingItemId", count: a.counts.missingItemId },
      { metric: "missingQtyDelta", count: a.counts.missingQtyDelta },
      { metric: "negativeQtyDelta", count: a.counts.negativeQtyDelta },
      { metric: "negativeDerivedTotals", count: a.counts.negativeDerivedTotals },
    ];

    const rowHeaders = ["kind", "id", "ts", "type", "itemId", "qtyDelta", "derivedQty"];
    const rows = [];

    for (const r of a.missingItemId) rows.push({ kind: "MISSING_ITEM_ID", ...r, derivedQty: "" });
    for (const r of a.missingQtyDelta) rows.push({ kind: "MISSING_QTY_DELTA", ...r, derivedQty: "" });
    for (const r of a.negativeQtyDelta) rows.push({ kind: "NEGATIVE_QTY_DELTA", ...r, derivedQty: "" });
    for (const r of a.negativeTotals) {
      rows.push({
        kind: "NEGATIVE_DERIVED_TOTAL",
        id: "",
        ts: "",
        type: "",
        itemId: asString(r.itemId),
        qtyDelta: "",
        derivedQty: asString(r.derivedQty),
      });
    }

    rows.sort((x, y) => {
      const kx = asString(x.kind);
      const ky = asString(y.kind);
      if (kx < ky) return -1;
      if (kx > ky) return 1;

      const tx = asString(x.ts);
      const ty = asString(y.ts);
      if (tx < ty) return -1;
      if (tx > ty) return 1;

      const ix = asString(x.id);
      const iy = asString(y.id);
      if (ix < iy) return -1;
      if (ix > iy) return 1;

      const ax = asString(x.itemId);
      const ay = asString(y.itemId);
      if (ax < ay) return -1;
      if (ax > ay) return 1;

      return 0;
    });

    const csvCounts = toCsv(countHeaders, countRows.map((r) => ({ metric: r.metric, count: r.count })));
    const csvRows = toCsv(rowHeaders, rows);

    const combined = `COUNTS\n${csvCounts}\nROWS\n${csvRows}`;
    downloadText(`asora_anomalies_${exportTsUtc}.csv`, combined);
  }

  async function exportAll() {
    setBusy(true);
    try {
      await exportMetadata();
      await exportLedgerRaw();
      await exportSnapshotDerived();
      await exportReconciliationMismatchesOnly();
      await exportAnomaliesSummary();
    } finally {
      setBusy(false);
    }
  }

  function forceRefreshLedgerCache() {
    clearLedgerCache();
  }

  return (
    <main style={styles.shell}>
      <header style={styles.header}>
        <div style={styles.brandRow}>
          <div style={styles.brand}>Asora</div>
          <div style={styles.sub}>U7 — Read-Only Integrity Exports (Evidence Mode)</div>
        </div>

        <div style={styles.metaRow}>
          <div style={styles.metaItem}>
            <span style={styles.metaLabel}>Tenant (dev_token)</span>
            <span style={styles.metaValue}>{devToken || "(none)"}</span>
          </div>
          <div style={styles.metaItem}>
            <span style={styles.metaLabel}>UTC Now</span>
            <span style={styles.metaValue}>{utcNowIso()}</span>
          </div>
        </div>
      </header>

      <section style={styles.card}>
        <div style={styles.cardTitle}>Evidence Exports</div>
        <div style={styles.note}>
          Deterministic, client-generated CSV exports. Stable column ordering. Explicit headers. Exact values only. Missing fields
          left blank.
        </div>

        <div style={styles.actions}>
          <button style={styles.primaryBtn} onClick={exportAll} disabled={busy}>
            Export All (CSV)
          </button>

          <button style={styles.btn} onClick={exportMetadata} disabled={busy}>
            Metadata (CSV)
          </button>
          <button style={styles.btn} onClick={exportLedgerRaw} disabled={busy}>
            Ledger Events — Raw (CSV)
          </button>
          <button style={styles.btn} onClick={exportSnapshotDerived} disabled={busy}>
            Inventory Snapshot — Derived (CSV)
          </button>
          <button style={styles.btn} onClick={exportReconciliationMismatchesOnly} disabled={busy}>
            Reconciliation — Mismatches Only (CSV)
          </button>
          <button style={styles.btn} onClick={exportAnomaliesSummary} disabled={busy}>
            Anomalies — Summary + Rows (CSV)
          </button>
        </div>

        <div style={styles.hr} />

        <div style={styles.row}>
          <button style={styles.mutedBtn} onClick={forceRefreshLedgerCache} disabled={busy}>
            Force Refresh (Clear Ledger Cache)
          </button>
          <div style={styles.smallNote}>Clears client-side cache only. No backend writes.</div>
        </div>
      </section>

      <section style={styles.card}>
        <div style={styles.cardTitle}>Navigation</div>
        <div style={styles.links}>
          <Link style={styles.link} href="/inventory/snapshot">
            Inventory Snapshot
          </Link>
          <Link style={styles.link} href="/inventory/reconciliation">
            Inventory Reconciliation
          </Link>
          <Link style={styles.link} href="/inventory/anomalies">
            Inventory Anomalies
          </Link>
          <Link style={styles.link} href="/inventory/item">
            Item Drill-Down
          </Link>
          <Link style={styles.linkSecondary} href="/">
            Home
          </Link>
        </div>
      </section>
    </main>
  );
}

const styles = {
  shell: {
    minHeight: "100vh",
    padding: "24px",
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"',
    background: "#0b1220",
    color: "#e5e7eb",
  },
  header: {
    maxWidth: "1100px",
    margin: "0 auto 16px auto",
    padding: "16px",
    borderRadius: "14px",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
  },
  brandRow: { display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" },
  brand: { fontSize: "20px", fontWeight: 800, letterSpacing: "0.3px" },
  sub: { fontSize: "13px", opacity: 0.8, marginTop: "6px" },

  metaRow: {
    display: "flex",
    gap: "16px",
    flexWrap: "wrap",
    marginTop: "12px",
    paddingTop: "12px",
    borderTop: "1px solid rgba(255,255,255,0.08)",
  },
  metaItem: { display: "flex", flexDirection: "column", gap: "4px" },
  metaLabel: { fontSize: "11px", opacity: 0.7 },
  metaValue: { fontSize: "13px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },

  card: {
    maxWidth: "1100px",
    margin: "0 auto 16px auto",
    padding: "16px",
    borderRadius: "14px",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
  },
  cardTitle: { fontSize: "14px", fontWeight: 700, marginBottom: "10px" },
  note: { fontSize: "12px", opacity: 0.8, marginBottom: "12px", lineHeight: 1.45 },
  smallNote: { fontSize: "12px", opacity: 0.75 },

  actions: { display: "flex", flexWrap: "wrap", gap: "10px" },
  primaryBtn: {
    padding: "10px 12px",
    borderRadius: "10px",
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(99,102,241,0.35)",
    color: "#e5e7eb",
    cursor: "pointer",
    fontWeight: 700,
  },
  btn: {
    padding: "10px 12px",
    borderRadius: "10px",
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "#e5e7eb",
    cursor: "pointer",
  },
  mutedBtn: {
    padding: "10px 12px",
    borderRadius: "10px",
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.03)",
    color: "#e5e7eb",
    cursor: "pointer",
  },

  hr: { height: "1px", background: "rgba(255,255,255,0.08)", margin: "14px 0" },
  row: { display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" },

  links: { display: "flex", flexWrap: "wrap", gap: "10px" },
  link: {
    padding: "8px 10px",
    borderRadius: "10px",
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    color: "#e5e7eb",
    textDecoration: "none",
    fontSize: "13px",
  },
  linkSecondary: {
    padding: "8px 10px",
    borderRadius: "10px",
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.02)",
    color: "#e5e7eb",
    textDecoration: "none",
    fontSize: "13px",
    opacity: 0.9,
  },
};
