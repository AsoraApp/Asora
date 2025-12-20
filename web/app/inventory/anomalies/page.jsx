"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { asoraGetJson } from "@/lib/asoraFetch";
import CompactBar, { useDensity } from "../_ui/CompactBar.jsx";
import { clearLedgerCache, getLedgerEventsCached } from "@/lib/ledgerCache";

import AdminHeader from "@/app/_ui/AdminHeader.jsx";
import LedgerFreshnessBar from "@/app/_ui/LedgerFreshnessBar.jsx";
import IntegrityFooter from "@/app/_ui/IntegrityFooter.jsx";
import { downloadCsvFromRows } from "@/app/_ui/csv.js";

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
  const [computedAtUtc, setComputedAtUtc] = useState("");
  const [lastFetchedUtc, setLastFetchedUtc] = useState("");
  const [cacheStatus, setCacheStatus] = useState("cached");

  const [focusItemId, setFocusItemId] = useState("");

  const [p1, setP1] = useState(1);
  const [p2, setP2] = useState(1);
  const [p3, setP3] = useState(1);
  const [p4, setP4] = useState(1);

  useEffect(() => {
    setFocusItemId(safeReadLocalStorage(FOCUS_STORE_KEY));
  }, []);

  useEffect(() => {
    safeWriteLocalStorage(FOCUS_STORE_KEY, focusItemId);
  }, [focusItemId]);

  async function load({ force = false } = {}) {
    setLoading(true);
    setErr("");
    try {
      if (force) {
        clearLedgerCache();
        setCacheStatus("fresh");
      } else {
        setCacheStatus("cached");
      }

      const r = await getLedgerEventsCached(asoraGetJson);
      const list = Array.isArray(r?.events) ? r.events : [];

      const sorted = [...list].sort((a, b) => {
        const ta = String(a?.ts || "");
        const tb = String(b?.ts || "");
        if (ta < tb) return -1;
        if (ta > tb) return 1;
        return String(a?.id || "").localeCompare(String(b?.id || ""));
      });

      setEvents(sorted);
      const now = new Date().toISOString();
      setComputedAtUtc(now);
      setLastFetchedUtc(now);
    } catch (e) {
      setErr(e?.message || "Failed to load ledger events.");
      setEvents([]);
      setComputedAtUtc("");
      setLastFetchedUtc("");
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
      const itemId = typeof e?.itemId === "string" ? e.itemId : "";
      const hasItemId = itemId.trim() !== "";

      const q = e?.qtyDelta;
      const hasQty = typeof q === "number" && Number.isFinite(q);

      if (!hasItemId) missingItemId.push(e);
      if (!hasQty) missingQtyDelta.push(e);
      if (hasQty && q < 0) negativeDelta.push(e);

      if (hasItemId && hasQty) {
        totals.set(itemId, (totals.get(itemId) || 0) + q);
      }
    }

    const negativeTotals = Array.from(totals.entries())
      .filter(([, v]) => v < 0)
      .map(([itemId, derivedTotal]) => ({ itemId, derivedTotal }))
      .sort((a, b) => a.itemId.localeCompare(b.itemId));

    return { missingItemId, missingQtyDelta, negativeDelta, negativeTotals };
  }, [events]);

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
          Page <span style={s.mono}>{page}</span> / <span style={s.mono}>{pc}</span>
        </div>
        <button style={s.pagerBtn} onClick={() => setPage((p) => Math.min(pc, p + 1))} disabled={page >= pc}>
          Next
        </button>
        <button style={s.pagerBtnSecondary} onClick={() => setPage(pc)} disabled={page >= pc}>
          End
        </button>
      </div>
    );
  }

  function exportCsv() {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const safeFocus = focus ? `_focus_${focus.replace(/[^a-zA-Z0-9_-]/g, "_")}` : "";
    const filename = `asora_anomalies_${ts}${safeFocus}.csv`;

    const rows = [];

    for (const e of analysis.missingItemId) {
      rows.push({ kind: "MISSING_ITEM_ID", ts: e?.ts || "", id: e?.id || "", itemId: "", qtyDelta: e?.qtyDelta ?? "" });
    }
    for (const e of analysis.missingQtyDelta) {
      rows.push({
        kind: "MISSING_QTY_DELTA",
        ts: e?.ts || "",
        id: e?.id || "",
        itemId: e?.itemId || "",
        qtyDelta: "",
      });
    }
    for (const e of negDeltaFiltered) {
      rows.push({
        kind: "NEGATIVE_QTY_DELTA",
        ts: e?.ts || "",
        id: e?.id || "",
        itemId: e?.itemId || "",
        qtyDelta: e?.qtyDelta ?? "",
      });
    }
    for (const r of negTotalsFiltered) {
      rows.push({
        kind: "NEGATIVE_DERIVED_TOTAL",
        ts: "",
        id: "",
        itemId: r.itemId,
        qtyDelta: "",
        derivedTotal: r.derivedTotal,
      });
    }

    downloadCsvFromRows(
      filename,
      ["kind", "ts", "id", "itemId", "qtyDelta", "derivedTotal"],
      rows.map((x) => ({
        kind: x.kind,
        ts: x.ts || "",
        id: x.id || "",
        itemId: x.itemId || "",
        qtyDelta: x.qtyDelta === undefined ? "" : x.qtyDelta,
        derivedTotal: x.derivedTotal === undefined ? "" : x.derivedTotal,
      }))
    );
  }

  return (
    <main style={s.shell}>
      <CompactBar here="Anomalies" />

      <AdminHeader
        title="Inventory Anomalies"
        subtitle="Read-only integrity signals derived from ledger events."
        rightSlot={
          <LedgerFreshnessBar
            lastFetchedUtc={lastFetchedUtc}
            cacheStatus={cacheStatus}
            loading={loading}
            onRefresh={() => load({ force: false })}
            onForceRefresh={() => load({ force: true })}
          />
        }
      />

      <section style={s.card}>
        <div style={s.controls}>
          <button style={s.button} onClick={() => load({ force: false })} disabled={loading}>
            Refresh (cached)
          </button>
          <button style={s.buttonSecondary} onClick={() => load({ force: true })} disabled={loading}>
            Refresh (force)
          </button>
          <button style={s.buttonSecondary} onClick={exportCsv} disabled={loading || events.length === 0}>
            Export CSV
          </button>

          <label style={s.label}>
            Focus itemId
            <input
              style={s.input}
              value={focusItemId}
              onChange={(e) => setFocusItemId(e.target.value)}
              placeholder="exact itemId"
            />
          </label>

          <div style={s.meta}>
            Events: <span style={s.mono}>{events.length}</span> | Computed at (UTC):{" "}
            <span style={s.mono}>{computedAtUtc || "—"}</span>
          </div>
        </div>

        {err ? <div style={s.err}>Error: {err}</div> : null}
      </section>

      <section style={s.card}>
        <div style={s.sectionTitle}>Missing itemId</div>
        <Pager list={analysis.missingItemId} page={p1} setPage={setP1} />
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>ts</th>
                <th style={s.th}>eventType</th>
                <th style={s.thRight}>qtyDelta</th>
              </tr>
            </thead>
            <tbody>
              {slice(analysis.missingItemId, p1).map((e, idx) => (
                <tr key={String(e?.id || `${e?.ts || ""}:${idx}`)}>
                  <td style={s.td}><span style={s.mono}>{e?.ts || "—"}</span></td>
                  <td style={s.td}>{e?.eventType || "—"}</td>
                  <td style={s.tdRight}><span style={s.mono}>{typeof e?.qtyDelta === "number" ? e.qtyDelta : "—"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section style={s.card}>
        <div style={s.sectionTitle}>Missing qtyDelta</div>
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
              {slice(analysis.missingQtyDelta, p2).map((e, idx) => {
                const itemId = typeof e?.itemId === "string" ? e.itemId : "";
                const key = String(e?.id || `${e?.ts || ""}:${itemId}:${idx}`);
                return (
                  <tr key={key}>
                    <td style={s.td}><span style={s.mono}>{e?.ts || "—"}</span></td>
                    <td style={s.td}>{itemId ? <span style={s.mono}>{itemId}</span> : "—"}</td>
                    <td style={s.td}>{e?.eventType || "—"}</td>
                    <td style={s.td}>
                      {itemId ? (
                        <>
                          <Link style={s.link} href={itemHref(itemId)}>Drill-down</Link>
                          <span style={s.dot}>·</span>
                          <Link style={s.linkSecondary} href={movementsHref(itemId)}>Movements</Link>
                        </>
                      ) : (
                        "—"
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
        <div style={s.sectionTitle}>Negative qtyDelta</div>
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
              {slice(negDeltaFiltered, p3).map((e, idx) => {
                const itemId = typeof e?.itemId === "string" ? e.itemId : "";
                const key = String(e?.id || `${e?.ts || ""}:${itemId}:${idx}`);
                return (
                  <tr key={key}>
                    <td style={s.td}><span style={s.mono}>{e?.ts || "—"}</span></td>
                    <td style={s.td}>{itemId ? <span style={s.mono}>{itemId}</span> : "—"}</td>
                    <td style={{ ...s.tdRight, ...s.neg }}>
                      <span style={s.mono}>{typeof e?.qtyDelta === "number" ? e.qtyDelta : "—"}</span>
                    </td>
                    <td style={s.td}>{e?.eventType || "—"}</td>
                    <td style={s.td}>
                      {itemId ? <Link style={s.link} href={itemHref(itemId)}>Drill-down</Link> : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section style={s.card}>
        <div style={s.sectionTitle}>Negative derived totals</div>
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
              {slice(negTotalsFiltered, p4).map((r) => (
                <tr key={r.itemId}>
                  <td style={s.td}><span style={s.mono}>{r.itemId}</span></td>
                  <td style={{ ...s.tdRight, ...s.neg }}><span style={s.mono}>{r.derivedTotal}</span></td>
                  <td style={s.td}>
                    <Link style={s.link} href={itemHref(r.itemId)}>Drill-down</Link>
                    <span style={s.dot}>·</span>
                    <Link style={s.linkSecondary} href={movementsHref(r.itemId)}>Movements</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <IntegrityFooter
          ledgerEventsProcessed={events.length}
          skipped={[
            { reason: "missing itemId", count: analysis.missingItemId.length },
            { reason: "missing qtyDelta", count: analysis.missingQtyDelta.length },
          ]}
          renderUtc={computedAtUtc || new Date().toISOString()}
        />
      </section>
    </main>
  );
}

const styles = {
  shell: { minHeight: "100vh", padding: 24 },
  card: { border: "1px solid #e5e5e5", borderRadius: 12, padding: 16, marginBottom: 16, background: "#fff" },
  controls: { display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" },
  label: { display: "flex", flexDirection: "column", fontSize: 13, gap: 6 },
  input: { width: 260, padding: "8px 10px", borderRadius: 10, border: "1px solid #ccc" },
  button: { padding: "8px 12px", borderRadius: 10, background: "#111", color: "#fff", cursor: "pointer" },
  buttonSecondary: { padding: "8px 12px", borderRadius: 10, border: "1px solid #bbb", background: "#fff", cursor: "pointer" },
  meta: { fontSize: 13, color: "#444" },
  err: { color: "#b00020" },

  sectionTitle: { fontWeight: 800, marginBottom: 8 },
  pagerRow: { display: "flex", gap: 10, alignItems: "center", marginBottom: 10, flexWrap: "wrap" },
  pagerBtn: { padding: "6px 10px", borderRadius: 10, border: "1px solid #bbb", background: "#fff", cursor: "pointer" },
  pagerBtnSecondary: { padding: "6px 10px", borderRadius: 10, border: "1px solid #bbb", background: "#f7f7f7", cursor: "pointer" },
  pagerText: { fontSize: 13, color: "#333" },

  tableWrap: { width: "100%", overflowX: "auto", marginTop: 10 },
  table: { borderCollapse: "collapse", width: "100%" },
  th: { textAlign: "left", fontSize: 12, color: "#444", borderBottom: "1px solid #eee", padding: "10px 8px" },
  thRight: { textAlign: "right", fontSize: 12, color: "#444", borderBottom: "1px solid #eee", padding: "10px 8px" },
  td: { padding: "10px 8px", borderBottom: "1px solid #f0f0f0", fontSize: 13, verticalAlign: "top" },
  tdRight: { padding: "10px 8px", borderBottom: "1px solid #f0f0f0", fontSize: 13, textAlign: "right", verticalAlign: "top" },

  link: { color: "#0b57d0", textDecoration: "none", fontSize: 13 },
  linkSecondary: { color: "#444", textDecoration: "none", fontSize: 13 },
  dot: { color: "#777", padding: "0 6px" },

  neg: { color: "#b00020", fontWeight: 700 },
  mono: { fontFamily: "ui-monospace, monospace" },
};

const compact = styles;
