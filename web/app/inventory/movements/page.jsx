"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { asoraGetJson } from "@/lib/asoraFetch";
import CompactBar, { useDensity } from "../_ui/CompactBar.jsx";
import { usePersistedString } from "../_ui/useViewState.jsx";
import { clearLedgerCache, getLedgerEventsCached } from "@/lib/ledgerCache";
import LedgerFreshnessBar from "../_ui/LedgerFreshnessBar.jsx";
import { downloadCsvFromRows } from "../_ui/csv.js";

export const runtime = "edge";

const PAGE_SIZE = 500;
const FOCUS_STORE_KEY = "asora_view:movements:focusItemId";

function itemHref(itemId) {
  return `/inventory/item?itemId=${encodeURIComponent(String(itemId))}`;
}

export default function InventoryMovementsPage() {
  const { isCompact } = useDensity();
  const s = isCompact ? compact : styles;

  const sp = useSearchParams();
  const qpItemId = sp?.get("itemId") || "";

  const [focusItemId, setFocusItemId] = usePersistedString(FOCUS_STORE_KEY, qpItemId);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [page, setPage] = useState(1);
  const [lastFetchedUtc, setLastFetchedUtc] = useState("");
  const [cacheStatus, setCacheStatus] = useState("cached");

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
        const ta = a?.ts || "";
        const tb = b?.ts || "";
        if (ta < tb) return -1;
        if (ta > tb) return 1;
        return String(a?.ledgerEventId || "").localeCompare(
          String(b?.ledgerEventId || "")
        );
      });

      setEvents(sorted);
      setLastFetchedUtc(new Date().toISOString());
    } catch (e) {
      setErr(e?.message || "Failed to load ledger movements.");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load({ force: false });
  }, []);

  const focus = (focusItemId || "").trim();

  const filtered = useMemo(() => {
    if (!focus) return events;
    return events.filter((e) => e?.itemId === focus);
  }, [events, focus]);

  useEffect(() => setPage(1), [filtered.length, focus]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice(0, Math.min(filtered.length, page * PAGE_SIZE));

  function exportCsv() {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `asora_inventory_movements_${ts}.csv`;

    downloadCsvFromRows(
      filename,
      ["ts", "ledgerEventId", "eventType", "itemId", "qtyDelta"],
      visible.map((e) => ({
        ts: e?.ts || "",
        ledgerEventId: e?.ledgerEventId || "",
        eventType: e?.eventType || "",
        itemId: e?.itemId || "",
        qtyDelta: e?.qtyDelta ?? "",
      }))
    );
  }

  return (
    <main style={s.shell}>
      <section style={s.card}>
        <div style={s.controls}>
          <LedgerFreshnessBar
            lastFetchedUtc={lastFetchedUtc}
            cacheStatus={cacheStatus}
            onRefresh={() => load({ force: false })}
            onForceRefresh={() => load({ force: true })}
          />

          <button style={s.button} onClick={() => load({ force: false })} disabled={loading}>
            Refresh (cached)
          </button>
          <button style={s.buttonSecondary} onClick={() => load({ force: true })} disabled={loading}>
            Refresh (force)
          </button>
          <button style={s.buttonSecondary} onClick={exportCsv} disabled={visible.length === 0}>
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
            Events: <span style={s.mono}>{filtered.length}</span>
          </div>
        </div>

        {err ? <div style={s.err}>Error: {err}</div> : null}
        {filtered.length === 0 && !loading ? <div style={s.empty}>No movements.</div> : null}

        {filtered.length > 0 && (
          <div style={s.pagerRow}>
            <button style={s.pagerBtn} onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              Prev
            </button>
            <div style={s.pagerText}>
              Page <span style={s.mono}>{page}</span> / <span style={s.mono}>{pageCount}</span>
            </div>
            <button
              style={s.pagerBtn}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={page >= pageCount}
            >
              Next
            </button>
          </div>
        )}

        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>ts</th>
                <th style={s.th}>eventType</th>
                <th style={s.th}>itemId</th>
                <th style={s.thRight}>qtyDelta</th>
                <th style={s.th}>Links</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e, i) => (
                <tr key={e?.ledgerEventId || `${e?.ts || "no-ts"}-${i}`}>
                  <td style={s.td}><span style={s.mono}>{e?.ts || ""}</span></td>
                  <td style={s.td}>{e?.eventType || ""}</td>
                  <td style={s.td}><span style={s.mono}>{e?.itemId || ""}</span></td>
                  <td style={s.tdRight}><span style={s.mono}>{e?.qtyDelta ?? ""}</span></td>
                  <td style={s.td}>
                    {e?.itemId && (
                      <Link style={s.link} href={itemHref(e.itemId)}>
                        Drill-down
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

const styles = {
  shell: { minHeight: "100vh", padding: 24 },
  card: { border: "1px solid #e5e5e5", borderRadius: 12, padding: 16 },
  controls: { display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" },
  label: { display: "flex", flexDirection: "column", fontSize: 13 },
  input: { width: 260, padding: "8px 10px", borderRadius: 10, border: "1px solid #ccc" },
  button: { padding: "8px 12px", borderRadius: 10, background: "#111", color: "#fff" },
  buttonSecondary: { padding: "8px 12px", borderRadius: 10, border: "1px solid #bbb", background: "#fff" },
  meta: { fontSize: 13 },
  err: { color: "#b00020" },
  empty: { color: "#666" },
  pagerRow: { display: "flex", gap: 10, marginTop: 10 },
  pagerBtn: { padding: "6px 10px" },
  pagerText: { fontSize: 13 },
  tableWrap: { overflowX: "auto", marginTop: 12 },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", borderBottom: "1px solid #eee" },
  thRight: { textAlign: "right", borderBottom: "1px solid #eee" },
  td: { padding: "8px" },
  tdRight: { padding: "8px", textAlign: "right" },
  link: { color: "#0b57d0", textDecoration: "none" },
  mono: { fontFamily: "ui-monospace, monospace" },
};

const compact = styles;
