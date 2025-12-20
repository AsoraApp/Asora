"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { asoraGetJson } from "@/lib/asoraFetch";
import CompactBar, { useDensity } from "../_ui/CompactBar.jsx";
import { usePersistedString } from "../_ui/useViewState.jsx";
import { clearLedgerCache, getLedgerEventsCached } from "@/lib/ledgerCache";
import SavedViewsBar from "@/app/ui/SavedViewsBar";
import LedgerFreshnessBar from "../_ui/LedgerFreshnessBar.jsx";
import { downloadCsvFromRows } from "../_ui/csv.js";

export const runtime = "edge";

const PAGE_SIZE = 500;
const FOCUS_STORE_KEY = "asora_view:snapshot:focusItemId";
const SAVED_VIEWS_KEY = "asora_saved_views:snapshot:focusItemId";

function itemHref(itemId) {
  return `/inventory/item?itemId=${encodeURIComponent(String(itemId))}`;
}
function movementsHref(itemId) {
  return `/inventory/movements?itemId=${encodeURIComponent(String(itemId))}`;
}

export default function InventorySnapshotPage() {
  const { isCompact } = useDensity();
  const s = isCompact ? compact : styles;

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [events, setEvents] = useState([]);
  const [computedAtUtc, setComputedAtUtc] = useState("");
  const [lastFetchedUtc, setLastFetchedUtc] = useState("");
  const [cacheStatus, setCacheStatus] = useState("cached");

  const [focusItemId, setFocusItemId] = usePersistedString(FOCUS_STORE_KEY, "");
  const [page, setPage] = useState(1);

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
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load({ force: false });
  }, []);

  const focus = (focusItemId || "").trim();

  const derived = useMemo(() => {
    const m = new Map();
    let skippedMissingItemId = 0;
    let skippedMissingQtyDelta = 0;

    for (const e of events) {
      const itemId = typeof e?.itemId === "string" ? e.itemId : "";
      if (!itemId) {
        skippedMissingItemId += 1;
        continue;
      }
      const q = e?.qtyDelta;
      if (typeof q !== "number" || !Number.isFinite(q)) {
        skippedMissingQtyDelta += 1;
        continue;
      }
      m.set(itemId, (m.get(itemId) || 0) + q);
    }

    const rows = Array.from(m.entries())
      .map(([itemId, derivedQuantity]) => ({ itemId, derivedQuantity }))
      .sort((a, b) => a.itemId.localeCompare(b.itemId));

    return { rows, skippedMissingItemId, skippedMissingQtyDelta };
  }, [events]);

  const filteredRows = useMemo(() => {
    if (!focus) return derived.rows;
    return derived.rows.filter((r) => r.itemId === focus);
  }, [derived.rows, focus]);

  useEffect(() => setPage(1), [filteredRows.length, focus]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const visible = filteredRows.slice(0, Math.min(filteredRows.length, page * PAGE_SIZE));

  function exportCsv() {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    downloadCsvFromRows(
      `asora_inventory_snapshot_${ts}.csv`,
      ["itemId", "derivedQuantity"],
      filteredRows.map((r) => ({ itemId: r.itemId, derivedQuantity: r.derivedQuantity }))
    );
  }

  function applySaved(v) {
    setFocusItemId((v || "").trim());
  }

  return (
    <main style={s.shell}>
      <CompactBar here="Snapshot" />

      <LedgerFreshnessBar
        lastFetchedUtc={lastFetchedUtc}
        cacheStatus={cacheStatus}
        onRefresh={() => load({ force: false })}
        onForceRefresh={() => load({ force: true })}
      />

      <section style={s.card}>
        <div style={s.controls}>
          <button style={s.button} onClick={() => load({ force: false })} disabled={loading}>
            Recompute (cached)
          </button>
          <button style={s.buttonSecondary} onClick={() => load({ force: true })} disabled={loading}>
            Recompute (force)
          </button>
          <button style={s.buttonSecondary} onClick={exportCsv} disabled={filteredRows.length === 0}>
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
            Items: <span style={s.mono}>{derived.rows.length}</span> | Focus rows:{" "}
            <span style={s.mono}>{filteredRows.length}</span> | Events:{" "}
            <span style={s.mono}>{events.length}</span> | Computed (UTC):{" "}
            <span style={s.mono}>{computedAtUtc || "—"}</span>
          </div>

          <div style={s.metaSmall}>
            Skipped — missing itemId: <span style={s.mono}>{derived.skippedMissingItemId}</span>, missing qtyDelta:{" "}
            <span style={s.mono}>{derived.skippedMissingQtyDelta}</span>
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
        {filteredRows.length === 0 && !loading ? <div style={s.empty}>No derived rows.</div> : null}

        {filteredRows.length > 0 ? (
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
        ) : null}

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
              {visible.map((r) => (
                <tr key={r.itemId}>
                  <td style={s.td}><span style={s.mono}>{r.itemId}</span></td>
                  <td style={s.tdRight}><span style={s.mono}>{r.derivedQuantity}</span></td>
                  <td style={s.td}>
                    <Link style={s.link} href={itemHref(r.itemId)}>Drill-down</Link>{" "}
                    <Link style={s.linkSecondary} href={movementsHref(r.itemId)}>Movements</Link>
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
  input: { width: 280, padding: "8px 10px", borderRadius: 10, border: "1px solid #ccc" },
  button: { padding: "8px 12px", borderRadius: 10, background: "#111", color: "#fff" },
  buttonSecondary: { padding: "8px 12px", borderRadius: 10, border: "1px solid #bbb", background: "#fff" },
  meta: { fontSize: 13 },
  metaSmall: { fontSize: 12, color: "#666" },
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
  linkSecondary: { color: "#444", textDecoration: "none" },
  mono: { fontFamily: "ui-monospace, monospace" },
};

const compact = styles;
