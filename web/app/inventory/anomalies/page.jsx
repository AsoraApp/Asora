"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { asoraGetJson } from "@/lib/asoraFetch";
import CompactBar, { useDensity } from "../_ui/CompactBar.jsx";
import { clearLedgerCache, getLedgerEventsCached } from "@/lib/ledgerCache";
import SavedViewsBar from "@/app/ui/SavedViewsBar";

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

export default function InventoryAnomaliesPage() {
  const { isCompact } = useDensity();
  const s = isCompact ? compact : styles;

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [events, setEvents] = useState([]);

  // Focus itemId (local-only)
  const [focusItemId, setFocusItemId] = useState("");

  // Paging controls per table (deterministic)
  const [pageMissingItemId, setPageMissingItemId] = useState(1);
  const [pageMissingQtyDelta, setPageMissingQtyDelta] = useState(1);
  const [pageNegativeDelta, setPageNegativeDelta] = useState(1);
  const [pageNegativeTotals, setPageNegativeTotals] = useState(1);

  useEffect(() => {
    // hydrate focus from localStorage once
    const v = safeReadLocalStorage(FOCUS_STORE_KEY);
    if (v) setFocusItemId(v);
  }, []);

  async function load({ force = false } = {}) {
    setLoading(true);
    setErr("");
    try {
      if (force) clearLedgerCache();

      const r = await getLedgerEventsCached(asoraGetJson);
      const list = Array.isArray(r?.events) ? r.events : [];

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
    } catch (e) {
      setErr(e?.message || "Failed to load ledger events.");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load({ force: false });
  }, []);

  const focus = (focusItemId || "").trim();

  const analysis = useMemo(() => {
    const missingItemId = [];
    const missingQtyDelta = [];
    const negativeDelta = [];
    const totals = new Map();

    for (const e of events) {
      if (!e || typeof e !== "object") continue;

      const itemId = typeof e.itemId === "string" ? e.itemId : "";
      const hasItemId = itemId.trim() !== "";

      const q = e.qtyDelta;
      const hasQty = typeof q === "number" && Number.isFinite(q) && !Number.isNaN(q);

      if (!hasItemId) missingItemId.push(e);
      if (!hasQty) missingQtyDelta.push(e);
      if (hasQty && q < 0) negativeDelta.push(e);

      if (hasItemId && hasQty) totals.set(itemId, (totals.get(itemId) || 0) + q);
    }

    const negativeTotals = Array.from(totals.entries())
      .filter(([, v]) => v < 0)
      .map(([itemId, derivedTotal]) => ({ itemId, derivedTotal }))
      .sort((a, b) => a.itemId.localeCompare(b.itemId));

    return { missingItemId, missingQtyDelta, negativeDelta, negativeTotals };
  }, [events]);

  // Apply focus filtering ONLY to item-specific sections
  const filteredNegativeDelta = useMemo(() => {
    if (!focus) return analysis.negativeDelta;
    return analysis.negativeDelta.filter((e) => typeof e?.itemId === "string" && e.itemId === focus);
  }, [analysis.negativeDelta, focus]);

  const filteredNegativeTotals = useMemo(() => {
    if (!focus) return analysis.negativeTotals;
    return analysis.negativeTotals.filter((r) => r.itemId === focus);
  }, [analysis.negativeTotals, focus]);

  // Reset paging when dataset sizes change
  useEffect(() => setPageMissingItemId(1), [analysis.missingItemId.length]);
  useEffect(() => setPageMissingQtyDelta(1), [analysis.missingQtyDelta.length]);
  useEffect(() => setPageNegativeDelta(1), [filteredNegativeDelta.length]);
  useEffect(() => setPageNegativeTotals(1), [filteredNegativeTotals.length]);

  function sliceToPage(list, page) {
    const end = Math.min(list.length, page * PAGE_SIZE);
    return list.slice(0, end);
  }
  function pageCount(list) {
    return Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  }

  const visibleMissingItemId = useMemo(
    () => sliceToPage(analysis.missingItemId, pageMissingItemId),
    [analysis.missingItemId, pageMissingItemId]
  );
  const visibleMissingQtyDelta = useMemo(
    () => sliceToPage(analysis.missingQtyDelta, pageMissingQtyDelta),
    [analysis.missingQtyDelta, pageMissingQtyDelta]
  );
  const visibleNegativeDelta = useMemo(
    () => sliceToPage(filteredNegativeDelta, pageNegativeDelta),
    [filteredNegativeDelta, pageNegativeDelta]
  );
  const visibleNegativeTotals = useMemo(
    () => sliceToPage(filteredNegativeTotals, pageNegativeTotals),
    [filteredNegativeTotals, pageNegativeTotals]
  );

  function Pager({ list, page, setPage }) {
    const pc = pageCount(list);
    return (
      <div style={s.pagerRow}>
        <button style={s.pagerBtn} onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
          Prev
        </button>
        <div style={s.pagerText}>
          Page <span style={s.mono}>{page}</span> / <span style={s.mono}>{pc}</span> (showing{" "}
          <span style={s.mono}>{Math.min(list.length, page * PAGE_SIZE)}</span> of <span style={s.mono}>{list.length}</span>)
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

  function applySaved(value) {
    const v = (value || "").trim();
    setFocusItemId(v);
    safeWriteLocalStorage(FOCUS_STORE_KEY, v);
  }

  return (
    <main style={s.shell}>
      <CompactBar here="Anomalies" />

      <header style={s.header}>
        <div style={s.title}>Inventory Anomalies / Integrity</div>
        <div style={s.sub}>
          Diagnostic signals derived from ledger data only (read-only). Ledger fetch is cached per tab. No correction is
          performed here.
        </div>
      </header>

      <section style={s.card}>
        <div style={s.controls}>
          <button style={s.button} onClick={() => load({ force: false })} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh (cached)"}
          </button>
          <button style={s.buttonSecondary} onClick={() => load({ force: true })} disabled={loading}>
            Refresh (force)
          </button>

          <label style={s.label}>
            Focus itemId (optional)
            <input
              style={s.input}
              value={focusItemId}
              onChange={(e) => {
                const v = e.target.value;
                setFocusItemId(v);
                safeWriteLocalStorage(FOCUS_STORE_KEY, v);
              }}
              placeholder="exact itemId (filters item-specific sections)"
            />
          </label>

          <div style={s.meta}>
            Events analyzed: <span style={s.mono}>{events.length}</span>
            {focus ? (
              <>
                {" "}
                | Focus: <span style={s.mono}>{focus}</span>
              </>
            ) : null}
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <SavedViewsBar
            storageKey={SAVED_VIEWS_KEY}
            valueLabel="focus itemId"
            currentValue={focus}
            onApply={applySaved}
          />
        </div>

        {err ? <div style={s.err}>Error: {err}</div> : null}

        <div style={s.grid}>
          <div style={s.kpi}>
            <div style={s.kpiLabel}>Missing itemId</div>
            <div style={s.kpiValue}>{analysis.missingItemId.length}</div>
          </div>
          <div style={s.kpi}>
            <div style={s.kpiLabel}>Missing qtyDelta</div>
            <div style={s.kpiValue}>{analysis.missingQtyDelta.length}</div>
          </div>
          <div style={s.kpi}>
            <div style={s.kpiLabel}>Negative qtyDelta events</div>
            <div style={s.kpiValue}>{analysis.negativeDelta.length}</div>
          </div>
          <div style={s.kpi}>
            <div style={s.kpiLabel}>Items with negative derived totals</div>
            <div style={s.kpiValue}>{analysis.negativeTotals.length}</div>
          </div>
        </div>
      </section>

      <section style={s.card}>
        <div style={s.sectionTitle}>Events missing itemId</div>
        <Pager list={analysis.missingItemId} page={pageMissingItemId} setPage={setPageMissingItemId} />

        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>ts</th>
                <th style={s.th}>eventType</th>
                <th style={s.th}>id</th>
              </tr>
            </thead>
            <tbody>
              {visibleMissingItemId.map((e, idx) => {
                const ts = typeof e?.ts === "string" ? e.ts : "—";
                const eventType = typeof e?.eventType === "string" ? e.eventType : "—";
                const id = typeof e?.id === "string" ? e.id : "";
                const key = id || `${ts}:missingItemId:${idx}`;
                return (
                  <tr key={key}>
                    <td style={s.td}>
                      <span style={s.mono}>{ts}</span>
                    </td>
                    <td style={s.td}>{eventType}</td>
                    <td style={s.td}>
                      <span style={s.mono}>{id || "—"}</span>
                    </td>
                  </tr>
                );
              })}
              {analysis.missingItemId.length === 0 ? (
                <tr>
                  <td style={s.td} colSpan={3}>
                    <span style={s.muted}>None.</span>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section style={s.card}>
        <div style={s.sectionTitle}>Events missing numeric qtyDelta</div>
        <Pager list={analysis.missingQtyDelta} page={pageMissingQtyDelta} setPage={setPageMissingQtyDelta} />

        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>ts</th>
                <th style={s.th}>itemId</th>
                <th style={s.th}>eventType</th>
                <th style={s.th}>id</th>
              </tr>
            </thead>
            <tbody>
              {visibleMissingQtyDelta.map((e, idx) => {
                const ts = typeof e?.ts === "string" ? e.ts : "—";
                const itemId = typeof e?.itemId === "string" ? e.itemId : "";
                const eventType = typeof e?.eventType === "string" ? e.eventType : "—";
                const id = typeof e?.id === "string" ? e.id : "";
                const key = id || `${ts}:missingQty:${idx}`;
                return (
                  <tr key={key}>
                    <td style={s.td}>
                      <span style={s.mono}>{ts}</span>
                    </td>
                    <td style={s.td}>
                      <span style={s.mono}>{itemId || "—"}</span>
                    </td>
                    <td style={s.td}>{eventType}</td>
                    <td style={s.td}>
                      <span style={s.mono}>{id || "—"}</span>
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

      <section style={s.card}>
        <div style={s.sectionTitle}>
          Events with negative qtyDelta {focus ? <span style={s.muted}>(filtered)</span> : null}
        </div>
        <Pager list={filteredNegativeDelta} page={pageNegativeDelta} setPage={setPageNegativeDelta} />

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
              {visibleNegativeDelta.map((e, idx) => {
                const ts = typeof e?.ts === "string" ? e.ts : "—";
                const itemId = typeof e?.itemId === "string" ? e.itemId : "";
                const q = typeof e?.qtyDelta === "number" && Number.isFinite(e.qtyDelta) ? e.qtyDelta : null;
                const eventType = typeof e?.eventType === "string" ? e.eventType : "—";
                const id = typeof e?.id === "string" ? e.id : "";
                const key = id || `${ts}:negDelta:${idx}`;

                return (
                  <tr key={key}>
                    <td style={s.td}>
                      <span style={s.mono}>{ts}</span>
                    </td>
                    <td style={s.td}>
                      <span style={s.mono}>{itemId || "—"}</span>
                    </td>
                    <td style={{ ...s.tdRight, ...(q !== null && q < 0 ? s.neg : null) }}>
                      <span style={s.mono}>{q !== null ? q : "—"}</span>
                    </td>
                    <td style={s.td}>{eventType}</td>
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
              {filteredNegativeDelta.length === 0 ? (
                <tr>
                  <td style={s.td} colSpan={5}>
                    <span style={s.muted}>None.</span>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section style={s.card}>
        <div style={s.sectionTitle}>
          Items with negative derived totals {focus ? <span style={s.muted}>(filtered)</span> : null}
        </div>
        <Pager list={filteredNegativeTotals} page={pageNegativeTotals} setPage={setPageNegativeTotals} />

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
              {visibleNegativeTotals.map((r) => (
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
              {filteredNegativeTotals.length === 0 ? (
                <tr>
                  <td style={s.td} colSpan={3}>
                    <span style={s.muted}>None.</span>
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
          <li>These are diagnostic signals only; the UI never mutates inventory truth.</li>
          <li>Negative totals are derived by summing numeric qtyDelta values per itemId.</li>
          <li>“Force” refresh clears the in-tab cache and re-fetches ledger events.</li>
          <li>Focus itemId filters item-specific sections only. Missing-field sections remain unfiltered.</li>
          <li>Saved Views are local-only (localStorage) and do not affect backend behavior.</li>
        </ul>
      </section>
    </main>
  );
}

const styles = {
  shell: { minHeight: "100vh", padding: 24, fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto" },
  header: { marginBottom: 16 },
  title: { fontSize: 22, fontWeight: 700 },
  sub: { marginTop: 6, color: "#555", fontSize: 13, lineHeight: 1.35 },

  card: { border: "1px solid #e5e5e5", borderRadius: 12, padding: 16, marginBottom: 16, background: "#fff" },
  controls: { display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" },
  button: { padding: "8px 12px", borderRadius: 10, border: "1px solid #111", background: "#111", color: "#fff", cursor: "pointer", fontSize: 13, height: 34 },
  buttonSecondary: { padding: "8px 12px", borderRadius: 10, border: "1px solid #bbb", background: "#fff", color: "#111", cursor: "pointer", fontSize: 13, height: 34 },
  meta: { fontSize: 13, color: "#444" },

  label: { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "#222" },
  input: { width: 320, padding: "8px 10px", borderRadius: 10, border: "1px solid #ccc", outline: "none", fontSize: 13 },

  grid: { marginTop: 12, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 },
  kpi: { border: "1px solid #eee", borderRadius: 12, padding: 12, background: "#fafafa" },
  kpiLabel: { fontSize: 12, color: "#555" },
  kpiValue: { fontSize: 22, fontWeight: 800, marginTop: 6 },

  sectionTitle: { fontSize: 14, fontWeight: 800, marginBottom: 10 },

  pagerRow: { marginTop: 8, marginBottom: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  pagerBtn: { padding: "6px 10px", borderRadius: 10, border: "1px solid #bbb", background: "#fff", cursor: "pointer", fontSize: 13 },
  pagerBtnSecondary: { padding: "6px 10px", borderRadius: 10, border: "1px solid #bbb", background: "#f7f7f7", cursor: "pointer", fontSize: 13 },
  pagerText: { fontSize: 13, color: "#333" },

  err: { marginTop: 10, color: "#b00020", fontSize: 13 },

  tableWrap: { width: "100%", overflowX: "auto" },
  table: { borderCollapse: "collapse", width: "100%" },
  th: { textAlign: "left", fontSize: 12, color: "#444", borderBottom: "1px solid #eee", padding: "10px 8px" },
  thRight: { textAlign: "right", fontSize: 12, color: "#444", borderBottom: "1px solid #eee", padding: "10px 8px" },
  td: { padding: "10px 8px", borderBottom: "1px solid #f0f0f0", fontSize: 13, verticalAlign: "top" },
  tdRight: { padding: "10px 8px", borderBottom: "1px solid #f0f0f0", fontSize: 13, textAlign: "right", verticalAlign: "top" },

  linkRow: { display: "flex", gap: 10, flexWrap: "wrap" },
  link: { color: "#0b57d0", textDecoration: "none", fontSize: 13 },
  linkSecondary: { color: "#444", textDecoration: "none", fontSize: 13 },

  muted: { color: "#777" },
  neg: { color: "#b00020", fontWeight: 800 },

  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },

  noteTitle: { fontSize: 14, fontWeight: 700, marginBottom: 8 },
  ul: { margin: 0, paddingLeft: 18, color: "#333", fontSize: 13, lineHeight: 1.5 },
};

const compact = {
  ...styles,
  shell: { ...styles.shell, padding: 14 },
  title: { fontSize: 18, fontWeight: 750 },
  sub: { ...styles.sub, fontSize: 12 },
  card: { ...styles.card, padding: 12, marginBottom: 12 },

  button: { ...styles.button, padding: "6px 10px", fontSize: 12, height: 30 },
  buttonSecondary: { ...styles.buttonSecondary, padding: "6px 10px", fontSize: 12, height: 30 },
  meta: { ...styles.meta, fontSize: 12 },

  label: { ...styles.label, fontSize: 12 },
  input: { ...styles.input, padding: "6px 8px", fontSize: 12, width: 260 },

  grid: { ...styles.grid, gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 },
  kpiValue: { ...styles.kpiValue, fontSize: 20 },

  sectionTitle: { ...styles.sectionTitle, fontSize: 13 },

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
