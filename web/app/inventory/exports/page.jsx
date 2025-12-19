// web/app/inventory/exports/page.jsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import AdminHeader from "@/app/_ui/AdminHeader.jsx";
import CompactBar, { useDensity } from "@/app/_ui/CompactBar.jsx";
import LedgerFreshnessBar from "@/app/_ui/LedgerFreshnessBar.jsx";
import IntegrityFooter from "@/app/_ui/IntegrityFooter.jsx";

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
 * - Evidence-grade CSV rules:
 *   - stable columns
 *   - explicit headers
 *   - exact values
 *   - blanks for missing
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
  setTimeout(() => URL.revokeObjectURL(url), 800);
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

    const ida = asString(a?.ledgerEventId || a?.eventId || a?.id);
    const idb = asString(b?.ledgerEventId || b?.eventId || b?.id);
    if (ida < idb) return -1;
    if (ida > idb) return 1;

    // deterministic final tie-breaker
    return asString(a?.itemId).localeCompare(asString(b?.itemId));
  });
}

function deriveSnapshotFromEvents(events) {
  const totals = new Map(); // itemId -> total qtyDelta
  let skippedMissingItemId = 0;
  let skippedMissingQtyDelta = 0;

  for (const ev of events) {
    const itemId = ev?.itemId;
    const qtyDelta = coerceNumber(ev?.qtyDelta);

    if (itemId === null || itemId === undefined || itemId === "") {
      skippedMissingItemId += 1;
      continue;
    }
    if (qtyDelta === null) {
      skippedMissingQtyDelta += 1;
      continue;
    }

    const key = String(itemId);
    totals.set(key, (totals.get(key) || 0) + qtyDelta);
  }

  const rows = Array.from(totals.entries())
    .map(([itemId, derivedQty]) => ({ itemId, derivedQty }))
    .sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));

  return { rows, skippedMissingItemId, skippedMissingQtyDelta };
}

async function fetchAllInventoryItems() {
  const r = await asoraGetJson("/v1/inventory/items", {});
  const items = Array.isArray(r?.items) ? r.items : Array.isArray(r) ? r : [];
  return items;
}

function buildReconciliationMismatches(items, snapshotRows) {
  const inv = new Map(); // itemId -> qty (best-effort)
  for (const it of items) {
    const itemId = it?.itemId ?? it?.id;
    if (itemId === null || itemId === undefined || itemId === "") continue;
    const qty = coerceNumber(it?.qty ?? it?.quantity);
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
      id: asString(ev?.ledgerEventId || ev?.eventId || ev?.id),
      ts: asString(ev?.ts),
      eventType: asString(ev?.eventType || ev?.type),
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
  const { isCompact } = useDensity();
  const s = isCompact ? compact : styles;

  const devToken = useMemo(() => getStoredDevToken(), []);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // freshness + integrity footer
  const [lastFetchedUtc, setLastFetchedUtc] = useState("");
  const [cacheStatus, setCacheStatus] = useState("unknown"); // cached | fresh | unknown
  const [integrity, setIntegrity] = useState({ eventsProcessed: 0, skipped: [], renderUtc: "" });

  useEffect(() => {
    // this page does not auto-fetch; but we still stamp the render time deterministically
    setIntegrity((x) => ({ ...x, renderUtc: utcNowIso() }));
  }, []);

  async function exportMetadata() {
    const exportTsUtc = utcNowIso();
    const buildStamp = await fetchBuildStampSafe();

    const headers = ["exportTsUtc", "tenant", "build"];
    const rows = [{ exportTsUtc, tenant: asString(devToken || ""), build: asString(buildStamp || "") }];

    downloadText(`asora_metadata_${exportTsUtc}.csv`, toCsv(headers, rows));
  }

  async function exportLedgerRaw() {
    const exportTsUtc = utcNowIso();
    const raw = await getLedgerEventsCached(asoraGetJson);
    const events = normalizeEvents(raw);

    const headers = ["id", "ts", "eventType", "itemId", "qtyDelta", "refType", "refId", "actor", "reason"];
    const rows = events.map((e) => ({
      id: asString(e?.ledgerEventId || e?.eventId || e?.id),
      ts: asString(e?.ts),
      eventType: asString(e?.eventType || e?.type),
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
    const raw = await getLedgerEventsCached(asoraGetJson);
    const events = normalizeEvents(raw);
    const snapshot = deriveSnapshotFromEvents(events);

    const headers = ["itemId", "derivedQty"];
    const rows = snapshot.rows.map((r) => ({ itemId: asString(r.itemId), derivedQty: r.derivedQty }));

    downloadText(`asora_snapshot_derived_${exportTsUtc}.csv`, toCsv(headers, rows));
  }

  async function exportReconciliationMismatchesOnly() {
    const exportTsUtc = utcNowIso();
    const [raw, items] = await Promise.all([getLedgerEventsCached(asoraGetJson), fetchAllInventoryItems()]);
    const events = normalizeEvents(raw);
    const snapshot = deriveSnapshotFromEvents(events);

    const mismatches = buildReconciliationMismatches(items, snapshot.rows);

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
    const raw = await getLedgerEventsCached(asoraGetJson);
    const events = normalizeEvents(raw);
    const snapshot = deriveSnapshotFromEvents(events);

    const a = buildAnomalies(events, snapshot.rows);

    const countHeaders = ["metric", "count"];
    const countRows = [
      { metric: "missingItemId", count: a.counts.missingItemId },
      { metric: "missingQtyDelta", count: a.counts.missingQtyDelta },
      { metric: "negativeQtyDelta", count: a.counts.negativeQtyDelta },
      { metric: "negativeDerivedTotals", count: a.counts.negativeDerivedTotals },
    ];

    const rowHeaders = ["kind", "id", "ts", "eventType", "itemId", "qtyDelta", "derivedQty"];
    const rows = [];

    for (const r of a.missingItemId) rows.push({ kind: "MISSING_ITEM_ID", ...r, derivedQty: "" });
    for (const r of a.missingQtyDelta) rows.push({ kind: "MISSING_QTY_DELTA", ...r, derivedQty: "" });
    for (const r of a.negativeQtyDelta) rows.push({ kind: "NEGATIVE_QTY_DELTA", ...r, derivedQty: "" });
    for (const r of a.negativeTotals) {
      rows.push({
        kind: "NEGATIVE_DERIVED_TOTAL",
        id: "",
        ts: "",
        eventType: "",
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
    setErr("");
    try {
      // Stamp freshness once per “Export All” run
      const now = utcNowIso();
      setLastFetchedUtc(now);
      setCacheStatus("cached");
      setIntegrity((x) => ({ ...x, renderUtc: now }));

      await exportMetadata();
      await exportLedgerRaw();
      await exportSnapshotDerived();
      await exportReconciliationMismatchesOnly();
      await exportAnomaliesSummary();

      // After exporting, update integrity footer with the current cached ledger size + skips
      const raw = await getLedgerEventsCached(asoraGetJson);
      const events = normalizeEvents(raw);
      const snapshot = deriveSnapshotFromEvents(events);

      const skipped = [
        ...(snapshot.skippedMissingItemId ? [{ kind: "LEDGER_MISSING_ITEM_ID", count: snapshot.skippedMissingItemId }] : []),
        ...(snapshot.skippedMissingQtyDelta ? [{ kind: "LEDGER_MISSING_QTY_DELTA", count: snapshot.skippedMissingQtyDelta }] : []),
      ];
      setIntegrity({ eventsProcessed: events.length, skipped, renderUtc: utcNowIso() });
    } catch (e) {
      setErr(e?.message || "Export failed.");
    } finally {
      setBusy(false);
    }
  }

  function forceRefreshLedgerCache() {
    clearLedgerCache();
    setCacheStatus("unknown");
  }

  return (
    <main style={s.shell}>
      <AdminHeader
        title="Integrity Exports"
        subtitle="Evidence-grade CSV exports generated client-side from read-only inventory + ledger reads."
      >
        <LedgerFreshnessBar
          lastFetchedUtc={lastFetchedUtc}
          cacheStatus={cacheStatus}
          busy={busy}
          onRefreshCached={async () => {
            setBusy(true);
            setErr("");
            try {
              const raw = await getLedgerEventsCached(asoraGetJson);
              const events = normalizeEvents(raw);
              const snapshot = deriveSnapshotFromEvents(events);

              setLastFetchedUtc(utcNowIso());
              setCacheStatus("cached");

              const skipped = [
                ...(snapshot.skippedMissingItemId ? [{ kind: "LEDGER_MISSING_ITEM_ID", count: snapshot.skippedMissingItemId }] : []),
                ...(snapshot.skippedMissingQtyDelta ? [{ kind: "LEDGER_MISSING_QTY_DELTA", count: snapshot.skippedMissingQtyDelta }] : []),
              ];
              setIntegrity({ eventsProcessed: events.length, skipped, renderUtc: utcNowIso() });
            } catch (e) {
              setErr(e?.message || "Refresh failed.");
            } finally {
              setBusy(false);
            }
          }}
          onRefreshForce={async () => {
            setBusy(true);
            setErr("");
            try {
              clearLedgerCache();
              const raw = await getLedgerEventsCached(asoraGetJson);
              const events = normalizeEvents(raw);
              const snapshot = deriveSnapshotFromEvents(events);

              setLastFetchedUtc(utcNowIso());
              setCacheStatus("fresh");

              const skipped = [
                ...(snapshot.skippedMissingItemId ? [{ kind: "LEDGER_MISSING_ITEM_ID", count: snapshot.skippedMissingItemId }] : []),
                ...(snapshot.skippedMissingQtyDelta ? [{ kind: "LEDGER_MISSING_QTY_DELTA", count: snapshot.skippedMissingQtyDelta }] : []),
              ];
              setIntegrity({ eventsProcessed: events.length, skipped, renderUtc: utcNowIso() });
            } catch (e) {
              setErr(e?.message || "Force refresh failed.");
            } finally {
              setBusy(false);
            }
          }}
          onClearCache={forceRefreshLedgerCache}
        />
      </AdminHeader>

      <CompactBar here="Exports" />

      <section style={s.card}>
        <div style={s.metaRow}>
          <div style={s.metaItem}>
            <div style={s.metaLabel}>Tenant (dev_token)</div>
            <div style={s.metaValue}>{devToken || "(none)"}</div>
          </div>
          <div style={s.metaItem}>
            <div style={s.metaLabel}>UTC Now</div>
            <div style={s.metaValue}>{utcNowIso()}</div>
          </div>
        </div>

        {err ? <div style={s.err}>Error: {err}</div> : null}

        <div style={s.cardTitle}>Evidence Exports</div>
        <div style={s.note}>
          Deterministic, client-generated CSV exports. Stable column ordering. Explicit headers. Exact values only. Missing fields
          left blank.
        </div>

        <div style={s.actions}>
          <button style={s.primaryBtn} onClick={exportAll} disabled={busy}>
            Export All (CSV)
          </button>

          <button style={s.btn} onClick={exportMetadata} disabled={busy}>
            Metadata (CSV)
          </button>
          <button style={s.btn} onClick={exportLedgerRaw} disabled={busy}>
            Ledger Events — Raw (CSV)
          </button>
          <button style={s.btn} onClick={exportSnapshotDerived} disabled={busy}>
            Inventory Snapshot — Derived (CSV)
          </button>
          <button style={s.btn} onClick={exportReconciliationMismatchesOnly} disabled={busy}>
            Reconciliation — Mismatches Only (CSV)
          </button>
          <button style={s.btn} onClick={exportAnomaliesSummary} disabled={busy}>
            Anomalies — Summary + Rows (CSV)
          </button>
        </div>

        <div style={s.hr} />

        <div style={s.row}>
          <button style={s.mutedBtn} onClick={forceRefreshLedgerCache} disabled={busy}>
            Clear Ledger Cache (client-only)
          </button>
          <div style={s.smallNote}>Clears in-tab cache only. No backend writes.</div>
        </div>
      </section>

      <section style={s.card}>
        <div style={s.cardTitle}>Navigation</div>
        <div style={s.links}>
          <Link style={s.link} href="/inventory/snapshot">
            Inventory Snapshot
          </Link>
          <Link style={s.link} href="/inventory/reconciliation">
            Inventory Reconciliation
          </Link>
          <Link style={s.link} href="/inventory/anomalies">
            Inventory Anomalies
          </Link>
          <Link style={s.link} href="/inventory/item">
            Item Drill-down
          </Link>
          <Link style={s.linkSecondary} href="/">
            Home
          </Link>
        </div>
      </section>

      <IntegrityFooter eventsProcessed={integrity.eventsProcessed} skipped={integrity.skipped} renderUtc={integrity.renderUtc} />
    </main>
  );
}

const styles = {
  shell: { minHeight: "100vh", padding: 16, background: "#0b0f14", color: "#e6edf3" },

  card: {
    maxWidth: 1200,
    margin: "0 auto 14px auto",
    padding: 16,
    borderRadius: 14,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.10)",
  },

  metaRow: { display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 },
  metaItem: { display: "flex", flexDirection: "column", gap: 4 },
  metaLabel: { fontSize: 11, opacity: 0.7 },
  metaValue: { fontSize: 13, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },

  err: { marginBottom: 12, color: "#ff7b7b", fontSize: 13 },

  cardTitle: { fontSize: 14, fontWeight: 800, marginBottom: 10 },
  note: { fontSize: 12, opacity: 0.8, marginBottom: 12, lineHeight: 1.45 },
  smallNote: { fontSize: 12, opacity: 0.75 },

  actions: { display: "flex", flexWrap: "wrap", gap: 10 },

  primaryBtn: {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(99,102,241,0.35)",
    color: "#e6edf3",
    cursor: "pointer",
    fontWeight: 800,
  },
  btn: {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "#e6edf3",
    cursor: "pointer",
  },
  mutedBtn: {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.18)",
    color: "#e6edf3",
    cursor: "pointer",
  },

  hr: { height: 1, background: "rgba(255,255,255,0.08)", margin: "14px 0" },
  row: { display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" },

  links: { display: "flex", flexWrap: "wrap", gap: 10 },
  link: {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    color: "#e6edf3",
    textDecoration: "none",
    fontSize: 13,
  },
  linkSecondary: {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.02)",
    color: "#e6edf3",
    textDecoration: "none",
    fontSize: 13,
    opacity: 0.9,
  },
};

const compact = {
  ...styles,
  shell: { ...styles.shell, padding: 12 },
  card: { ...styles.card, padding: 12, margin: "0 auto 12px auto" },
  btn: { ...styles.btn, padding: "8px 10px", fontSize: 12 },
  primaryBtn: { ...styles.primaryBtn, padding: "8px 10px", fontSize: 12 },
  mutedBtn: { ...styles.mutedBtn, padding: "8px 10px", fontSize: 12 },
  link: { ...styles.link, fontSize: 12 },
  linkSecondary: { ...styles.linkSecondary, fontSize: 12 },
};
