"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { asoraGetJson } from "@/lib/asoraFetch";
import CompactBar, { useDensity } from "../_ui/CompactBar.jsx";
import { usePersistedString } from "../_ui/useViewState.jsx";

export const runtime = "edge";

const STORE_KEY = "asora_view:anomalies:itemId";

function itemHref(itemId) {
  return `/inventory/item?itemId=${encodeURIComponent(String(itemId))}`;
}

function movementsHref(itemId) {
  return `/inventory/movements?itemId=${encodeURIComponent(String(itemId))}`;
}

function isFiniteNumber(n) {
  return typeof n === "number" && Number.isFinite(n) && !Number.isNaN(n);
}

export default function InventoryAnomaliesPage() {
  const { isCompact } = useDensity();

  const sp = useSearchParams();
  const qpItemId = sp?.get("itemId") || "";

  const [persistedFocus, setPersistedFocus] = usePersistedString(STORE_KEY, "");
  const [focusItemId, setFocusItemId] = useState(qpItemId || persistedFocus);

  // If URL itemId changes, adopt it and persist it.
  useEffect(() => {
    if (qpItemId && qpItemId !== focusItemId) {
      setFocusItemId(qpItemId);
      setPersistedFocus(qpItemId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qpItemId]);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [eventsMissingItemId, setEventsMissingItemId] = useState([]);
  const [eventsMissingQtyDelta, setEventsMissingQtyDelta] = useState([]);
  const [eventsNegativeQtyDelta, setEventsNegativeQtyDelta] = useState([]);
  const [itemsNegativeTotals, setItemsNegativeTotals] = useState([]);

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const r = await asoraGetJson("/v1/ledger/events", {});
      const events = Array.isArray(r?.events) ? r.events : [];

      const missingItemId = [];
      const missingQtyDelta = [];
      const negativeQtyDelta = [];
      const totals = new Map();

      for (const e of events) {
        if (!e || typeof e !== "object") continue;

        const itemId = e.itemId;
        const hasItemId = typeof itemId === "string" && itemId.trim() !== "";

        const q = e.qtyDelta;
        const hasQtyDelta = isFiniteNumber(q);

        if (!hasItemId) {
          missingItemId.push(e);
          continue;
        }

        if (!hasQtyDelta) {
          missingQtyDelta.push(e);
          continue;
        }

        if (q < 0) negativeQtyDelta.push(e);
        totals.set(itemId, (totals.get(itemId) || 0) + q);
      }

      const byTsThenId = (a, b) => {
        const ta = typeof a?.ts === "string" ? a.ts : "";
        const tb = typeof b?.ts === "string" ? b.ts : "";
        if (ta < tb) return -1;
        if (ta > tb) return 1;
        const ia = typeof a?.id === "string" ? a.id : "";
        const ib = typeof b?.id === "string" ? b.id : "";
        return ia.localeCompare(ib);
      };

      const byItemThenTsThenId = (a, b) => {
        const ia = typeof a?.itemId === "string" ? a.itemId : "";
        const ib = typeof b?.itemId === "string" ? b.itemId : "";
        const c = ia.localeCompare(ib);
        if (c !== 0) return c;
        return byTsThenId(a, b);
      };

      const negTotals = Array.from(totals.entries())
        .map(([itemId, derivedQuantity]) => ({ itemId, derivedQuantity }))
        .filter((x) => isFiniteNumber(x.derivedQuantity) && x.derivedQuantity < 0)
        .sort((a, b) => a.itemId.localeCompare(b.itemId));

      setEventsMissingItemId([...missingItemId].sort(byTsThenId));
      setEventsMissingQtyDelta([...missingQtyDelta].sort(byItemThenTsThenId));
      setEventsNegativeQtyDelta([...negativeQtyDelta].sort(byItemThenTsThenId));
      setItemsNegativeTotals(negTotals);
    } catch (e) {
      setErr(e?.message || "Failed to load ledger events.");
      setEventsMissingItemId([]);
      setEventsMissingQtyDelta([]);
      setEventsNegativeQtyDelta([]);
      setItemsNegativeTotals([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const focus = (focusItemId || "").trim();

  const filteredMissingQtyDelta = useMemo(() => {
    if (!focus) return eventsMissingQtyDelta;
    return eventsMissingQtyDelta.filter((e) => typeof e?.itemId === "string" && e.itemId === focus);
  }, [eventsMissingQtyDelta, focus]);

  const filteredNegativeQtyDelta = useMemo(() => {
    if (!focus) return eventsNegativeQtyDelta;
    return eventsNegativeQtyDelta.filter((e) => typeof e?.itemId === "string" && e.itemId === focus);
  }, [eventsNegativeQtyDelta, focus]);

  const filteredNegativeTotals = useMemo(() => {
    if (!focus) return itemsNegativeTotals;
    return itemsNegativeTotals.filter((r) => r.itemId === focus);
  }, [itemsNegativeTotals, focus]);

  const totals = useMemo(() => {
    return {
      missingItemId: eventsMissingItemId.length,
      missingQtyDelta: filteredMissingQtyDelta.length,
      negativeQtyDelta: filteredNegativeQtyDelta.length,
      negativeTotals: filteredNegativeTotals.length,
    };
  }, [eventsMissingItemId.length, filteredMissingQtyDelta.length, filteredNegativeQtyDelta.length, filteredNegativeTotals.length]);

  const s = isCompact ? compact : styles;

  return (
    <main style={s.shell}>
      <CompactBar here="Anomalies" />

      <header style={s.header}>
        <div style={s.title}>Inventory Anomalies</div>
        <div style={s.sub}>Integrity signals derived from ledger events (diagnostic only). Focus is saved locally.</div>
      </header>

      <section style={s.card}>
        <div style={s.controls}>
          <label style={s.label}>
            Focus itemId (optional)
            <input
              style={s.input}
              value={focusItemId}
              onChange={(e) => {
                const v = e.target.value;
                setFocusItemId(v);
                setPersistedFocus(v);
              }}
              placeholder="e.g. ITEM-123"
            />
          </label>

          <button style={s.button} onClick={load} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>

          {focus ? (
            <div style={s.quickLinks}>
              <Link style={s.link} href={itemHref(focus)}>
                Drill-down for {focus}
              </Link>
              <span style={s.dot}>·</span>
              <Link style={s.linkSecondary} href={movementsHref(focus)}>
                Movements for {focus}
              </Link>
            </div>
          ) : null}

          <div style={s.meta}>
            Missing itemId: <span style={s.mono}>{totals.missingItemId}</span> | Missing qtyDelta:{" "}
            <span style={s.mono}>{totals.missingQtyDelta}</span> | Negative qtyDelta:{" "}
            <span style={s.mono}>{totals.negativeQtyDelta}</span> | Negative totals:{" "}
            <span style={s.mono}>{totals.negativeTotals}</span>
          </div>
        </div>

        {err ? <div style={s.err}>Error: {err}</div> : null}
      </section>

      <section style={s.card}>
        <div style={s.sectionTitle}>1) Events Missing itemId</div>
        <div style={s.sectionSub}>These events cannot be attributed to an item; excluded from per-item derivations.</div>

        {eventsMissingItemId.length === 0 && !loading ? (
          <div style={s.empty}>None detected.</div>
        ) : (
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>ts</th>
                  <th style={s.thRight}>qtyDelta</th>
                  <th style={s.th}>eventType</th>
                  <th style={s.th}>id</th>
                </tr>
              </thead>
              <tbody>
                {eventsMissingItemId.map((e, idx) => {
                  const ts = typeof e?.ts === "string" ? e.ts : "—";
                  const q = e?.qtyDelta;
                  const eventType = typeof e?.eventType === "string" ? e.eventType : "—";
                  const id = typeof e?.id === "string" ? e.id : "—";
                  const key = (typeof e?.id === "string" && e.id) || `${ts}:${idx}`;

                  return (
                    <tr key={key}>
                      <td style={s.td}>
                        <span style={s.mono}>{ts}</span>
                      </td>
                      <td style={s.tdRight}>
                        <span style={s.mono}>{isFiniteNumber(q) ? q : "—"}</span>
                      </td>
                      <td style={s.td}>{eventType}</td>
                      <td style={s.td}>
                        <span style={s.monoSmall}>{id}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={s.card}>
        <div style={s.sectionTitle}>2) Events Missing qtyDelta (by itemId)</div>
        <div style={s.sectionSub}>These events are attributable to an itemId but cannot contribute to derived quantities.</div>

        {filteredMissingQtyDelta.length === 0 && !loading ? (
          <div style={s.empty}>None detected.</div>
        ) : (
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>itemId</th>
                  <th style={s.th}>ts</th>
                  <th style={s.th}>eventType</th>
                  <th style={s.th}>Links</th>
                </tr>
              </thead>
              <tbody>
                {filteredMissingQtyDelta.map((e, idx) => {
                  const itemId = typeof e?.itemId === "string" ? e.itemId : "";
                  const ts = typeof e?.ts === "string" ? e.ts : "—";
                  const eventType = typeof e?.eventType === "string" ? e.eventType : "—";
                  const key = (typeof e?.id === "string" && e.id) || `${itemId}:${ts}:${idx}`;

                  return (
                    <tr key={key}>
                      <td style={s.td}>
                        <span style={s.mono}>{itemId || "—"}</span>
                      </td>
                      <td style={s.td}>
                        <span style={s.mono}>{ts}</span>
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
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={s.card}>
        <div style={s.sectionTitle}>3) Events With Negative qtyDelta (by itemId)</div>
        <div style={s.sectionSub}>These events reduce derived on-hand totals (no clamping).</div>

        {filteredNegativeQtyDelta.length === 0 && !loading ? (
          <div style={s.empty}>None detected.</div>
        ) : (
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>itemId</th>
                  <th style={s.th}>ts</th>
                  <th style={s.thRight}>qtyDelta</th>
                  <th style={s.th}>eventType</th>
                  <th style={s.th}>Links</th>
                </tr>
              </thead>
              <tbody>
                {filteredNegativeQtyDelta.map((e, idx) => {
                  const itemId = typeof e?.itemId === "string" ? e.itemId : "";
                  const ts = typeof e?.ts === "string" ? e.ts : "—";
                  const q = e?.qtyDelta;
                  const eventType = typeof e?.eventType === "string" ? e.eventType : "—";
                  const key = (typeof e?.id === "string" && e.id) || `${itemId}:${ts}:${idx}`;

                  return (
                    <tr key={key}>
                      <td style={s.td}>
                        <span style={s.mono}>{itemId || "—"}</span>
                      </td>
                      <td style={s.td}>
                        <span style={s.mono}>{ts}</span>
                      </td>
                      <td style={{ ...s.tdRight, ...s.neg }}>
                        <span style={s.mono}>{isFiniteNumber(q) ? q : "—"}</span>
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
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={s.card}>
        <div style={s.sectionTitle}>4) Items With Negative Derived Totals</div>
        <div style={s.sectionSub}>Items whose ledger-derived on-hand total is below zero.</div>

        {filteredNegativeTotals.length === 0 && !loading ? (
          <div style={s.empty}>None detected.</div>
        ) : (
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>itemId</th>
                  <th style={s.thRight}>derivedQuantity</th>
                  <th style={s.th}>Links</th>
                </tr>
              </thead>
              <tbody>
                {filteredNegativeTotals.map((r) => (
                  <tr key={r.itemId}>
                    <td style={s.td}>
                      <span style={s.mono}>{r.itemId}</span>
                    </td>
                    <td style={{ ...s.tdRight, ...s.neg }}>
                      <span style={s.mono}>{r.derivedQuantity}</span>
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
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={s.card}>
        <div style={s.noteTitle}>Notes</div>
        <ul style={s.ul}>
          <li>URL itemId overrides saved focus and will be persisted.</li>
          <li>Missing itemId events are excluded from item-level derivations by definition.</li>
          <li>Missing qtyDelta events do not contribute to derived totals.</li>
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
  controls: { display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" },
  label: { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "#222" },
  input: { width: 320, padding: "8px 10px", borderRadius: 10, border: "1px solid #ccc", outline: "none", fontSize: 13 },
  button: { padding: "8px 12px", borderRadius: 10, border: "1px solid #111", background: "#111", color: "#fff", cursor: "pointer", fontSize: 13, height: 34 },

  quickLinks: { fontSize: 13, paddingBottom: 2, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  dot: { color: "#999" },
  meta: { fontSize: 13, color: "#444", paddingBottom: 2 },

  err: { marginTop: 10, color: "#b00020", fontSize: 13 },
  empty: { marginTop: 10, color: "#666", fontSize: 13 },

  tableWrap: { width: "100%", overflowX: "auto", marginTop: 12 },
  table: { borderCollapse: "collapse", width: "100%" },
  th: { textAlign: "left", fontSize: 12, color: "#444", borderBottom: "1px solid #eee", padding: "10px 8px" },
  thRight: { textAlign: "right", fontSize: 12, color: "#444", borderBottom: "1px solid #eee", padding: "10px 8px" },
  td: { padding: "10px 8px", borderBottom: "1px solid #f0f0f0", fontSize: 13, verticalAlign: "top" },
  tdRight: { padding: "10px 8px", borderBottom: "1px solid #f0f0f0", fontSize: 13, textAlign: "right", verticalAlign: "top" },

  sectionTitle: { fontSize: 14, fontWeight: 700 },
  sectionSub: { marginTop: 6, color: "#666", fontSize: 13, lineHeight: 1.35 },

  linkRow: { display: "flex", gap: 10, flexWrap: "wrap" },
  link: { color: "#0b57d0", textDecoration: "none", fontSize: 13 },
  linkSecondary: { color: "#444", textDecoration: "none", fontSize: 13 },

  muted: { color: "#777" },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },
  monoSmall: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12 },
  neg: { color: "#b00020", fontWeight: 700 },

  noteTitle: { fontSize: 14, fontWeight: 700, marginBottom: 8 },
  ul: { margin: 0, paddingLeft: 18, color: "#333", fontSize: 13, lineHeight: 1.5 },
};

const compact = {
  ...styles,
  shell: { ...styles.shell, padding: 14 },
  header: { marginBottom: 10 },
  title: { fontSize: 18, fontWeight: 750 },
  sub: { ...styles.sub, fontSize: 12 },

  card: { ...styles.card, padding: 12, marginBottom: 12 },
  label: { ...styles.label, fontSize: 12 },
  input: { ...styles.input, padding: "6px 8px", fontSize: 12 },
  button: { ...styles.button, padding: "6px 10px", fontSize: 12, height: 30 },

  quickLinks: { ...styles.quickLinks, fontSize: 12 },
  meta: { ...styles.meta, fontSize: 12 },

  err: { ...styles.err, fontSize: 12 },
  empty: { ...styles.empty, fontSize: 12 },

  th: { ...styles.th, padding: "8px 6px", fontSize: 11 },
  thRight: { ...styles.thRight, padding: "8px 6px", fontSize: 11 },
  td: { ...styles.td, padding: "8px 6px", fontSize: 12 },
  tdRight: { ...styles.tdRight, padding: "8px 6px", fontSize: 12 },

  sectionTitle: { ...styles.sectionTitle, fontSize: 13 },
  sectionSub: { ...styles.sectionSub, fontSize: 12 },

  link: { ...styles.link, fontSize: 12 },
  linkSecondary: { ...styles.linkSecondary, fontSize: 12 },

  noteTitle: { ...styles.noteTitle, fontSize: 13 },
  ul: { ...styles.ul, fontSize: 12 },
};
