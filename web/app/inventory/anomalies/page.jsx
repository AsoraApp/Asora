"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { asoraGetJson } from "@/lib/asoraFetch";

export const runtime = "edge";

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
  const sp = useSearchParams();
  const initialFocus = sp?.get("itemId") || "";

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [focusItemId, setFocusItemId] = useState(initialFocus);

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

  return (
    <main style={styles.shell}>
      <header style={styles.topbar}>
        <div style={styles.brandRow}>
          <div style={styles.brand}>Asora</div>
          <div style={styles.nav}>
            <Link href="/" style={styles.navLink}>
              Home
            </Link>
            <span style={styles.navSep}>/</span>
            <Link href="/inventory/items" style={styles.navLink}>
              Inventory Items
            </Link>
          </div>
        </div>
      </header>

      <header style={styles.header}>
        <div style={styles.title}>Inventory Anomalies</div>
        <div style={styles.sub}>
          Integrity signals derived from ledger events (diagnostic only; no correction or mutation). Deterministic sorting.
        </div>
      </header>

      <section style={styles.card}>
        <div style={styles.controls}>
          <label style={styles.label}>
            Focus itemId (optional)
            <input
              style={styles.input}
              value={focusItemId}
              onChange={(e) => setFocusItemId(e.target.value)}
              placeholder="e.g. ITEM-123"
            />
          </label>

          <button style={styles.button} onClick={load} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>

          {focus ? (
            <div style={styles.quickLinks}>
              <Link style={styles.link} href={itemHref(focus)}>
                Drill-down for {focus}
              </Link>
              <span style={styles.dot}>·</span>
              <Link style={styles.linkSecondary} href={movementsHref(focus)}>
                Movements for {focus}
              </Link>
            </div>
          ) : null}

          <div style={styles.meta}>
            Missing itemId: <span style={styles.mono}>{totals.missingItemId}</span> | Missing qtyDelta:{" "}
            <span style={styles.mono}>{totals.missingQtyDelta}</span> | Negative qtyDelta:{" "}
            <span style={styles.mono}>{totals.negativeQtyDelta}</span> | Negative totals:{" "}
            <span style={styles.mono}>{totals.negativeTotals}</span>
          </div>
        </div>

        {err ? <div style={styles.err}>Error: {err}</div> : null}
      </section>

      <section style={styles.card}>
        <div style={styles.sectionTitle}>1) Events Missing itemId</div>
        <div style={styles.sectionSub}>These events cannot be attributed to an item; they are excluded from all per-item derivations.</div>

        {eventsMissingItemId.length === 0 && !loading ? (
          <div style={styles.empty}>None detected.</div>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>ts</th>
                  <th style={styles.thRight}>qtyDelta</th>
                  <th style={styles.th}>eventType</th>
                  <th style={styles.th}>id</th>
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
                      <td style={styles.td}>
                        <span style={styles.mono}>{ts}</span>
                      </td>
                      <td style={styles.tdRight}>
                        <span style={styles.mono}>{isFiniteNumber(q) ? q : "—"}</span>
                      </td>
                      <td style={styles.td}>{eventType}</td>
                      <td style={styles.td}>
                        <span style={styles.monoSmall}>{id}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={styles.card}>
        <div style={styles.sectionTitle}>2) Events Missing qtyDelta (by itemId)</div>
        <div style={styles.sectionSub}>These events are attributable to an itemId but cannot contribute to derived quantities.</div>

        {filteredMissingQtyDelta.length === 0 && !loading ? (
          <div style={styles.empty}>None detected.</div>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>itemId</th>
                  <th style={styles.th}>ts</th>
                  <th style={styles.th}>eventType</th>
                  <th style={styles.th}>Links</th>
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
                      <td style={styles.td}>
                        <span style={styles.mono}>{itemId || "—"}</span>
                      </td>
                      <td style={styles.td}>
                        <span style={styles.mono}>{ts}</span>
                      </td>
                      <td style={styles.td}>{eventType}</td>
                      <td style={styles.td}>
                        {itemId ? (
                          <div style={styles.linkRow}>
                            <Link style={styles.link} href={itemHref(itemId)}>
                              Drill-down
                            </Link>
                            <Link style={styles.linkSecondary} href={movementsHref(itemId)}>
                              Movements
                            </Link>
                          </div>
                        ) : (
                          <span style={styles.muted}>—</span>
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

      <section style={styles.card}>
        <div style={styles.sectionTitle}>3) Events With Negative qtyDelta (by itemId)</div>
        <div style={styles.sectionSub}>These events reduce derived on-hand totals (no clamping).</div>

        {filteredNegativeQtyDelta.length === 0 && !loading ? (
          <div style={styles.empty}>None detected.</div>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>itemId</th>
                  <th style={styles.th}>ts</th>
                  <th style={styles.thRight}>qtyDelta</th>
                  <th style={styles.th}>eventType</th>
                  <th style={styles.th}>Links</th>
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
                      <td style={styles.td}>
                        <span style={styles.mono}>{itemId || "—"}</span>
                      </td>
                      <td style={styles.td}>
                        <span style={styles.mono}>{ts}</span>
                      </td>
                      <td style={{ ...styles.tdRight, ...styles.neg }}>
                        <span style={styles.mono}>{isFiniteNumber(q) ? q : "—"}</span>
                      </td>
                      <td style={styles.td}>{eventType}</td>
                      <td style={styles.td}>
                        {itemId ? (
                          <div style={styles.linkRow}>
                            <Link style={styles.link} href={itemHref(itemId)}>
                              Drill-down
                            </Link>
                            <Link style={styles.linkSecondary} href={movementsHref(itemId)}>
                              Movements
                            </Link>
                          </div>
                        ) : (
                          <span style={styles.muted}>—</span>
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

      <section style={styles.card}>
        <div style={styles.sectionTitle}>4) Items With Negative Derived Totals</div>
        <div style={styles.sectionSub}>Items whose ledger-derived on-hand total is below zero.</div>

        {filteredNegativeTotals.length === 0 && !loading ? (
          <div style={styles.empty}>None detected.</div>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>itemId</th>
                  <th style={styles.thRight}>derivedQuantity</th>
                  <th style={styles.th}>Links</th>
                </tr>
              </thead>
              <tbody>
                {filteredNegativeTotals.map((r) => (
                  <tr key={r.itemId}>
                    <td style={styles.td}>
                      <span style={styles.mono}>{r.itemId}</span>
                    </td>
                    <td style={{ ...styles.tdRight, ...styles.neg }}>
                      <span style={styles.mono}>{r.derivedQuantity}</span>
                    </td>
                    <td style={styles.td}>
                      <div style={styles.linkRow}>
                        <Link style={styles.link} href={itemHref(r.itemId)}>
                          Drill-down
                        </Link>
                        <Link style={styles.linkSecondary} href={movementsHref(r.itemId)}>
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

      <section style={styles.card}>
        <div style={styles.noteTitle}>Notes</div>
        <ul style={styles.ul}>
          <li>Query parameter support: /inventory/anomalies?itemId=… focuses all item-scoped anomaly tables to one item.</li>
          <li>Missing itemId events are excluded from item-level derivations by definition.</li>
          <li>Missing qtyDelta events do not contribute to derived totals.</li>
        </ul>
      </section>
    </main>
  );
}

const styles = {
  shell: { minHeight: "100vh", padding: 24, fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto" },

  topbar: { marginBottom: 14 },
  brandRow: { display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 10 },
  brand: { fontSize: 16, fontWeight: 800, letterSpacing: 0.2 },
  nav: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  navLink: { color: "#0b57d0", textDecoration: "none", fontSize: 13 },
  navSep: { color: "#999", fontSize: 13 },

  header: { marginBottom: 16 },
  title: { fontSize: 22, fontWeight: 700 },
  sub: { marginTop: 6, color: "#555", fontSize: 13, lineHeight: 1.35 },

  card: { border: "1px solid #e5e5e5", borderRadius: 12, padding: 16, marginBottom: 16, background: "#fff" },
  controls: { display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" },
  label: { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "#222" },
  input: { width: 320, padding: "8px 10px", borderRadius: 10, border: "1px solid #ccc", outline: "none", fontSize: 13 },
  button: {
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid #111",
    background: "#111",
    color: "#fff",
    cursor: "pointer",
    fontSize: 13,
    height: 34,
  },
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
