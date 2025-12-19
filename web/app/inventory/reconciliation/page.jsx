"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import AdminHeader from "@/app/_ui/AdminHeader.jsx";
import CompactBar, { useDensity } from "@/app/_ui/CompactBar.jsx";
import SavedViewsBar from "@/app/ui/SavedViewsBar";
import LedgerFreshnessBar from "@/app/_ui/LedgerFreshnessBar.jsx";
import IntegrityFooter from "@/app/_ui/IntegrityFooter.jsx";

import { asoraGetJson } from "@/lib/asoraFetch";
import { clearLedgerCache, getLedgerEventsCached } from "@/lib/ledgerCache";
import { toCsv, downloadCsv } from "@/app/_ui/csv.js";

export const runtime = "edge";

const STORE_KEY = "asora_view:reconciliation:itemId";
const SAVED_VIEWS_KEY = "asora_saved_views:reconciliation:itemId";

function itemHref(itemId) {
  return `/inventory/item?itemId=${encodeURIComponent(String(itemId))}`;
}
function movementsHref(itemId) {
  return `/inventory/movements?itemId=${encodeURIComponent(String(itemId))}`;
}

function utcNowIso() {
  return new Date().toISOString();
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

function normalizeInventoryItems(raw) {
  // Best-effort shape support:
  // - { items: [...] }
  // - { data: { items: [...] } }
  // - [...]
  const candidates = [];
  if (Array.isArray(raw?.items)) candidates.push(...raw.items);
  if (Array.isArray(raw?.data?.items)) candidates.push(...raw.data.items);
  if (Array.isArray(raw)) candidates.push(...raw);

  const out = [];
  for (const it of candidates) {
    if (!it || typeof it !== "object") continue;
    const itemId = it?.itemId ?? it?.id;
    if (itemId === null || itemId === undefined) continue;
    const id = String(itemId).trim();
    if (!id) continue;

    // Quantity fields vary; prefer qty, then quantity (fallback)
    const qty = coerceNumber(it?.qty);
    const quantity = coerceNumber(it?.quantity);
    const q = qty !== null ? qty : quantity !== null ? quantity : null;

    out.push({ itemId: id, invQty: q, raw: it });
  }

  out.sort((a, b) => {
    const c = a.itemId.localeCompare(b.itemId);
    if (c !== 0) return c;
    const ra = JSON.stringify(a.raw || {});
    const rb = JSON.stringify(b.raw || {});
    return ra.localeCompare(rb);
  });

  return out;
}

function normalizeLedgerEvents(raw) {
  const list = Array.isArray(raw?.events) ? raw.events : Array.isArray(raw) ? raw : [];
  return [...list].sort((a, b) => {
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

function deriveLedgerTotals(events) {
  const m = new Map(); // itemId -> total qtyDelta
  let skippedMissingItemId = 0;
  let skippedMissingQtyDelta = 0;

  for (const e of events) {
    const itemId = e?.itemId;
    if (itemId === null || itemId === undefined || String(itemId).trim() === "") {
      skippedMissingItemId += 1;
      continue;
    }
    const q = coerceNumber(e?.qtyDelta);
    if (q === null) {
      skippedMissingQtyDelta += 1;
      continue;
    }
    const id = String(itemId);
    m.set(id, (m.get(id) || 0) + q);
  }

  return { totals: m, skippedMissingItemId, skippedMissingQtyDelta };
}

export default function InventoryReconciliationPage() {
  const { isCompact } = useDensity();
  const s = isCompact ? compact : styles;

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [filterItemId, setFilterItemId] = useState("");
  const [persistedItemId, setPersistedItemId] = useState("");

  const [invRows, setInvRows] = useState([]);
  const [events, setEvents] = useState([]);

  const [computedAtUtc, setComputedAtUtc] = useState("");

  // Freshness bar state
  const [lastFetchedUtc, setLastFetchedUtc] = useState("");
  const [cacheStatus, setCacheStatus] = useState("unknown"); // cached | fresh | unknown

  // Integrity footer state
  const [integrity, setIntegrity] = useState({
    eventsProcessed: 0,
    skipped: [],
    renderUtc: "",
  });

  // hydrate persisted focus once
  useEffect(() => {
    try {
      const v = localStorage.getItem(STORE_KEY) || "";
      setPersistedItemId(v);
      setFilterItemId(v);
    } catch {
      // ignore
    }
  }, []);

  function persist(v) {
    try {
      if (!v) localStorage.removeItem(STORE_KEY);
      else localStorage.setItem(STORE_KEY, v);
    } catch {
      // ignore
    }
  }

  async function load({ force = false } = {}) {
    setLoading(true);
    setErr("");
    try {
      if (force) clearLedgerCache();

      const [inv, led] = await Promise.all([
        asoraGetJson("/v1/inventory/items", {}),
        getLedgerEventsCached(asoraGetJson),
      ]);

      const invNorm = normalizeInventoryItems(inv);
      const ledNorm = normalizeLedgerEvents(led);

      setInvRows(invNorm);
      setEvents(ledNorm);

      const now = utcNowIso();
      setComputedAtUtc(now);
      setLastFetchedUtc(now);
      setCacheStatus(force ? "fresh" : "cached");

      // Update integrity footer baseline (processed count is ledger events seen)
      setIntegrity({
        eventsProcessed: ledNorm.length,
        skipped: [], // filled after derivation below, but always set something deterministic
        renderUtc: now,
      });
    } catch (e) {
      setErr(e?.message || "Failed to load inventory and ledger.");
      setInvRows([]);
      setEvents([]);
      setComputedAtUtc("");
      setLastFetchedUtc("");
      setCacheStatus("unknown");
      setIntegrity({ eventsProcessed: 0, skipped: [], renderUtc: utcNowIso() });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load({ force: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const focus = (filterItemId || "").trim();

  const derived = useMemo(() => {
    // Build inventory map
    const invMap = new Map();
    for (const r of invRows) invMap.set(r.itemId, r.invQty);

    // Build ledger totals
    const led = deriveLedgerTotals(events);

    // Union ids, deterministic by itemId
    const ids = new Set();
    for (const k of invMap.keys()) ids.add(k);
    for (const k of led.totals.keys()) ids.add(k);

    const list = Array.from(ids).sort((a, b) => a.localeCompare(b));

    const rows = list.map((itemId) => {
      const hasInv = invMap.has(itemId);
      const hasLed = led.totals.has(itemId);

      const inventoryQty = hasInv ? invMap.get(itemId) : null;
      const ledgerDerivedQty = hasLed ? led.totals.get(itemId) : null;

      let status = "MATCH";
      if (!hasInv && hasLed) status = "MISSING_INVENTORY";
      else if (hasInv && !hasLed) status = "MISSING_LEDGER";
      else if (!isFiniteNumber(inventoryQty) || !isFiniteNumber(ledgerDerivedQty) || inventoryQty !== ledgerDerivedQty)
        status = "MISMATCH";

      return { itemId, inventoryQty, ledgerDerivedQty, status };
    });

    const skipped = [
      { reason: "ledger event missing itemId", count: led.skippedMissingItemId },
      { reason: "ledger event missing/non-numeric qtyDelta", count: led.skippedMissingQtyDelta },
    ].filter((x) => x.count > 0);

    // Keep integrity footer in sync with deterministic derived stats
    // (no effects; we derive a computed object, then render and update on export/recompute actions)
    return { rows, skipped, ledgerEventsProcessed: events.length };
  }, [invRows, events]);

  // keep integrity footer updated when derived changes (deterministic)
  useEffect(() => {
    setIntegrity({
      eventsProcessed: derived.ledgerEventsProcessed,
      skipped: derived.skipped,
      renderUtc: utcNowIso(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derived.ledgerEventsProcessed, derived.skipped.length]);

  const filtered = useMemo(() => {
    if (!focus) return derived.rows;
    return derived.rows.filter((r) => r.itemId === focus);
  }, [derived.rows, focus]);

  const mismatchesOnly = useMemo(() => filtered.filter((r) => r.status !== "MATCH"), [filtered]);

  function exportMismatchesCsv() {
    const ts = utcNowIso().replace(/[:.]/g, "-");
    const safe = (focus || "all").replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = `asora_reconciliation_mismatches_${safe}_${ts}.csv`;

    const headers = ["itemId", "inventoryQty", "ledgerDerivedQty", "status"];
    const rows = mismatchesOnly.map((r) => ({
      itemId: r.itemId,
      inventoryQty: r.inventoryQty === null ? "" : String(r.inventoryQty),
      ledgerDerivedQty: r.ledgerDerivedQty === null ? "" : String(r.ledgerDerivedQty),
      status: r.status,
    }));

    downloadCsv(filename, toCsv(headers, rows, { bom: false }));

    setIntegrity({
      eventsProcessed: derived.ledgerEventsProcessed,
      skipped: derived.skipped,
      renderUtc: utcNowIso(),
    });
  }

  function applySaved(value) {
    const v = (value || "").trim();
    setFilterItemId(v);
    setPersistedItemId(v);
    persist(v);
  }

  return (
    <main style={s.shell}>
      <AdminHeader
        title="Reconciliation"
        subtitle="Compares inventory quantities vs ledger-derived totals (read-only). Deterministic union by itemId."
      >
        <LedgerFreshnessBar
          lastFetchedUtc={lastFetchedUtc}
          cacheStatus={cacheStatus}
          busy={loading || loading === true}
          onRefreshCached={() => load({ force: false })}
          onRefreshForce={() => load({ force: true })}
          onClearCache={() => {
            clearLedgerCache();
            setCacheStatus("unknown");
          }}
        />
      </AdminHeader>

      <CompactBar here="Reconciliation" />

      <section style={s.card}>
        <div style={s.controls}>
          <label style={s.label}>
            Focus itemId (exact)
            <input
              style={s.input}
              value={filterItemId}
              onChange={(e) => {
                const v = e.target.value;
                setFilterItemId(v);
                setPersistedItemId(v);
                persist(v);
              }}
              placeholder="e.g. ITEM-123"
            />
          </label>

          <button style={s.button} onClick={() => load({ force: false })} disabled={loading}>
            {loading ? "Recomputing..." : "Recompute (cached)"}
          </button>

          <button style={s.buttonSecondary} onClick={() => load({ force: true })} disabled={loading}>
            Recompute (force)
          </button>

          <button style={s.buttonSecondary} onClick={exportMismatchesCsv} disabled={loading || mismatchesOnly.length === 0}>
            Export mismatches CSV
          </button>

          <div style={s.meta}>
            Rows: <span style={s.mono}>{derived.rows.length}</span> | Focus rows: <span style={s.mono}>{filtered.length}</span> |
            Mismatches: <span style={s.mono}>{mismatchesOnly.length}</span>
            {computedAtUtc ? (
              <>
                {" "}
                | Computed at (UTC): <span style={s.mono}>{computedAtUtc}</span>
              </>
            ) : null}
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <SavedViewsBar storageKey={SAVED_VIEWS_KEY} valueLabel="itemId" currentValue={focus} onApply={applySaved} />
        </div>

        {err ? <div style={s.err}>Error: {err}</div> : null}
        {derived.rows.length === 0 && !loading ? <div style={s.empty}>No data to reconcile.</div> : null}

        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>itemId</th>
                <th style={s.thRight}>inventoryQty</th>
                <th style={s.thRight}>ledgerDerivedQty</th>
                <th style={s.th}>status</th>
                <th style={s.th}>Links</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const isMismatch = r.status !== "MATCH";
                return (
                  <tr key={r.itemId}>
                    <td style={s.td}>
                      <span style={s.mono}>{r.itemId}</span>
                    </td>
                    <td style={s.tdRight}>
                      <span style={s.mono}>{r.inventoryQty === null ? "—" : r.inventoryQty}</span>
                    </td>
                    <td style={s.tdRight}>
                      <span style={s.mono}>{r.ledgerDerivedQty === null ? "—" : r.ledgerDerivedQty}</span>
                    </td>
                    <td style={{ ...s.td, ...(isMismatch ? s.bad : null) }}>{r.status}</td>
                    <td style={s.td}>
                      <Link style={s.link} href={itemHref(r.itemId)}>
                        Drill-down
                      </Link>
                      <span style={s.muted}> · </span>
                      <Link style={s.link} href={movementsHref(r.itemId)}>
                        Movements
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section style={s.card}>
        <div style={s.noteTitle}>Notes</div>
        <ul style={s.ul}>
          <li>Ledger-derived totals are computed by summing numeric qtyDelta by itemId (negative allowed).</li>
          <li>Status: MATCH, MISMATCH, MISSING_INVENTORY, MISSING_LEDGER.</li>
          <li>Saved Views are local-only and do not affect backend behavior.</li>
          <li>Deterministic ordering by itemId ascending.</li>
        </ul>
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
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 14,
    padding: 16,
    background: "rgba(255,255,255,0.04)",
  },

  controls: { display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" },
  label: { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, opacity: 0.9 },
  input: {
    width: 280,
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.25)",
    color: "#e6edf3",
    outline: "none",
    fontSize: 13,
  },

  button: {
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(255,255,255,0.08)",
    color: "#e6edf3",
    cursor: "pointer",
    fontSize: 13,
    height: 34,
  },
  buttonSecondary: {
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.18)",
    color: "#e6edf3",
    cursor: "pointer",
    fontSize: 13,
    height: 34,
  },

  meta: { fontSize: 13, opacity: 0.85 },

  err: { marginTop: 10, color: "#ff7b7b", fontSize: 13 },
  empty: { marginTop: 12, opacity: 0.8, fontSize: 13 },

  tableWrap: { width: "100%", overflowX: "auto", marginTop: 12 },
  table: { borderCollapse: "collapse", width: "100%" },
  th: { textAlign: "left", fontSize: 12, opacity: 0.85, borderBottom: "1px solid rgba(255,255,255,0.10)", padding: "10px 8px" },
  thRight: { textAlign: "right", fontSize: 12, opacity: 0.85, borderBottom: "1px solid rgba(255,255,255,0.10)", padding: "10px 8px" },
  td: { padding: "10px 8px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 13, verticalAlign: "top" },
  tdRight: { padding: "10px 8px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 13, textAlign: "right", verticalAlign: "top" },

  link: { color: "#93c5fd", textDecoration: "none", fontSize: 13 },
  muted: { opacity: 0.6 },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },

  bad: { color: "#ff7b7b", fontWeight: 800 },

  noteTitle: { fontSize: 14, fontWeight: 800, marginBottom: 8 },
  ul: { margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.5, opacity: 0.9 },
};

const compact = {
  ...styles,
  shell: { ...styles.shell, padding: 12 },
  card: { ...styles.card, padding: 12, margin: "0 auto 12px auto" },
  label: { ...styles.label, fontSize: 12 },
  input: { ...styles.input, padding: "6px 8px", fontSize: 12, width: 240 },
  button: { ...styles.button, padding: "6px 10px", fontSize: 12, height: 30 },
  buttonSecondary: { ...styles.buttonSecondary, padding: "6px 10px", fontSize: 12, height: 30 },
  meta: { ...styles.meta, fontSize: 12 },
  th: { ...styles.th, padding: "8px 6px", fontSize: 11 },
  thRight: { ...styles.thRight, padding: "8px 6px", fontSize: 11 },
  td: { ...styles.td, padding: "8px 6px", fontSize: 12 },
  tdRight: { ...styles.tdRight, padding: "8px 6px", fontSize: 12 },
  noteTitle: { ...styles.noteTitle, fontSize: 13 },
  ul: { ...styles.ul, fontSize: 12 },
};
