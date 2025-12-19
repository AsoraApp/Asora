"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminHeader from "@/app/_ui/AdminHeader.jsx";
import LedgerFreshnessBar from "@/app/_ui/LedgerFreshnessBar.jsx";
import IntegrityFooter from "@/app/_ui/IntegrityFooter.jsx";
import { asoraGetJson } from "@/lib/asoraFetch";
import { clearLedgerCache, getLedgerEventsCached } from "@/lib/ledgerCache";
import { toCsv, downloadCsv } from "@/app/_ui/csv.js";
import SavedViewsBar from "@/app/ui/SavedViewsBar";

export const runtime = "edge";

const STORE_KEY = "asora_view:reconciliation:itemId";
const SAVED_VIEWS_KEY = "asora_saved_views:reconciliation:itemId";

function itemHref(itemId) {
  return `/inventory/item?itemId=${encodeURIComponent(String(itemId))}`;
}
function movementsHref(itemId) {
  return `/inventory/movements?itemId=${encodeURIComponent(String(itemId))}`;
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

function isFiniteNumber(x) {
  return typeof x === "number" && Number.isFinite(x) && !Number.isNaN(x);
}

export default function InventoryReconciliationPage() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [filterItemId, setFilterItemId] = useState(() => safeReadLocalStorage(STORE_KEY));

  const [items, setItems] = useState([]);
  const [events, setEvents] = useState([]);

  const [renderedUtc, setRenderedUtc] = useState("");
  const [lastFetchedUtc, setLastFetchedUtc] = useState("");
  const [cacheStatus, setCacheStatus] = useState("unknown"); // cached | fresh | unknown

  async function load({ force = false } = {}) {
    setLoading(true);
    setErr("");
    try {
      if (force) clearLedgerCache();

      // Inventory items (GET-only)
      const inv = await asoraGetJson("/v1/inventory/items", {});
      const invItems = Array.isArray(inv?.items) ? inv.items : Array.isArray(inv?.data?.items) ? inv.data.items : [];
      setItems(invItems);

      // Ledger events (cached per tab)
      const led = await getLedgerEventsCached(asoraGetJson);
      const list = Array.isArray(led?.events) ? led.events : [];

      // Deterministic sort: ts asc, then id
      const sorted = [...list].sort((a, b) => {
        const ta = typeof a?.ts === "string" ? a.ts : "";
        const tb = typeof b?.ts === "string" ? b.ts : "";
        if (ta < tb) return -1;
        if (ta > tb) return 1;
        const ia = typeof a?.id === "string" ? a.id : "";
        const ib = typeof b?.id === "string" ? b.id : "";
        return ia.localeCompare(ib);
      });

      setEvents(sorted);

      const now = new Date().toISOString();
      setLastFetchedUtc(now);
      setRenderedUtc(now);
      setCacheStatus(force ? "fresh" : "cached");
    } catch (e) {
      setErr(e?.message || "Failed to load inventory and ledger.");
      setItems([]);
      setEvents([]);
      setRenderedUtc(new Date().toISOString());
      setCacheStatus("unknown");
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
    const m = new Map();
    let skippedMissingItemId = 0;
    let skippedNonNumericQty = 0;

    for (const it of items) {
      const id = typeof it?.itemId === "string" ? it.itemId : typeof it?.id === "string" ? it.id : "";
      if (!id) {
        skippedMissingItemId += 1;
        continue;
      }

      const q = it?.qty ?? it?.quantity;
      const qty = typeof q === "number" && Number.isFinite(q) ? q : null;
      if (qty === null) skippedNonNumericQty += 1;

      // For reconciliation, missing qty becomes null (not guessed)
      m.set(id, qty);
    }

    return { map: m, skippedMissingItemId, skippedNonNumericQty };
  }, [items]);

  const ledgerDerivedById = useMemo(() => {
    const m = new Map();
    let skippedMissingItemId = 0;
    let skippedNonNumericQtyDelta = 0;

    for (const e of events) {
      const id = typeof e?.itemId === "string" ? e.itemId : "";
      if (!id) {
        skippedMissingItemId += 1;
        continue;
      }
      const q = e?.qtyDelta;
      if (!isFiniteNumber(q)) {
        skippedNonNumericQtyDelta += 1;
        continue;
      }
      m.set(id, (m.get(id) || 0) + q);
    }

    return { map: m, skippedMissingItemId, skippedNonNumericQtyDelta };
  }, [events]);

  const rows = useMemo(() => {
    // Union of ids, deterministic sort by itemId
    const ids = new Set();
    for (const k of inventoryById.map.keys()) ids.add(k);
    for (const k of ledgerDerivedById.map.keys()) ids.add(k);

    const list = Array.from(ids).sort((a, b) => a.localeCompare(b));

    return list.map((id) => {
      const hasInv = inventoryById.map.has(id);
      const hasLed = ledgerDerivedById.map.has(id);
      const invQty = hasInv ? inventoryById.map.get(id) : null;
      const ledQty = hasLed ? ledgerDerivedById.map.get(id) : null;

      let status = "MATCH";
      if (!hasInv && hasLed) status = "MISSING_INVENTORY";
      else if (hasInv && !hasLed) status = "MISSING_LEDGER";
      else if (hasInv && hasLed) {
        // If either side is null, we fail closed: call it MISMATCH (do not assume).
        if (!isFiniteNumber(invQty) || !isFiniteNumber(ledQty) || invQty !== ledQty) status = "MISMATCH";
      }

      return { itemId: id, inventoryQty: invQty, ledgerDerivedQty: ledQty, status };
    });
  }, [inventoryById, ledgerDerivedById]);

  const filtered = useMemo(() => {
    if (!focus) return rows;
    return rows.filter((r) => r.itemId === focus);
  }, [rows, focus]);

  const mismatchesOnly = useMemo(() => filtered.filter((r) => r.status !== "MATCH"), [filtered]);

  function exportMismatchesCsv() {
    const exportTsUtc = new Date().toISOString().replace(/[:.]/g, "-");
    const safe = (focus || "all").replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = `asora_reconciliation_mismatches_${safe}_${exportTsUtc}.csv`;

    const headers = ["itemId", "inventoryQty", "ledgerDerivedQty", "status"];
    const rowsOut = mismatchesOnly.map((r) => ({
      itemId: r.itemId,
      inventoryQty: r.inventoryQty === null ? "" : r.inventoryQty,
      ledgerDerivedQty: r.ledgerDerivedQty === null ? "" : r.ledgerDerivedQty,
      status: r.status,
    }));

    downloadCsv(filename, toCsv(headers, rowsOut, { bom: false }));
  }

  function applySaved(value) {
    const v = (value || "").trim();
    setFilterItemId(v);
    safeWriteLocalStorage(STORE_KEY, v);
  }

  const skipped = useMemo(() => {
    const out = [];
    if (inventoryById.skippedMissingItemId) out.push({ reason: "inventory item missing id/itemId", count: inventoryById.skippedMissingItemId });
    if (inventoryById.skippedNonNumericQty) out.push({ reason: "inventory item missing/non-numeric qty", count: inventoryById.skippedNonNumericQty });
    if (ledgerDerivedById.skippedMissingItemId) out.push({ reason: "ledger event missing itemId", count: ledgerDerivedById.skippedMissingItemId });
    if (ledgerDerivedById.skippedNonNumericQtyDelta) out.push({ reason: "ledger event missing/non-numeric qtyDelta", count: ledgerDerivedById.skippedNonNumericQtyDelta });
    return out;
  }, [inventoryById, ledgerDerivedById]);

  return (
    <main style={styles.shell}>
      <AdminHeader
        title="Inventory Reconciliation"
        subtitle="Compares inventory quantities to ledger-derived totals. Read-only, deterministic union by itemId."
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

      <section style={styles.card}>
        <div style={styles.controls}>
          <label style={styles.label}>
            Focus itemId (exact)
            <input
              style={styles.input}
              value={filterItemId}
              onChange={(e) => {
                const v = e.target.value;
                setFilterItemId(v);
                safeWriteLocalStorage(STORE_KEY, v);
              }}
              placeholder="e.g. ITEM-123"
            />
          </label>

          <button style={styles.buttonSecondary} onClick={exportMismatchesCsv} disabled={loading || mismatchesOnly.length === 0}>
            Export mismatches CSV
          </button>

          <div style={styles.meta}>
            Rows: <span style={styles.mono}>{rows.length}</span> | Focus rows: <span style={styles.mono}>{filtered.length}</span> | Mismatches:{" "}
            <span style={styles.mono}>{mismatchesOnly.length}</span>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <SavedViewsBar storageKey={SAVED_VIEWS_KEY} valueLabel="itemId" currentValue={focus} onApply={applySaved} />
        </div>

        {err ? <div style={styles.err}>Error: {err}</div> : null}
        {rows.length === 0 && !loading ? <div style={styles.empty}>No data to reconcile.</div> : null}

        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>itemId</th>
                <th style={styles.thRight}>inventoryQty</th>
                <th style={styles.thRight}>ledgerDerivedQty</th>
                <th style={styles.th}>status</th>
                <th style={styles.th}>Links</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const isMismatch = r.status !== "MATCH";
                return (
                  <tr key={r.itemId}>
                    <td style={styles.td}>
                      <span style={styles.mono}>{r.itemId}</span>
                    </td>
                    <td style={styles.tdRight}>
                      <span style={styles.mono}>{r.inventoryQty === null ? "—" : r.inventoryQty}</span>
                    </td>
                    <td style={styles.tdRight}>
                      <span style={styles.mono}>{r.ledgerDerivedQty === null ? "—" : r.ledgerDerivedQty}</span>
                    </td>
                    <td style={{ ...styles.td, ...(isMismatch ? styles.bad : null) }}>{r.status}</td>
                    <td style={styles.td}>
                      <Link style={styles.link} href={itemHref(r.itemId)}>
                        Drill-down
                      </Link>
                      <span style={styles.muted}> · </span>
                      <Link style={styles.link} href={movementsHref(r.itemId)}>
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

      <IntegrityFooter
        eventsProcessed={events.length}
        skipped={skipped}
        renderUtc={renderedUtc || new Date().toISOString()}
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

  controls: { display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" },
  label: { display: "flex", flexDirection: "column", gap: 6, fontSize: 12, opacity: 0.9 },
  input: {
    width: 280,
    padding: "10px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.25)",
    color: "#e6edf3",
    outline: "none",
    fontSize: 13,
  },

  buttonSecondary: {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "#e6edf3",
    cursor: "pointer",
    fontSize: 13,
    height: 40,
  },

  meta: { fontSize: 13, opacity: 0.9, paddingBottom: 2 },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },

  err: { marginTop: 10, color: "rgba(255,120,120,0.95)", fontSize: 13 },
  empty: { marginTop: 12, opacity: 0.85, fontSize: 13 },

  tableWrap: { width: "100%", overflowX: "auto", marginTop: 12 },
  table: { borderCollapse: "collapse", width: "100%" },
  th: { textAlign: "left", fontSize: 12, opacity: 0.85, borderBottom: "1px solid rgba(255,255,255,0.10)", padding: "10px 8px" },
  thRight: { textAlign: "right", fontSize: 12, opacity: 0.85, borderBottom: "1px solid rgba(255,255,255,0.10)", padding: "10px 8px" },
  td: { padding: "10px 8px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 13, verticalAlign: "top" },
  tdRight: { padding: "10px 8px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 13, textAlign: "right", verticalAlign: "top" },

  link: { color: "#9bbcff", textDecoration: "none", fontSize: 13 },
  muted: { opacity: 0.6 },
  bad: { color: "rgba(255,120,120,0.95)", fontWeight: 800 },
};
