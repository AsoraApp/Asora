"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { asoraGetJson } from "@/lib/asoraFetch";
import CompactBar, { useDensity } from "../_ui/CompactBar.jsx";
import { usePersistedString } from "../_ui/useViewState.jsx";

export const runtime = "edge";

const STORE_KEY = "asora_view:item:itemId";

function movementsHref(itemId) {
  return `/inventory/movements?itemId=${encodeURIComponent(String(itemId))}`;
}

export default function InventoryItemDrillDownPage() {
  const { isCompact } = useDensity();

  const sp = useSearchParams();
  const qpItemId = sp?.get("itemId") || "";

  const [persistedItemId, setPersistedItemId] = usePersistedString(STORE_KEY, "");
  const [itemId, setItemId] = useState(qpItemId || persistedItemId);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [events, setEvents] = useState([]);
  const [missingQtyDeltaCount, setMissingQtyDeltaCount] = useState(0);

  // If URL itemId changes, adopt it and persist it.
  useEffect(() => {
    if (qpItemId && qpItemId !== itemId) {
      setItemId(qpItemId);
      setPersistedItemId(qpItemId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qpItemId]);

  async function load(forItemId) {
    const iid = (forItemId || "").trim();
    if (!iid) {
      setEvents([]);
      setMissingQtyDeltaCount(0);
      setErr("");
      return;
    }

    setLoading(true);
    setErr("");
    try {
      const r = await asoraGetJson("/v1/ledger/events", {});
      const list = Array.isArray(r?.events) ? r.events : [];

      const filtered = list.filter((e) => typeof e?.itemId === "string" && e.itemId === iid);

      const sorted = [...filtered].sort((a, b) => {
        const ta = typeof a?.ts === "string" ? a.ts : "";
        const tb = typeof b?.ts === "string" ? b.ts : "";
        if (ta < tb) return -1;
        if (ta > tb) return 1;
        const ia = typeof a?.id === "string" ? a.id : "";
        const ib = typeof b?.id === "string" ? b.id : "";
        return ia.localeCompare(ib);
      });

      let missing = 0;
      for (const e of sorted) {
        const q = e?.qtyDelta;
        if (typeof q !== "number" || Number.isNaN(q) || !Number.isFinite(q)) missing += 1;
      }

      setEvents(sorted);
      setMissingQtyDeltaCount(missing);
    } catch (e) {
      setErr(e?.message || "Failed to load ledger events.");
      setEvents([]);
      setMissingQtyDeltaCount(0);
    } finally {
      setLoading(false);
    }
  }

  // Auto-load on first mount if we have an initial id (qp or persisted).
  useEffect(() => {
    const iid = (itemId || "").trim();
    if (iid) load(iid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const derivedTotal = useMemo(() => {
    let sum = 0;
    for (const e of events) {
      const q = e?.qtyDelta;
      if (typeof q === "number" && Number.isFinite(q)) sum += q;
    }
    return sum;
  }, [events]);

  const iid = (itemId || "").trim();
  const s = isCompact ? compact : styles;

  return (
    <main style={s.shell}>
      <CompactBar here="Item Drill-Down" />

      <header style={s.header}>
        <div style={s.title}>Item Drill-Down</div>
        <div style={s.sub}>Ledger events affecting a single itemId (read-only). itemId is saved locally.</div>
      </header>

      <section style={s.card}>
        <div style={s.controls}>
          <label style={s.label}>
            itemId
            <input
              style={s.input}
              value={itemId}
              onChange={(e) => {
                const v = e.target.value;
                setItemId(v);
                setPersistedItemId(v);
              }}
              placeholder="Enter itemId"
            />
          </label>
          <button
            style={s.button}
            onClick={() => {
              setPersistedItemId(itemId);
              load(itemId);
            }}
            disabled={loading}
          >
            {loading ? "Loading..." : "Load"}
          </button>

          {iid ? (
            <div style={s.links}>
              <Link style={s.link} href={movementsHref(iid)}>
                View movements for {iid}
              </Link>
            </div>
          ) : null}
        </div>

        {err ? <div style={s.err}>Error: {err}</div> : null}

        {iid ? (
          <div style={s.summaryRow}>
            <div>
              Derived total qtyDelta: <span style={s.mono}>{derivedTotal}</span>
            </div>
            <div style={s.muted}>
              Events missing numeric qtyDelta: <span style={s.mono}>{missingQtyDeltaCount}</span>
            </div>
            <div style={s.muted}>
              Total events shown: <span style={s.mono}>{events.length}</span>
            </div>
          </div>
        ) : (
          <div style={s.empty}>Enter an itemId to view its ledger-derived history.</div>
        )}

        {iid && events.length === 0 && !loading ? <div style={s.empty}>No events found for this itemId.</div> : null}

        {events.length > 0 ? (
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>ts</th>
                  <th style={s.thRight}>qtyDelta</th>
                  <th style={s.th}>eventType</th>
                  <th style={s.th}>details</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, idx) => {
                  const ts = typeof e?.ts === "string" ? e.ts : "—";
                  const q = e?.qtyDelta;
                  const neg = typeof q === "number" && q < 0;
                  const eventType = typeof e?.eventType === "string" ? e.eventType : "—";
                  const details = e?.details && typeof e.details === "object" ? JSON.stringify(e.details) : "";
                  const key = (typeof e?.id === "string" && e.id) || `${ts}:${idx}`;

                  return (
                    <tr key={key}>
                      <td style={s.td}>
                        <span style={s.mono}>{ts}</span>
                      </td>
                      <td style={{ ...s.tdRight, ...(neg ? s.neg : null) }}>
                        <span style={s.mono}>{typeof q === "number" ? q : "—"}</span>
                      </td>
                      <td style={s.td}>{eventType}</td>
                      <td style={s.td}>
                        <span style={s.monoSmall}>{details || "—"}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section style={s.card}>
        <div style={s.noteTitle}>Notes</div>
        <ul style={s.ul}>
          <li>URL itemId overrides saved value and will be persisted.</li>
          <li>Derived totals are computed client-side by summing numeric qtyDelta values only.</li>
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
  links: { fontSize: 13, paddingBottom: 2 },
  link: { color: "#0b57d0", textDecoration: "none", fontSize: 13 },

  summaryRow: { marginTop: 12, display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13, alignItems: "center" },
  err: { marginTop: 10, color: "#b00020", fontSize: 13 },
  empty: { marginTop: 12, color: "#666", fontSize: 13 },

  tableWrap: { width: "100%", overflowX: "auto", marginTop: 12 },
  table: { borderCollapse: "collapse", width: "100%" },
  th: { textAlign: "left", fontSize: 12, color: "#444", borderBottom: "1px solid #eee", padding: "10px 8px" },
  thRight: { textAlign: "right", fontSize: 12, color: "#444", borderBottom: "1px solid #eee", padding: "10px 8px" },
  td: { padding: "10px 8px", borderBottom: "1px solid #f0f0f0", fontSize: 13, verticalAlign: "top" },
  tdRight: { padding: "10px 8px", borderBottom: "1px solid #f0f0f0", fontSize: 13, textAlign: "right", verticalAlign: "top" },
  neg: { color: "#b00020", fontWeight: 700 },
  muted: { color: "#666" },

  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },
  monoSmall: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12 },

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

  links: { ...styles.links, fontSize: 12 },
  link: { ...styles.link, fontSize: 12 },

  summaryRow: { ...styles.summaryRow, fontSize: 12, marginTop: 10 },
  err: { ...styles.err, fontSize: 12 },
  empty: { ...styles.empty, fontSize: 12 },

  th: { ...styles.th, padding: "8px 6px", fontSize: 11 },
  thRight: { ...styles.thRight, padding: "8px 6px", fontSize: 11 },
  td: { ...styles.td, padding: "8px 6px", fontSize: 12 },
  tdRight: { ...styles.tdRight, padding: "8px 6px", fontSize: 12 },

  noteTitle: { ...styles.noteTitle, fontSize: 13 },
  ul: { ...styles.ul, fontSize: 12 },
};
