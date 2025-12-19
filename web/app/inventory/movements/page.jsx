"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import AdminHeader from "@/app/_ui/AdminHeader.jsx";
import CompactBar, { useDensity } from "@/app/_ui/CompactBar.jsx";
import SavedViewsBar from "@/app/ui/SavedViewsBar";
import LedgerFreshnessBar from "@/app/_ui/LedgerFreshnessBar.jsx";
import IntegrityFooter from "@/app/_ui/IntegrityFooter.jsx";

import { asoraGetJson } from "@/lib/asoraFetch";
import { clearLedgerCache, getLedgerEventsCached } from "@/lib/ledgerCache";

export const runtime = "edge";

const LAST_STORE_KEY = "asora_view:movements:lastItemId"; // remembers what user typed, but NOT auto-applied on first load
const SAVED_VIEWS_KEY = "asora_saved_views:movements:focusItemId";
const PAGE_SIZE = 200;

function itemHref(itemId) {
  return `/inventory/item?itemId=${encodeURIComponent(String(itemId))}`;
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

function utcNowIso() {
  return new Date().toISOString();
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

export default function InventoryMovementsPage() {
  const { isCompact } = useDensity();
  const s = isCompact ? compact : styles;

  const sp = useSearchParams();
  const qpItemId = (sp?.get("itemId") || "").trim();

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [events, setEvents] = useState([]);

  // Filter starts blank unless query param is present
  const [filterItemId, setFilterItemId] = useState("");

  // “last typed” value is shown but NOT auto-applied on first load
  const [lastTypedItemId, setLastTypedItemId] = useState("");

  // Deterministic paging state (reset when focus changes)
  const [page, setPage] = useState(1);

  // freshness + integrity
  const [lastFetchedUtc, setLastFetchedUtc] = useState("");
  const [cacheStatus, setCacheStatus] = useState("unknown"); // cached | fresh | unknown
  const [integrity, setIntegrity] = useState({ eventsProcessed: 0, skipped: [], renderUtc: "" });

  useEffect(() => {
    // hydrate “last typed” once (display only)
    const v = safeReadLocalStorage(LAST_STORE_KEY);
    if (v) setLastTypedItemId(v);
  }, []);

  // Query param wins whenever present/changes (deliberate deep-linking)
  useEffect(() => {
    if (qpItemId) {
      setFilterItemId(qpItemId);
      setPage(1);
    }
  }, [qpItemId]);

  async function load({ force = false } = {}) {
    setLoading(true);
    setErr("");
    try {
      if (force) clearLedgerCache();

      const raw = await getLedgerEventsCached(asoraGetJson);
      const sorted = normalizeLedgerEvents(raw);

      setEvents(sorted);

      const now = utcNowIso();
      setLastFetchedUtc(now);
      setCacheStatus(force ? "fresh" : "cached");
      setIntegrity({ eventsProcessed: sorted.length, skipped: [], renderUtc: now });
    } catch (e) {
      setErr(e?.message || "Failed to load ledger events.");
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

  const filtered = useMemo(() => {
    if (!focus) return events;
    return events.filter((e) => typeof e?.itemId === "string" && e.itemId === focus);
  }, [events, focus]);

  useEffect(() => {
    setPage(1);
  }, [focus]);

  const pageCount = useMemo(() => Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)), [filtered.length]);

  const visible = useMemo(() => {
    const end = Math.min(filtered.length, page * PAGE_SIZE);
    return filtered.slice(0, end);
  }, [filtered, page]);

  function applySaved(value) {
    const v = (value || "").trim();
    setFilterItemId(v);
    setPage(1);

    // applying a saved view counts as deliberate usage; update “last typed”
    setLastTypedItemId(v);
    safeWriteLocalStorage(LAST_STORE_KEY, v);
  }

  function applyLastTyped() {
    const v = (lastTypedItemId || "").trim();
    setFilterItemId(v);
    setPage(1);
  }

  return (
    <main style={s.shell}>
      <AdminHeader
        title="Inventory Movements"
        subtitle="Chronological, ledger-derived movement timeline (read-only). Optional itemId filter. Cached per-tab unless forced."
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

      <CompactBar here="Movements" />

      <section style={s.card}>
        <div style={s.controls}>
          <label style={s.label}>
            Filter by itemId
            <input
              style={s.input}
              value={filterItemId}
              onChange={(e) => {
                const v = e.target.value;
                setFilterItemId(v);
                setPage(1);

                // typing is deliberate; remember as “last typed”
                setLastTypedItemId(v);
                safeWriteLocalStorage(LAST_STORE_KEY, v);
              }}
              placeholder="e.g. ITEM-123"
            />
          </label>

          <button style={s.button} onClick={() => load({ force: false })} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh (cached)"}
          </button>

          <button style={s.buttonSecondary} onClick={() => load({ force: true })} disabled={loading}>
            Refresh (force)
          </button>

          {lastTypedItemId && !focus ? (
            <button style={s.buttonSecondary} onClick={applyLastTyped} title="Applies the last value you typed previously">
              Use last ({lastTypedItemId})
            </button>
          ) : null}

          {focus ? (
            <div style={s.quickLinks}>
              <Link style={s.link} href={itemHref(focus)}>
                Drill-down for {focus}
              </Link>
            </div>
          ) : null}

          <div style={s.meta}>
            Rows: <span style={s.mono}>{filtered.length}</span> | Showing:{" "}
            <span style={s.mono}>{visible.length}</span> | Page size: <span style={s.mono}>{PAGE_SIZE}</span>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <SavedViewsBar storageKey={SAVED_VIEWS_KEY} valueLabel="focus itemId" currentValue={focus} onApply={applySaved} />
        </div>

        {err ? <div style={s.err}>Error: {err}</div> : null}
        {filtered.length === 0 && !loading ? <div style={s.empty}>No movements to display.</div> : null}

        {filtered.length > 0 ? (
          <div style={s.pagerRow}>
            <button style={s.pagerBtn} onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              Prev
            </button>
            <div style={s.pagerText}>
              Page <span style={s.mono}>{page}</span> / <span style={s.mono}>{pageCount}</span>
            </div>
            <button style={s.pagerBtn} onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page >= pageCount}>
              Next
            </button>
            <button style={s.pagerBtnSecondary} onClick={() => setPage(pageCount)} disabled={page >= pageCount} title="Jump to last page">
              End
            </button>
          </div>
        ) : null}

        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>ts</th>
                <th style={s.th}>itemId</th>
                <th style={s.thRight}>qtyDelta</th>
                <th style={s.th}>eventType</th>
                <th style={s.th}>Links</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e, idx) => {
                const itemId = typeof e?.itemId === "string" ? e.itemId : "";
                const q = e?.qtyDelta;
                const neg = typeof q === "number" && q < 0;
                const ts = typeof e?.ts === "string" ? e.ts : "—";
                const eventType = typeof e?.eventType === "string" ? e.eventType : "—";
                const key =
                  (typeof e?.ledgerEventId === "string" && e.ledgerEventId) ||
                  (typeof e?.eventId === "string" && e.eventId) ||
                  (typeof e?.id === "string" && e.id) ||
                  `${ts}:${itemId}:${idx}`;

                return (
                  <tr key={key}>
                    <td style={s.td}>
                      <span style={s.mono}>{ts}</span>
                    </td>
                    <td style={s.td}>{itemId ? <span style={s.mono}>{itemId}</span> : <span style={s.muted}>—</span>}</td>
                    <td style={{ ...s.tdRight, ...(neg ? s.neg : null) }}>
                      <span style={s.mono}>{typeof q === "number" ? q : "—"}</span>
                    </td>
                    <td style={s.td}>{eventType}</td>
                    <td style={s.td}>
                      {itemId ? (
                        <Link style={s.link} href={itemHref(itemId)}>
                          Drill-down
                        </Link>
                      ) : (
                        <span style={s.muted}>—</span>
                      )}
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
          <li>Sorting is deterministic: ts ascending, then ledgerEventId/eventId/id.</li>
          <li>Cached refresh avoids re-downloading ledger events across views in the same tab.</li>
          <li>Force refresh explicitly clears the cache and re-fetches.</li>
          <li>Last typed filter is remembered locally but is not auto-applied on first load.</li>
          <li>Saved Views are local-only (localStorage) and do not affect backend behavior.</li>
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

  quickLinks: { fontSize: 13, paddingBottom: 2 },
  link: { color: "#93c5fd", textDecoration: "none", fontSize: 13 },

  meta: { fontSize: 13, opacity: 0.85, paddingBottom: 2 },

  pagerRow: { marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  pagerBtn: {
    padding: "6px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.06)",
    color: "#e6edf3",
    cursor: "pointer",
    fontSize: 13,
  },
  pagerBtnSecondary: {
    padding: "6px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.18)",
    color: "#e6edf3",
    cursor: "pointer",
    fontSize: 13,
  },
  pagerText: { fontSize: 13, opacity: 0.85 },

  err: { marginTop: 10, color: "#ff7b7b", fontSize: 13 },
  empty: { marginTop: 12, opacity: 0.8, fontSize: 13 },

  tableWrap: { width: "100%", overflowX: "auto", marginTop: 12 },
  table: { borderCollapse: "collapse", width: "100%" },
  th: { textAlign: "left", fontSize: 12, opacity: 0.85, borderBottom: "1px solid rgba(255,255,255,0.10)", padding: "10px 8px" },
  thRight: { textAlign: "right", fontSize: 12, opacity: 0.85, borderBottom: "1px solid rgba(255,255,255,0.10)", padding: "10px 8px" },
  td: { padding: "10px 8px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 13, verticalAlign: "top" },
  tdRight: { padding: "10px 8px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 13, textAlign: "right", verticalAlign: "top" },

  neg: { color: "#ff7b7b", fontWeight: 800 },
  muted: { opacity: 0.65 },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },

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

  pagerBtn: { ...styles.pagerBtn, fontSize: 12 },
  pagerBtnSecondary: { ...styles.pagerBtnSecondary, fontSize: 12 },
  pagerText: { ...styles.pagerText, fontSize: 12 },

  th: { ...styles.th, padding: "8px 6px", fontSize: 11 },
  thRight: { ...styles.thRight, padding: "8px 6px", fontSize: 11 },
  td: { ...styles.td, padding: "8px 6px", fontSize: 12 },
  tdRight: { ...styles.tdRight, padding: "8px 6px", fontSize: 12 },

  noteTitle: { ...styles.noteTitle, fontSize: 13 },
  ul: { ...styles.ul, fontSize: 12 },
};
