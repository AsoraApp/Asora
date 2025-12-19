"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { asoraGetJson } from "@/lib/asoraFetch";

export const runtime = "edge";

function movementsHref(itemId) {
  return `/inventory/movements?itemId=${encodeURIComponent(String(itemId))}`;
}

export default function InventoryItemDrillDownPage() {
  const sp = useSearchParams();
  const initialItemId = sp?.get("itemId") || "";

  const [itemId, setItemId] = useState(initialItemId);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [events, setEvents] = useState([]);
  const [missingQtyDeltaCount, setMissingQtyDeltaCount] = useState(0);

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

      // Deterministic chronological order.
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

  useEffect(() => {
    // Preload if itemId is supplied via query string
    if (initialItemId.trim()) load(initialItemId);
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

  const iid = itemId.trim();

  return (
    <main style={styles.shell}>
      <header style={styles.header}>
        <div style={styles.title}>Item Drill-Down</div>
        <div style={styles.sub}>Ledger events affecting a single itemId (read-only; deterministic ordering).</div>
      </header>

      <section style={styles.card}>
        <div style={styles.controls}>
          <label style={styles.label}>
            itemId
            <input
              style={styles.input}
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
              placeholder="Enter itemId"
            />
          </label>
          <button style={styles.button} onClick={() => load(itemId)} disabled={loading}>
            {loading ? "Loading..." : "Load"}
          </button>

          {iid ? (
            <div style={styles.links}>
              <Link style={styles.link} href={movementsHref(iid)}>
                View movements for {iid}
              </Link>
            </div>
          ) : null}
        </div>

        {err ? <div style={styles.err}>Error: {err}</div> : null}

        {iid ? (
          <div style={styles.summaryRow}>
            <div>
              Derived total qtyDelta: <span style={styles.mono}>{derivedTotal}</span>
            </div>
            <div style={styles.muted}>
              Events missing numeric qtyDelta: <span style={styles.mono}>{missingQtyDeltaCount}</span>
            </div>
            <div style={styles.muted}>
              Total events shown: <span style={styles.mono}>{events.length}</span>
            </div>
          </div>
        ) : (
          <div style={styles.empty}>Enter an itemId to view its ledger-derived history.</div>
        )}

        {iid && events.length === 0 && !loading ? <div style={styles.empty}>No events found for this itemId.</div> : null}

        {events.length > 0 ? (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>ts</th>
                  <th style={styles.thRight}>qtyDelta</th>
                  <th style={styles.th}>eventType</th>
                  <th style={styles.th}>details</th>
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
                      <td style={styles.td}>
                        <span style={styles.mono}>{ts}</span>
                      </td>
                      <td style={{ ...styles.tdRight, ...(neg ? styles.neg : null) }}>
                        <span style={styles.mono}>{typeof q === "number" ? q : "—"}</span>
                      </td>
                      <td style={styles.td}>{eventType}</td>
                      <td style={styles.td}>
                        <span style={styles.monoSmall}>{details || "—"}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section style={styles.card}>
        <div style={styles.noteTitle}>Notes</div>
        <ul style={styles.ul}>
          <li>Query parameter support: /inventory/item?itemId=… pre-fills and auto-loads on first render.</li>
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
  card: {
    border: "1px solid #e5e5e5",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    background: "#fff",
  },
  controls: { display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" },
  label: { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "#222" },
  input: {
    width: 320,
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid #ccc",
    outline: "none",
    fontSize: 13,
  },
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
  tdRight: {
    padding: "10px 8px",
    borderBottom: "1px solid #f0f0f0",
    fontSize: 13,
    textAlign: "right",
    verticalAlign: "top",
  },
  neg: { color: "#b00020", fontWeight: 700 },
  muted: { color: "#666" },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },
  monoSmall: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12 },
  noteTitle: { fontSize: 14, fontWeight: 700, marginBottom: 8 },
  ul: { margin: 0, paddingLeft: 18, color: "#333", fontSize: 13, lineHeight: 1.5 },
};
