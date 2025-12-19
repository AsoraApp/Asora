"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import AdminHeader from "@/app/_ui/AdminHeader.jsx";
import CompactBar, { useDensity } from "@/app/_ui/CompactBar.jsx";
import LedgerFreshnessBar from "@/app/_ui/LedgerFreshnessBar.jsx";
import SavedViewsBar from "@/app/ui/SavedViewsBar";
import IntegrityFooter from "@/app/_ui/IntegrityFooter.jsx";

import { asoraGetJson } from "@/lib/asoraFetch";
import { clearLedgerCache, getLedgerEventsCached } from "@/lib/ledgerCache";

export const runtime = "edge";

const PAGE_SIZE = 200;

const FOCUS_STORE_KEY = "asora_view:anomalies:focusItemId";
const SAVED_VIEWS_KEY = "asora_saved_views:anomalies:focusItemId";

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

function safeStableKey(x) {
  try {
    return JSON.stringify(x ?? {});
  } catch {
    return String(x ?? "");
  }
}

export default function InventoryAnomaliesPage() {
  const { isCompact } = useDensity();
  const s = isCompact ? compact : styles;

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [events, setEvents] = useState([]);

  // local-only focus
  const [focusItemId, setFocusItemId] = useState(() => safeReadLocalStorage(FOCUS_STORE_KEY));

  // freshness + integrity
  const [lastFetchedUtc, setLastFetchedUtc] = useState("");
  const [cacheStatus, setCacheStatus] = useState("unknown"); // cached | fresh | unknown
  const [integrity, setIntegrity] = useState({ eventsProcessed: 0, skipped: [], renderUtc: "" });

  // paging state per section
  const [p1, setP1] = useState(1);
  const [p2, setP2] = useState(1);
  const [p3, setP3] = useState(1);
  const [p4, setP4] = useState(1);

  async function load({ force = false } = {}) {
    setLoading(true);
    setErr("");
    try {
      if (force) clearLedgerCache();

      const r = await getLedgerEventsCached(asoraGetJson);
      const sorted = normalizeLedgerEvents(r);
      setEvents(sorted);

      const now = utcNowIso();
      setLastFetchedUtc(now);
      setCacheStatus(force ? "fresh" : "cached");

      // integrity: record skipped counts from analysis pass
      const analysis = buildAnalysis(sorted);
      const skipped = [
        ...(analysis.skippedMissingItemId ? [{ kind: "LEDGER_MISSING_ITEM_ID", count: analysis.skippedMissingItemId }] : []),
        ...(analysis.skippedMissingQtyDelta ? [{ kind: "LEDGER_MISSING_QTY_DELTA", count: analysis.skippedMissingQtyDelta }] : []),
      ];
      setIntegrity({ eventsProcessed: sorted.length, skipped, renderUtc: now });
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

  const focus = (focusItemId || "").trim();

  const analysis = useMemo(() => buildAnalysis(events), [events]);

  const negDeltaFiltered = useMemo(() => {
    if (!focus) return analysis.negativeDelta;
    return analysis.negativeDelta.filter((e) => e?.itemId === focus);
  }, [analysis.negativeDelta, focus]);

  const negTotalsFiltered = useMemo(() => {
    if (!focus) return analysis.negativeTotals;
    return analysis.negativeTotals.filter((r) => r.itemId === focus);
  }, [analysis.negativeTotals, focus]);

  useEffect(() => setP1(1), [analysis.missingItemId.length]);
  useEffect(() => setP2(1), [analysis.missingQtyDelta.length]);
  useEffect(() => setP3(1), [negDeltaFiltered.length]);
  useEffect(() => setP4(1), [negTotalsFiltered.length]);

  function slice(list, page) {
    return list.slice(0, Math.min(list.length, page * PAGE_SIZE));
  }
  function pages(list) {
    return Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  }

  function Pager({ list, page, setPage }) {
    const pc = pages(list);
    return (
      <div style={s.pagerRow}>
        <button style={s.pagerBtn} onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
          Prev
        </button>
        <div style={s.pagerText}>
          Page <span style={s.mono}>{page}</span> / <span style={s.mono}>{pc}</span> (showing{" "}
          <span style={s.mono}>{slice(list, page).length}</span> / <span style={s.mono}>{list.length}</span>)
        </div>
        <button style={s.pagerBtn} onClick={() => setPage((p) => Math.min(pc, p + 1))} disabled={page >= pc}>
          Next
        </button>
        <button style={s.pagerBtnSecondary} onClick={() => setPage(pc)} disabled={page >= pc} title="Jump to last page">
          End
        </button>
      </div>
    );
  }

  function applySaved(v) {
    const vv = (v || "").trim();
    setFocusItemId(vv);
    safeWriteLocalStorage(FOCUS_STORE_KEY, vv);
  }

  const visibleMissingItemId = useMemo(() => slice(analysis.missingItemId, p1), [analysis.missingItemId, p1]);
  const visibleMissingQtyDelta = useMemo(() => slice(analysis.missingQtyDelta, p2), [analysis.missingQtyDelta, p2]);
  const visibleNegDelta = useMemo(() => slice(negDeltaFiltered, p3), [negDeltaFiltered, p3]);
  const visibleNegTotals = useMemo(() => slice(negTotalsFiltered, p4), [negTotalsFiltered, p4]);

  return (
    <main style={s.shell}>
      <AdminHeader
        title="Inventory Anomalies"
        subtitle="Read-only integrity signals derived from ledger events. No writes. Deterministic grouping and ordering."
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

      <CompactBar here="Anomalies" />

      <section style={s.card}>
        <div style={s.controls}>
          <label style={s.label}>
            Focus itemId (exact)
            <input
              style={s.input}
              value={focusItemId}
              onChange={(e) => {
                const v = e.target.value;
                setFocusItemId(v);
                safeWriteLocalStorage(FOCUS_STORE_KEY, v);
              }}
              placeholder="exact itemId"
            />
          </label>

          <div style={s.meta}>
            Events: <span style={s.mono}>{events.length}</span> | Focus: <span style={s.mono}>{focus || "—"}</span> | Page
            size: <span style={s.mono}>{PAGE_SIZE}</span>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <SavedViewsBar storageKey={SAVED_VIEWS_KEY} valueLabel="focus itemId" currentValue={focus} onApply={applySaved} />
        </div>

        {err ? <div style={s.err}>Error: {err}</div> : null}
      </section>

      {/* Missing itemId */}
      <section style={s.card}>
        <div style={s.sectionTitle}>
          Missing itemId <span style={s.count}>({analysis.missingItemId.length})</span>
        </div>
        <Pager list={analysis.missingItemId} page={p1} setPage={setP1} />
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>ts</th>
                <th style={s.th}>eventType</th>
                <th style={s.thRight}>qtyDelta</th>
                <th style={s.th}>ids</th>
              </tr>
            </thead>
            <tbody>
              {visibleMissingItemId.map((e, idx) => (
                <tr key={stableRowKey(e, idx)}>
                  <td style={s.td}>
                    <span style={s.mono}>{typeof e?.ts === "string" ? e.ts : "—"}</span>
                  </td>
                  <td style={s.td}>{asText(e?.eventType || e?.type || "—")}</td>
                  <td style={s.tdRight}>
                    <span style={s.mono}>{asQtyText(e?.qtyDelta)}</span>
                  </td>
                  <td style={s.td}>
                    <span style={s.mono}>{idsText(e)}</span>
                  </td>
                </tr>
              ))}
              {analysis.missingItemId.length === 0 ? (
                <tr>
                  <td style={s.td} colSpan={4}>
                    <span style={s.muted}>None.</span>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {/* Missing qtyDelta */}
      <section style={s.card}>
        <div style={s.sectionTitle}>
          Missing qtyDelta <span style={s.count}>({analysis.missingQtyDelta.length})</span>
        </div>
        <Pager list={analysis.missingQtyDelta} page={p2} setPage={setP2} />
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>ts</th>
                <th style={s.th}>itemId</th>
                <th style={s.th}>eventType</th>
                <th style={s.th}>Links</th>
              </tr>
            </thead>
            <tbody>
              {visibleMissingQtyDelta.map((e, idx) => {
                const itemId = typeof e?.itemId === "string" ? e.itemId : "";
                return (
                  <tr key={stableRowKey(e, idx)}>
                    <td style={s.td}>
                      <span style={s.mono}>{typeof e?.ts === "string" ? e.ts : "—"}</span>
                    </td>
                    <td style={s.td}>{itemId ? <span style={s.mono}>{itemId}</span> : <span style={s.muted}>—</span>}</td>
                    <td style={s.td}>{asText(e?.eventType || e?.type || "—")}</td>
                    <td style={s.td}>
                      {itemId ? (
                        <div style={s.linkRow}>
                          <Link style={s.link} href={itemHref(itemId)}>
                            Drill-down
                          </Link>
                          <Link style={s.linkSecondary} href={movementsHref(itemId)}>
                            Movements
                          </Link>
                        </div>
                      ) : (
                        <span style={s.muted}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {analysis.missingQtyDelta.length === 0 ? (
                <tr>
                  <td style={s.td} colSpan={4}>
                    <span style={s.muted}>None.</span>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {/* Negative qtyDelta */}
      <section style={s.card}>
        <div style={s.sectionTitle}>
          Negative qtyDelta <span style={s.count}>({negDeltaFiltered.length}{focus ? " (filtered)" : ""})</span>
        </div>
        <Pager list={negDeltaFiltered} page={p3} setPage={setP3} />
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
              {visibleNegDelta.map((e, idx) => {
                const itemId = typeof e?.itemId === "string" ? e.itemId : "";
                const q = coerceFiniteNumber(e?.qtyDelta);
                return (
                  <tr key={stableRowKey(e, idx)}>
                    <td style={s.td}>
                      <span style={s.mono}>{typeof e?.ts === "string" ? e.ts : "—"}</span>
                    </td>
                    <td style={s.td}>{itemId ? <span style={s.mono}>{itemId}</span> : <span style={s.muted}>—</span>}</td>
                    <td style={{ ...s.tdRight, ...(typeof q === "number" && q < 0 ? s.neg : null) }}>
                      <span style={s.mono}>{typeof q === "number" ? q : "—"}</span>
                    </td>
                    <td style={s.td}>{asText(e?.eventType || e?.type || "—")}</td>
                    <td style={s.td}>
                      {itemId ? (
                        <div style={s.linkRow}>
                          <Link style={s.link} href={itemHref(itemId)}>
                            Drill-down
                          </Link>
                          <Link style={s.linkSecondary} href={movementsHref(itemId)}>
                            Movements
                          </Link>
                        </div>
                      ) : (
                        <span style={s.muted}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {negDeltaFiltered.length === 0 ? (
                <tr>
                  <td style={s.td} colSpan={5}>
                    <span style={s.muted}>{focus ? "No negative deltas for this focus itemId." : "None."}</span>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {/* Negative derived totals */}
      <section style={s.card}>
        <div style={s.sectionTitle}>
          Negative derived totals <span style={s.count}>({negTotalsFiltered.length}{focus ? " (filtered)" : ""})</span>
        </div>
        <Pager list={negTotalsFiltered} page={p4} setPage={setP4} />
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>itemId</th>
                <th style={s.thRight}>derivedTotal</th>
                <th style={s.th}>Links</th>
              </tr>
            </thead>
            <tbody>
              {visibleNegTotals.map((r) => (
                <tr key={r.itemId}>
                  <td style={s.td}>
                    <span style={s.mono}>{r.itemId}</span>
                  </td>
                  <td style={{ ...s.tdRight, ...s.neg }}>
                    <span style={s.mono}>{r.derivedTotal}</span>
                  </td>
                  <td style={s.td}>
                    <div style={s.linkRow}>
                      <Link style={s.link} href={itemHref(r.itemId)}>
                        Drill-down
                      </Link>
                      <Link style={s.linkSecondary} href={movementsHref(r.itemId)}>
                        Movements
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
              {negTotalsFiltered.length === 0 ? (
                <tr>
                  <td style={s.td} colSpan={3}>
                    <span style={s.muted}>{focus ? "No negative totals for this focus itemId." : "None."}</span>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section style={s.card}>
        <div style={s.noteTitle}>Notes</div>
        <ul style={s.ul}>
          <li>All anomalies are derived purely from ledger events (read-only).</li>
          <li>Ordering is deterministic: events are sorted by ts ascending, then id.</li>
          <li>Negative totals are shown as-is (no clamping).</li>
          <li>Focus itemId filters only the negative lists; missing-field lists remain global.</li>
        </ul>
      </section>

      <IntegrityFooter eventsProcessed={integrity.eventsProcessed} skipped={integrity.skipped} renderUtc={integrity.renderUtc} />
    </main>
  );
}

function buildAnalysis(events) {
  const missingItemId = [];
  const missingQtyDelta = [];
  const negativeDelta = [];
  const totals = new Map();

  let skippedMissingItemId = 0;
  let skippedMissingQtyDelta = 0;

  for (const e of events) {
    const itemId = typeof e?.itemId === "string" ? e.itemId : "";
    const hasItemId = itemId.trim() !== "";

    const q = coerceFiniteNumber(e?.qtyDelta);
    const hasQty = typeof q === "number" && Number.isFinite(q);

    if (!hasItemId) {
      missingItemId.push(e);
      skippedMissingItemId += 1;
    }
    if (!hasQty) {
      missingQtyDelta.push(e);
      skippedMissingQtyDelta += 1;
    }
    if (hasQty && q < 0) negativeDelta.push(e);

    if (hasItemId && hasQty) {
      totals.set(itemId, (totals.get(itemId) || 0) + q);
    }
  }

  const negativeTotals = Array.from(totals.entries())
    .filter(([, v]) => v < 0)
    .map(([itemId, derivedTotal]) => ({ itemId, derivedTotal }))
    .sort((a, b) => a.itemId.localeCompare(b.itemId));

  return { missingItemId, missingQtyDelta, negativeDelta, negativeTotals, skippedMissingItemId, skippedMissingQtyDelta };
}

function stableRowKey(e, idx) {
  const ts = typeof e?.ts === "string" ? e.ts : "";
  const id =
    (typeof e?.ledgerEventId === "string" && e.ledgerEventId) ||
    (typeof e?.eventId === "string" && e.eventId) ||
    (typeof e?.id === "string" && e.id) ||
    "";
  const itemId = typeof e?.itemId === "string" ? e.itemId : "";
  return `${ts}|${id}|${itemId}|${idx}`;
}

function asText(v) {
  const s = v == null ? "" : String(v);
  return s || "—";
}

function asQtyText(v) {
  const n = coerceFiniteNumber(v);
  return n === null ? "—" : String(n);
}

function idsText(e) {
  const parts = [];
  if (e?.ledgerEventId) parts.push(`ledgerEventId:${String(e.ledgerEventId)}`);
  if (e?.eventId) parts.push(`eventId:${String(e.eventId)}`);
  if (e?.id) parts.push(`id:${String(e.id)}`);
  if (parts.length === 0) return "—";
  return parts.join(" ");
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
    width: 260,
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.25)",
    color: "#e6edf3",
    outline: "none",
    fontSize: 13,
  },

  meta: { fontSize: 13, opacity: 0.85 },

  err: { marginTop: 10, color: "#ff7b7b", fontSize: 13 },

  sectionTitle: { fontWeight: 900, marginBottom: 8, letterSpacing: "0.2px" },
  count: { opacity: 0.75, fontWeight: 700 },

  pagerRow: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 },
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

  tableWrap: { width: "100%", overflowX: "auto" },
  table: { borderCollapse: "collapse", width: "100%" },
  th: { textAlign: "left", fontSize: 12, opacity: 0.85, borderBottom: "1px solid rgba(255,255,255,0.10)", padding: "10px 8px" },
  thRight: { textAlign: "right", fontSize: 12, opacity: 0.85, borderBottom: "1px solid rgba(255,255,255,0.10)", padding: "10px 8px" },
  td: { padding: "10px 8px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 13, verticalAlign: "top" },
  tdRight: { padding: "10px 8px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 13, textAlign: "right", verticalAlign: "top" },

  linkRow: { display: "flex", gap: 10, flexWrap: "wrap" },
  link: { color: "#93c5fd", textDecoration: "none", fontSize: 13 },
  linkSecondary: { color: "#e6edf3", opacity: 0.9, textDecoration: "none", fontSize: 13 },

  neg: { color: "#ff7b7b", fontWeight: 900 },
  muted: { opacity: 0.65 },

  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },

  noteTitle: { fontSize: 14, fontWeight: 900, marginBottom: 8 },
  ul: { margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.5, opacity: 0.9 },
};

const compact = {
  ...styles,
  shell: { ...styles.shell, padding: 12 },
  card: { ...styles.card, padding: 12, margin: "0 auto 12px auto" },

  label: { ...styles.label, fontSize: 12 },
  input: { ...styles.input, padding: "6px 8px", fontSize: 12, width: 220 },

  pagerBtn: { ...styles.pagerBtn, fontSize: 12 },
  pagerBtnSecondary: { ...styles.pagerBtnSecondary, fontSize: 12 },
  pagerText: { ...styles.pagerText, fontSize: 12 },

  th: { ...styles.th, padding: "8px 6px", fontSize: 11 },
  thRight: { ...styles.thRight, padding: "8px 6px", fontSize: 11 },
  td: { ...styles.td, padding: "8px 6px", fontSize: 12 },
  tdRight: { ...styles.tdRight, padding: "8px 6px", fontSize: 12 },

  link: { ...styles.link, fontSize: 12 },
  linkSecondary: { ...styles.linkSecondary, fontSize: 12 },

  noteTitle: { ...styles.noteTitle, fontSize: 13 },
  ul: { ...styles.ul, fontSize: 12 },
};
