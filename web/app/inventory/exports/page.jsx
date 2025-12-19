"use client";

import { useMemo, useState } from "react";
import AdminHeader from "@/app/_ui/AdminHeader.jsx";
import LedgerFreshnessBar from "@/app/_ui/LedgerFreshnessBar.jsx";
import IntegrityFooter from "@/app/_ui/IntegrityFooter.jsx";
import { asoraGetJson, getStoredDevToken } from "@/lib/asoraFetch";
import { clearLedgerCache, getLedgerEventsCached } from "@/lib/ledgerCache";
import { toCsv, downloadCsv } from "@/app/_ui/csv.js";

export const runtime = "edge";

/**
 * U7 exports page — rewired for U8:
 * - Unified header/nav via AdminHeader
 * - Standard CSV via /_ui/csv.js
 * - Unified cache/freshness bar
 * - Integrity footer (read-only QA)
 *
 * No backend changes. No new endpoints. No writes.
 */

function utcNowIso() {
  return new Date().toISOString();
}

function stableStr(x) {
  if (x === null || x === undefined) return "";
  if (typeof x === "string") return x;
  if (typeof x === "number" || typeof x === "boolean") return String(x);
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}

function coerceNumber(x) {
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (typeof x === "string" && x.trim() !== "") {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isFiniteNumber(x) {
  return typeof x === "number" && Number.isFinite(x) && !Number.isNaN(x);
}

function normalizeEvents(raw) {
  const events = Array.isArray(raw?.events) ? raw.events : Array.isArray(raw) ? raw : [];
  return [...events].sort((a, b) => {
    const ta = typeof a?.ts === "string" ? a.ts : "";
    const tb = typeof b?.ts === "string" ? b.ts : "";
    if (ta < tb) return -1;
    if (ta > tb) return 1;

    const ida =
      (typeof a?.ledgerEventId === "string" && a.ledgerEventId) ||
      (typeof a?.eventId === "string" && a.eventId) ||
      (typeof a?.id === "string" && a.id) ||
      "";
    const idb =
      (typeof b?.ledgerEventId === "string" && b.ledgerEventId) ||
      (typeof b?.eventId === "string" && b.eventId) ||
      (typeof b?.id === "string" && b.id) ||
      "";
    return ida.localeCompare(idb);
  });
}

function deriveSnapshotFromEvents(events) {
  const totals = new Map(); // itemId -> total qtyDelta
  let skippedMissingItemId = 0;
  let skippedNonNumericQtyDelta = 0;

  for (const ev of events) {
    const itemId = ev?.itemId;
    const hasItemId = itemId !== null && itemId !== undefined && String(itemId).trim() !== "";
    if (!hasItemId) {
      skippedMissingItemId += 1;
      continue;
    }

    const qtyDelta = coerceNumber(ev?.qtyDelta);
    if (qtyDelta === null) {
      skippedNonNumericQtyDelta += 1;
      continue;
    }

    const key = String(itemId);
    totals.set(key, (totals.get(key) || 0) + qtyDelta);
  }

  const rows = Array.from(totals.entries())
    .map(([itemId, derivedQty]) => ({ itemId, derivedQty }))
    .sort((a, b) => a.itemId.localeCompare(b.itemId));

  return { rows, skippedMissingItemId, skippedNonNumericQtyDelta };
}

function buildReconciliationMismatches(items, snapshotRows) {
  const inv = new Map(); // itemId -> qty (best-effort)
  for (const it of items) {
    const itemId = it?.itemId ?? it?.id;
    if (itemId === null || itemId === undefined || String(itemId).trim() === "") continue;
    const qty = coerceNumber(it?.qty);
    inv.set(String(itemId), qty);
  }

  const led = new Map(); // itemId -> derived qty
  for (const r of snapshotRows) {
    if (!r?.itemId) continue;
    led.set(String(r.itemId), coerceNumber(r.derivedQty) ?? 0);
  }

  const allIds = new Set([...inv.keys(), ...led.keys()]);
  const idsSorted = Array.from(allIds).sort((a, b) => a.localeCompare(b));

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

    const row = {
      id: stableStr(ev?.ledgerEventId || ev?.eventId || ev?.id || ""),
      ts: stableStr(ev?.ts || ""),
      eventType: stableStr(ev?.eventType || ev?.type || ""),
      itemId: itemId === null || itemId === undefined ? "" : stableStr(itemId),
      qtyDelta: qtyDelta === null ? "" : qtyDelta,
    };

    if (row.itemId === "") missingItemId.push(row);
    if (qtyDelta === null) missingQtyDelta.push(row);
    else if (qtyDelta < 0) negativeQtyDelta.push(row);
  }

  const negativeTotals = [];
  for (const r of snapshotRows) {
    const dq = coerceNumber(r?.derivedQty);
    if (dq !== null && dq < 0) negativeTotals.push({ itemId: stableStr(r?.itemId), derivedQty: dq });
  }

  // Deterministic row ordering for evidence output
  function sortRows(list) {
    return [...list].sort((a, b) => {
      const ta = stableStr(a.ts);
      const tb = stableStr(b.ts);
      if (ta < tb) return -1;
      if (ta > tb) return 1;
      const ia = stableStr(a.id);
      const ib = stableStr(b.id);
      if (ia < ib) return -1;
      if (ia > ib) return 1;
      const xa = stableStr(a.itemId);
      const xb = stableStr(b.itemId);
      return xa.localeCompare(xb);
    });
  }

  return {
    counts: {
      missingItemId: missingItemId.length,
      missingQtyDelta: missingQtyDelta.length,
      negativeQtyDelta: negativeQtyDelta.length,
      negativeDerivedTotals: negativeTotals.length,
    },
    missingItemId: sortRows(missingItemId),
    missingQtyDelta: sortRows(missingQtyDelta),
    negativeQtyDelta: sortRows(negativeQtyDelta),
    negativeTotals: [...negativeTotals].sort((a, b) => a.itemId.localeCompare(b.itemId)),
  };
}

async function fetchBuildStampSafe() {
  try {
    const r = await asoraGetJson("/__build", {});
    return stableStr(r?.build || r?.BUILD || r?.stamp || r?.version || "");
  } catch {
    return "";
  }
}

async function fetchAllInventoryItems() {
  const r = await asoraGetJson("/v1/inventory/items", {});
  const items = Array.isArray(r?.items) ? r.items : Array.isArray(r?.data?.items) ? r.data.items : Array.isArray(r) ? r : [];
  return items;
}

export default function InventoryExportsPage() {
  const devToken = useMemo(() => getStoredDevToken(), []);

  const [busy, setBusy] = useState(false);
  const [loadingData, setLoadingData] = useState(false);

  const [events, setEvents] = useState([]);
  const [items, setItems] = useState([]);

  const [lastFetchedUtc, setLastFetchedUtc] = useState("");
  const [cacheStatus, setCacheStatus] = useState("unknown"); // cached | fresh | unknown
  const [renderedUtc, setRenderedUtc] = useState(utcNowIso());

  const [lastIntegrity, setLastIntegrity] = useState({
    eventsProcessed: 0,
    skipped: [],
    renderUtc: "",
  });

  async function ensureData({ force = false, includeItems = false } = {}) {
    setLoadingData(true);
    try {
      if (force) clearLedgerCache();

      const raw = await getLedgerEventsCached(asoraGetJson);
      const normalized = normalizeEvents(raw);
      setEvents(normalized);

      if (includeItems) {
        const invItems = await fetchAllInventoryItems();
        setItems(invItems);
      }

      const now = utcNowIso();
      setLastFetchedUtc(now);
      setRenderedUtc(now);
      setCacheStatus(force ? "fresh" : "cached");

      return { events: normalized };
    } finally {
      setLoadingData(false);
    }
  }

  function updateIntegrity({ processed, skipped }) {
    const now = utcNowIso();
    setLastIntegrity({
      eventsProcessed: processed,
      skipped: skipped || [],
      renderUtc: now,
    });
    setRenderedUtc(now);
  }

  async function exportMetadata() {
    const exportTsUtc = utcNowIso();
    const buildStamp = await fetchBuildStampSafe();

    const headers = ["exportTsUtc", "tenant", "build"];
    const rows = [
      {
        exportTsUtc,
        tenant: stableStr(devToken || ""),
        build: stableStr(buildStamp || ""),
      },
    ];

    downloadCsv(`asora_metadata_${exportTsUtc.replace(/[:.]/g, "-")}.csv`, toCsv(headers, rows, { bom: false }));
    updateIntegrity({ processed: events.length || 0, skipped: [] });
  }

  async function exportLedgerRaw() {
    const exportTsUtc = utcNowIso();
    const { events: evs } = await ensureData({ force: false, includeItems: false });

    const headers = ["id", "ts", "eventType", "itemId", "qtyDelta", "tenantId", "refType", "refId", "actor", "reason"];
    const rows = evs.map((e) => ({
      id: stableStr(e?.ledgerEventId || e?.eventId || e?.id || ""),
      ts: stableStr(e?.ts || ""),
      eventType: stableStr(e?.eventType || e?.type || ""),
      itemId: e?.itemId === null || e?.itemId === undefined ? "" : stableStr(e?.itemId),
      qtyDelta: e?.qtyDelta === null || e?.qtyDelta === undefined ? "" : stableStr(e?.qtyDelta),
      tenantId: stableStr(e?.tenantId || ""),
      refType: stableStr(e?.refType || ""),
      refId: stableStr(e?.refId || ""),
      actor: stableStr(e?.actor || ""),
      reason: stableStr(e?.reason || ""),
    }));

    downloadCsv(`asora_ledger_raw_${exportTsUtc.replace(/[:.]/g, "-")}.csv`, toCsv(headers, rows, { bom: false }));

    updateIntegrity({ processed: evs.length, skipped: [] });
  }

  async function exportSnapshotDerived() {
    const exportTsUtc = utcNowIso();
    const { events: evs } = await ensureData({ force: false, includeItems: false });

    const snap = deriveSnapshotFromEvents(evs);
    const headers = ["itemId", "derivedQty"];
    const rows = snap.rows.map((r) => ({ itemId: stableStr(r.itemId), derivedQty: r.derivedQty }));

    downloadCsv(`asora_snapshot_derived_${exportTsUtc.replace(/[:.]/g, "-")}.csv`, toCsv(headers, rows, { bom: false }));

    updateIntegrity({
      processed: evs.length,
      skipped: [
        { reason: "ledger event missing itemId", count: snap.skippedMissingItemId },
        { reason: "ledger event missing/non-numeric qtyDelta", count: snap.skippedNonNumericQtyDelta },
      ].filter((x) => x.count > 0),
    });
  }

  async function exportReconciliationMismatchesOnly() {
    const exportTsUtc = utcNowIso();
    // Reconciliation requires inventory items + ledger events
    const [ledRes, invItems] = await Promise.all([
      ensureData({ force: false, includeItems: false }),
      fetchAllInventoryItems(),
    ]);

    setItems(invItems);

    const evs = ledRes.events;
    const snap = deriveSnapshotFromEvents(evs);
    const mismatches = buildReconciliationMismatches(invItems, snap.rows);

    const headers = ["itemId", "status", "inventoryQty", "ledgerQty"];
    const rows = mismatches.map((r) => ({
      itemId: stableStr(r.itemId),
      status: stableStr(r.status),
      inventoryQty: r.inventoryQty === "" ? "" : stableStr(r.inventoryQty),
      ledgerQty: r.ledgerQty === "" ? "" : stableStr(r.ledgerQty),
    }));

    downloadCsv(
      `asora_reconciliation_mismatches_${exportTsUtc.replace(/[:.]/g, "-")}.csv`,
      toCsv(headers, rows, { bom: false })
    );

    updateIntegrity({
      processed: evs.length,
      skipped: [
        { reason: "ledger event missing itemId", count: snap.skippedMissingItemId },
        { reason: "ledger event missing/non-numeric qtyDelta", count: snap.skippedNonNumericQtyDelta },
      ].filter((x) => x.count > 0),
    });
  }

  async function exportAnomaliesSummary() {
    const exportTsUtc = utcNowIso();
    const { events: evs } = await ensureData({ force: false, includeItems: false });

    const snap = deriveSnapshotFromEvents(evs);
    const a = buildAnomalies(evs, snap.rows);

    // COUNTS CSV
    const countHeaders = ["metric", "count"];
    const countRows = [
      { metric: "missingItemId", count: a.counts.missingItemId },
      { metric: "missingQtyDelta", count: a.counts.missingQtyDelta },
      { metric: "negativeQtyDelta", count: a.counts.negativeQtyDelta },
      { metric: "negativeDerivedTotals", count: a.counts.negativeDerivedTotals },
    ];

    // ROWS CSV
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
        itemId: stableStr(r.itemId),
        qtyDelta: "",
        derivedQty: stableStr(r.derivedQty),
      });
    }

    // Single evidence file pattern from U7: deterministic and explicit sections.
    const countsCsv = toCsv(countHeaders, countRows, { bom: false });
    const rowsCsv = toCsv(rowHeaders, rows, { bom: false });
    const combined = `COUNTS\n${countsCsv}\nROWS\n${rowsCsv}`;

    downloadCsv(`asora_anomalies_${exportTsUtc.replace(/[:.]/g, "-")}.csv`, combined);

    updateIntegrity({
      processed: evs.length,
      skipped: [
        { reason: "ledger event missing itemId", count: snap.skippedMissingItemId },
        { reason: "ledger event missing/non-numeric qtyDelta", count: snap.skippedNonNumericQtyDelta },
      ].filter((x) => x.count > 0),
    });
  }

  async function exportAll() {
    setBusy(true);
    try {
      // Warm cache deterministically for this run
      await ensureData({ force: false, includeItems: true });

      await exportMetadata();
      await exportLedgerRaw();
      await exportSnapshotDerived();
      await exportReconciliationMismatchesOnly();
      await exportAnomaliesSummary();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={styles.shell}>
      <AdminHeader
        title="Integrity Exports"
        subtitle="Evidence-grade CSV exports (client-generated). Stable headers, deterministic ordering, UTC timestamps. No writes."
      >
        <LedgerFreshnessBar
          lastFetchedUtc={lastFetchedUtc}
          cacheStatus={cacheStatus}
          busy={loadingData || busy}
          onRefreshCached={() => ensureData({ force: false, includeItems: true })}
          onRefreshForce={() => ensureData({ force: true, includeItems: true })}
          onClearCache={() => {
            clearLedgerCache();
            setCacheStatus("unknown");
          }}
        />
      </AdminHeader>

      <section style={styles.card}>
        <div style={styles.grid}>
          <div style={styles.kv}>
            <div style={styles.k}>Tenant (dev_token)</div>
            <div style={styles.vMono}>{devToken || "(none)"}</div>
          </div>

          <div style={styles.kv}>
            <div style={styles.k}>UTC now</div>
            <div style={styles.vMono}>{utcNowIso()}</div>
          </div>

          <div style={styles.kv}>
            <div style={styles.k}>Loaded</div>
            <div style={styles.vMono}>
              events={events.length} / items={Array.isArray(items) ? items.length : 0}
            </div>
          </div>
        </div>

        <div style={styles.hr} />

        <div style={styles.actions}>
          <button style={styles.primaryBtn} onClick={exportAll} disabled={busy || loadingData}>
            Export All (CSV)
          </button>

          <button style={styles.btn} onClick={exportMetadata} disabled={busy}>
            Metadata (CSV)
          </button>

          <button style={styles.btn} onClick={exportLedgerRaw} disabled={busy || loadingData}>
            Ledger Events — Raw (CSV)
          </button>

          <button style={styles.btn} onClick={exportSnapshotDerived} disabled={busy || loadingData}>
            Inventory Snapshot — Derived (CSV)
          </button>

          <button style={styles.btn} onClick={exportReconciliationMismatchesOnly} disabled={busy || loadingData}>
            Reconciliation — Mismatches Only (CSV)
          </button>

          <button style={styles.btn} onClick={exportAnomaliesSummary} disabled={busy || loadingData}>
            Anomalies — Summary + Rows (CSV)
          </button>
        </div>

        <div style={styles.note}>
          All exports are client-generated. Column ordering is stable and centralized via the shared CSV utility. Deterministic row
          ordering is enforced by sorting rules inside each export path.
        </div>
      </section>

      <IntegrityFooter
        eventsProcessed={lastIntegrity.eventsProcessed}
        skipped={lastIntegrity.skipped}
        renderUtc={lastIntegrity.renderUtc || renderedUtc || utcNowIso()}
      />
    </main>
  );
}

const styles = {
  shell: { minHeight: "100vh", background: "#0b0f14", padding: 16 },

  card: {
    maxWidth: 1200,
    margin: "0 auto 14px auto",
    padding: 16,
    borderRadius: 14,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.10)",
    color: "#e6edf3",
  },

  grid: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 },
  kv: {
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(0,0,0,0.18)",
    borderRadius: 12,
    padding: 12,
  },
  k: { fontSize: 12, opacity: 0.75, marginBottom: 6 },
  vMono: { fontSize: 13, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },

  hr: { height: 1, background: "rgba(255,255,255,0.08)", margin: "14px 0" },

  actions: { display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" },

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

  note: { marginTop: 12, fontSize: 12, opacity: 0.8, lineHeight: 1.45 },
};
