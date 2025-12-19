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

function coerceFiniteNumber(x) {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string" && x.trim() !== "") {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeInventoryItemsPayload(r) {
  // Evidence-mode, best-effort:
  // - Accept items from r.items or r.data.items
  // - Normalize to { itemId, qty, raw }
  const candidates = [];
  if (Array.isArray(r?.items)) candidates.push(...r.items);
  if (Array.isArray(r?.data?.items)) candidates.push(...r.data.items);

  const out = [];
  const skipped = [];

  for (const it of candidates) {
    if (!it || typeof it !== "object") {
      skipped.push({ kind: "INVALID_ITEM_OBJECT" });
      continue;
    }

    const itemIdRaw = it.itemId ?? it.id;
    const itemId = typeof itemIdRaw === "string" ? itemIdRaw : itemIdRaw == null ? "" : String(itemIdRaw);
    if (!itemId.trim()) {
      skipped.push({ kind: "MISSING_ITEM_ID", raw: it });
      continue;
    }

    const qtyRaw = it.qty ?? it.quantity ?? it.onHand;
    const qty = coerceFiniteNumber(qtyRaw);

    out.push({ itemId, qty, raw: it });
  }

  out.sort((a, b) => {
    const c = a.itemId.localeCompare(b.itemId);
    if (c !== 0) return c;
    const ra = safeStableKey(a.raw);
    const rb = safeStableKey(b.raw);
    return ra.localeCompare(rb);
  });

  return { rows: out, skipped };
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

function deriveTotalsFromEvents(events) {
  const totals = new Map(); // itemId -> sum(qtyDelta)
  let skippedMissingItemId = 0;
  let skippedMissingQtyDelta = 0;

  for (const e of events) {
    const itemId = typeof e?.itemId === "string" ? e.itemId : "";
    if (!itemId.trim()) {
      skippedMissingItemId += 1;
      continue;
    }

    const q = coerceFiniteNumber(e?.qtyDelta);
    if (q === null) {
      skippedMissingQtyDelta += 1;
      continue;
    }

    totals.set(itemId, (totals.get(itemId) || 0) + q);
  }

  return { totals, skippedMissingItemId, skippedMissingQtyDelta };
}

function safeStableKey(x) {
  try {
    return JSON.stringify(x ?? {});
  } catch {
    return String(x ?? "");
  }
}

function safeReadLocalStorage(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}
function safeWriteLocalStorage(key, value) {
  try {
    if (!value) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

export default function InventoryReconciliationPage() {
  const { isCompact } = useDensity();
  const s = isCompact ? compact : styles;

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [filterItemId, setFilterItemId] = useState(() => safeReadLocalStorage(STORE_KEY));

  const [itemsRaw, setItemsRaw] = useState([]); // normalized inventory items {itemId, qty, raw}
  const [events, setEvents] = useState([]);

  // freshness + integrity
  const [lastFetchedUtc, setLastFetchedUtc] = useState("");
  const [cacheStatus, setCacheStatus] = useState("unknown"); // cached | fresh | unknown
  const [integrity, setIntegrity] = useState({ eventsProcessed: 0, skipped: [], renderUtc: "" });

  async function load({ force = false } = {}) {
    setLoading(true);
    setErr("");
    try {
      if (force) clearLedgerCache();

      // Inventory items (GET-only)
      const inv = await asoraGetJson("/v1/inventory/items", {});
      const invNorm = normalizeInventoryItemsPayload(inv);
      setItemsRaw(invNorm.rows);

      // Ledger events (cached per tab)
      const led = await getLedgerEventsCached(asoraGetJson);
      const sorted = normalizeLedgerEvents(led);
      setEvents(sorted);

      const now = utcNowIso();
      setLastFetchedUtc(now);
      setCacheStatus(force ? "fresh" : "cached");

      // Integrity footer: include inventory normalization skips + ledger derivation skips
      const d = deriveTotalsFromEvents(sorted);
      const skipped = [
        ...(invNorm.skipped || []),
        ...(d.skippedMissingItemId ? [{ kind: "LEDGER_MISSING_ITEM_ID", count: d.skippedMissingItemId }] : []),
        ...(d.skippedMissingQtyDelta ? [{ kind: "LEDGER_MISSING_QTY_DELTA", count: d.skippedMissingQtyDelta }] : []),
      ];
      setIntegrity({ eventsProcessed: sorted.length, skipped, renderUtc: now });
    } catch (e) {
      setErr(e?.message || "Failed to load inventory and ledger.");
      setItemsRaw([]);
      setEvents([]);
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

  const inventoryById = useMemo(() => {
    const m = new Map(); // itemId -> qty (nullable)
    for (const it of itemsRaw) {
      const id = typeof it?.itemId === "string" ? it.itemId : "";
      if (!id) continue;
      m.set(id, typeof it?.qty === "number" && Number.isFinite(it.qty) ? it.qty : null);
    }
    return m;
  }, [itemsRaw]);

  const ledgerDerived = useMemo(() => {
    const d = deriveTotalsFromEvents(events);
    return d;
  }, [events]);

  const rows = useMemo(() => {
    // Union of ids, deterministic sort by itemId
    const ids = new Set();
    for (const k of inventoryById.keys()) ids.add(k);
    for (const k of ledgerDerived.totals.keys()) ids.add(k);

    const list = Array.from(ids).sort((a, b) => a.localeCompare(b));

    return list.map((id) => {
      const hasInv = inventoryById.has(id);
      const hasLed = ledgerDerived.totals.has(id);

      const invQty = hasInv ? inventoryById.get(id) : null;
      const ledQty = hasLed ? ledgerDerived.totals.get(id) : null;

      let status = "MATCH";
      if (!hasInv && hasLed) status = "MISSING_INVENTORY";
      else if (hasInv && !hasLed) status = "MISSING_LEDGER";
      else if (hasInv && hasLed) {
        // If either side is null (missing numeric qty), treat as mismatch evidence.
        if (!(typeof invQty === "number" && Number.isFinite(invQty)) || !(typeof ledQty === "number" && Number.isFinite(ledQty)) || invQty !== ledQty) {
          status = "MISMATCH";
        }
      }

      return {
        itemId: id,
        inventoryQty: invQty,
        ledgerDerivedQty: ledQty,
        status,
      };
    });
  }, [inventoryById, ledgerDerived]);

  const filtered = useMemo(() => {
    if (!focus) return rows;
    // Exact match only (deterministic)
    return rows.filter((r) => r.itemId === focus);
  }, [rows, focus]);

  const mismatchesOnly = useMemo(() => filtered.filter((r) => r.status !== "MATCH"), [filtered]);

  function csvEscape(v) {
    const s = String(v ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function downloadCsv(filename, rows2d) {
    const content = rows2d.map((r) => r.map(csvEscape).join(",")).join("\n") + "\n";
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportMismatchesCsv() {
    const header = ["itemId", "inventoryQty", "ledgerDerivedQty", "status"];
    const body = mismatchesOnly.map((r) => [
      r.itemId,
      r.inventoryQty === null ? "" : String(r.inventoryQty),
      r.ledgerDerivedQty === null ? "" : String(r.ledgerDerivedQty),
      r.status,
    ]);
    const safe = (focus || "all").replace(/[^a-zA-Z0-9_-]/g, "_");
    downloadCsv(`asora_reconciliation_mismatches_${safe}.csv`, [header, ...body]);
  }

  function applySaved(value) {
    const v = (value || "").trim();
    setFilterItemId(v);
    safeWriteLocalStorage(STORE_KEY, v);
  }

  return (
    <main style={s.shell}>
      <AdminHeader
        title="Inventory Reconciliation"
        subtitle="Compares inventory quantities to ledger-derived totals (read-only). Deterministic union by itemId. Cached per-tab unless forced."
      >
        <LedgerFreshnessBar
          lastFetchedUtc={lastFetchedUtc}
          cacheStatus={cacheStatus}
          busy={loading}
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
                safeWriteLocalStorage(STORE_KEY, v);
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
            Rows: <span style={s.mono}>{rows.length}</span> | Focus rows: <span style={s.mono}>{filtered.length}</span> | Mismatches:{" "}
            <span style={s.mono}>{mismatchesOnly.length}</span>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <SavedViewsBar storageKey={SAVED_VIEWS_KEY} valueLabel="itemId" currentValue={focus} onApply={applySaved} />
        </div>

        {err ? <div style={s.err}>Error: {err}</div> : null}
        {rows.length === 0 && !loading ? <div style={s.empty}>No data to reconcile.</div> : null}

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
                const key = r.itemId;
                const isMismatch = r.status !== "MATCH";
                return (
                  <tr key={key}>
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
          <li>Status meanings: MATCH, MISMATCH, MISSING_INVENTORY, MISSING_LEDGER.</li>
          <li>Saved Views are local-only (localStorage) and do not affect backend behavior.</li>
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

  meta: { fontSize: 13, opacity: 0.85, paddingBottom: 2 },

  tableWrap: { width: "100%", overflowX: "auto", marginTop: 12 },
  table: { borderCollapse: "collapse", width: "100%" },
  th: { textAlign: "left", fontSize: 12, opacity: 0.85, borderBottom: "1px solid rgba(255,255,255,0.10)", padding: "10px 8px" },
  thRight: { textAlign: "right", fontSize: 12, opacity: 0.85, borderBottom: "1px solid rgba(255,255,255,0.10)", padding: "10px 8px" },
  td: { padding: "10px 8px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 13, verticalAlign: "top" },
  tdRight: { padding: "10px 8px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 13, textAlign: "right", verticalAlign: "top" },

  link: { color: "#93c5fd", textDecoration: "none", fontSize: 13 },
  muted: { opacity: 0.65 },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },

  err: { marginTop: 10, color: "#ff7b7b", fontSize: 13 },
  empty: { marginTop: 12, opacity: 0.8, fontSize: 13 },
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
