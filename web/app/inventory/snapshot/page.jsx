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

const STORE_KEY = "asora_view:snapshot:itemId";
const SAVED_VIEWS_KEY = "asora_saved_views:snapshot:itemId";

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

function stableStr(x) {
  return x === null || x === undefined ? "" : String(x);
}

export default function InventorySnapshotPage() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [filterItemId, setFilterItemId] = useState(() => safeReadLocalStorage(STORE_KEY));
  const [searchText, setSearchText] = useState("");

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

      // Items (optional metadata layer, still read-only)
      const inv = await asoraGetJson("/v1/inventory/items", {});
      const invItems = Array.isArray(inv?.items)
        ? inv.items
        : Array.isArray(inv?.data?.items)
          ? inv.data.items
          : [];
      setItems(invItems);

      // Ledger events (cached per-tab)
      const led = await getLedgerEventsCached(asoraGetJson);
      const list = Array.isArray(led?.events) ? led.events : [];

      // Deterministic order: ts asc, then ledgerEventId/eventId/id
      const sorted = [...list].sort((a, b) => {
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

      setEvents(sorted);

      const now = new Date().toISOString();
      setLastFetchedUtc(now);
      setRenderedUtc(now);
      setCacheStatus(force ? "fresh" : "cached");
    } catch (e) {
      setErr(e?.message || "Failed to load snapshot.");
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
  const q = (searchText || "").trim().toLowerCase();

  const itemsById = useMemo(() => {
    const m = new Map();
    let skippedMissingItemId = 0;

    for (const it of items) {
      const id =
        typeof it?.itemId === "string"
          ? it.itemId
          : typeof it?.id === "string"
            ? it.id
            : "";
      if (!id) {
        skippedMissingItemId += 1;
        continue;
      }
      m.set(id, it);
    }

    return { map: m, skippedMissingItemId };
  }, [items]);

  const ledgerTotals = useMemo(() => {
    const m = new Map();
    const lastTs = new Map();

    let skippedMissingItemId = 0;
    let skippedNonNumericQtyDelta = 0;

    for (const e of events) {
      const id = typeof e?.itemId === "string" ? e.itemId : "";
      if (!id) {
        skippedMissingItemId += 1;
        continue;
      }
      const d = e?.qtyDelta;
      if (!isFiniteNumber(d)) {
        skippedNonNumericQtyDelta += 1;
        continue;
      }

      m.set(id, (m.get(id) || 0) + d);

      const ts = typeof e?.ts === "string" ? e.ts : "";
      if (ts) {
        const prev = lastTs.get(id) || "";
        if (!prev || ts > prev) lastTs.set(id, ts);
      }
    }

    return { totals: m, lastTs, skippedMissingItemId, skippedNonNumericQtyDelta };
  }, [events]);

  const rows = useMemo(() => {
    // Union all ids: from items and from ledger totals
    const ids = new Set();
    for (const k of itemsById.map.keys()) ids.add(k);
    for (const k of ledgerTotals.totals.keys()) ids.add(k);

    const list = Array.from(ids).sort((a, b) => a.localeCompare(b));

    return list.map((id) => {
      const it = itemsById.map.get(id) || null;
      const name = stableStr(it?.name || it?.title || "");
      const sku = stableStr(it?.sku || "");
      const uom = stableStr(it?.uom || it?.unit || "");
      const qty = ledgerTotals.totals.has(id) ? ledgerTotals.totals.get(id) : 0;
      const lastEventTs = ledgerTotals.lastTs.get(id) || "";

      // Status is informational only; snapshot truth is ledger-derived qty.
      const status = it ? "KNOWN_ITEM" : "NO_ITEM_RECORD";

      return {
        itemId: id,
        name,
        sku,
        uom,
        qty,
        lastEventTs,
        status,
      };
    });
  }, [itemsById, ledgerTotals]);

  const filtered = useMemo(() => {
    let out = rows;
    if (focus) out = out.filter((r) => r.itemId === focus);

    if (q) {
      out = out.filter((r) => {
        const hay = [
          r.itemId,
          r.name,
          r.sku,
          r.uom,
          r.status,
          String(r.qty ?? ""),
          r.lastEventTs,
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }

    // Default view: deterministic sort by qty desc, then itemId asc
    out = [...out].sort((a, b) => {
      const qa = isFiniteNumber(a.qty) ? a.qty : 0;
      const qb = isFiniteNumber(b.qty) ? b.qty : 0;
      if (qa !== qb) return qb - qa;
      return a.itemId.localeCompare(b.itemId);
    });

    return out;
  }, [rows, focus, q]);

  function exportCsv() {
    const exportTsUtc = new Date().toISOString().replace(/[:.]/g, "-");
    const safe = (focus || "all").replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = `asora_inventory_snapshot_${safe}_${exportTsUtc}.csv`;

    const headers = ["itemId", "name", "sku", "uom", "qty", "lastEventTs", "status"];
    const rowsOut = filtered.map((r) => ({
      itemId: r.itemId,
      name: r.name,
      sku: r.sku,
      uom: r.uom,
      qty: r.qty,
      lastEventTs: r.lastEventTs,
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
    if (itemsById.skippedMissingItemId) out.push({ reason: "inventory item missing id/itemId", count: itemsById.skippedMissingItemId });
    if (ledgerTotals.skippedMissingItemId) out.push({ reason: "ledger event missing itemId", count: ledgerTotals.skippedMissingItemId });
    if (ledgerTotals.skippedNonNumericQtyDelta) out.push({ reason: "ledger event missing/non-numeric qtyDelta", count: ledgerTotals.skippedNonNumericQtyDelta });
    return out;
  }, [itemsById, ledgerTotals]);

  return (
    <main style={styles.shell}>
      <AdminHeader
        title="Inventory Snapshot"
        subtitle="Ledger-derived quantities by itemId (sum of qtyDelta). Optional item metadata is joined read-only. Deterministic sorting applied."
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
              spellCheck={false}
            />
          </label>

          <label style={styles.label}>
            Search (text)
            <input
              style={styles.input}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="name, sku, uom, qty, status…"
              spellCheck={false}
            />
          </label>

          <button style={styles.buttonSecondary} onClick={exportCsv} disabled={loading || filtered.length === 0}>
            Export CSV (current view)
          </button>

          <div style={styles.meta}>
            Total items: <span style={styles.mono}>{rows.length}</span> | Showing: <span style={styles.mono}>{filtered.length}</span>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <SavedViewsBar storageKey={SAVED_VIEWS_KEY} valueLabel="itemId" currentValue={focus} onApply={applySaved} />
        </div>

        {err ? <div style={styles.err}>Error: {err}</div> : null}
        {rows.length === 0 && !loading ? <div style={styles.empty}>No data available.</div> : null}

        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>itemId</th>
                <th style={styles.th}>name</th>
                <th style={styles.th}>sku</th>
                <th style={styles.th}>uom</th>
                <th style={styles.thRight}>qty</th>
                <th style={styles.th}>lastEventTs (UTC)</th>
                <th style={styles.th}>status</th>
                <th style={styles.th}>Links</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const hasItem = r.status === "KNOWN_ITEM";
                return (
                  <tr key={r.itemId}>
                    <td style={styles.td}>
                      <span style={styles.mono}>{r.itemId}</span>
                    </td>
                    <td style={styles.td}>{r.name || <span style={styles.muted}>—</span>}</td>
                    <td style={styles.td}>{r.sku ? <span style={styles.mono}>{r.sku}</span> : <span style={styles.muted}>—</span>}</td>
                    <td style={styles.td}>{r.uom ? <span style={styles.mono}>{r.uom}</span> : <span style={styles.muted}>—</span>}</td>
                    <td style={styles.tdRight}>
                      <span style={styles.mono}>{isFiniteNumber(r.qty) ? r.qty : 0}</span>
                    </td>
                    <td style={styles.td}>{r.lastEventTs ? <span style={styles.mono}>{r.lastEventTs}</span> : <span style={styles.muted}>—</span>}</td>
                    <td style={{ ...styles.td, ...(hasItem ? null : styles.warn) }}>{r.status}</td>
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
  warn: { color: "rgba(255,200,80,0.95)", fontWeight: 800 },
};
