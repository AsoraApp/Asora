"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { asoraGetJson } from "@/lib/asoraFetch";
import CompactBar, { useDensity } from "../_ui/CompactBar.jsx";
import { usePersistedString } from "../_ui/useViewState.jsx";
import { clearLedgerCache, getLedgerEventsCached } from "@/lib/ledgerCache";
import SavedViewsBar from "@/app/ui/SavedViewsBar";

export const runtime = "edge";

const STORE_KEY = "asora_view:movements:itemId";
const SAVED_VIEWS_KEY = "asora_saved_views:movements:itemId";
const PAGE_SIZE = 200;

function itemHref(itemId) {
  return `/inventory/item?itemId=${encodeURIComponent(String(itemId))}`;
}

export default function InventoryMovementsPage() {
  const { isCompact } = useDensity();

  const sp = useSearchParams();
  const qpItemId = sp?.get("itemId") || "";

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [persistedItemId, setPersistedItemId] = usePersistedString(STORE_KEY, "");

  // Query-param wins; otherwise fall back to persisted.
  const [filterItemId, setFilterItemId] = useState(qpItemId || persistedItemId);
  const [events, setEvents] = useState([]);

  // Deterministic paging state (reset when filter changes)
  const [page, setPage] = useState(1);

  // If URL itemId changes, adopt it and persist it.
  useEffect(() => {
    if (qpItemId && qpItemId !== filterItemId) {
      setFilterItemId(qpItemId);
      setPersistedItemId(qpItemId);
      setPage(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qpItemId]);

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

  const focus = (filterItemId || "").trim();

  const filtered = useMemo(() => {
    if (!focus) return events;
    return events.filter((e) => typeof e?.itemId === "string" && e.itemId === focus);
  }, [events, focus]);

  // Reset paging when user types a different filter (local input) OR when saved view applied.
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
    setPersistedItemId(v);
    setPage(1);
  }

  const s = isCompact ? compact : styles;

  return (
    <main style={s.shell}>
      <CompactBar here="Movements" />

      <header style={s.header}>
        <div style={s.title}>Inventory Movements</div>
        <div style={s.sub}>
          Chronological, ledger-derived movement timeline (read-only). Filter is saved locally. Ledger fetch is cached
          per tab.
        </div>
      </header>

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
                setPersistedItemId(v);
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

        {/* Saved Views (localStorage only) */}
        <div style={{ marginTop: 12 }}>
          <SavedViewsBar
            storageKey={SAVED_VIEWS_KEY}
            valueLabel="itemId"
            currentValue={focus}
            onApply={applySaved}
          />
        </div>

        {err ? <div style={s.err}>Error: {err}</div> : null}
        {filtered.length === 0 && !loading ? <div style={s.empty}>No movements to display.</div> : null}

        {filtered.length > 0 ? (
          <div style={s.pagerRow}>
            <button
              style={s.pagerBtn}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
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
            <button
              style={s.pagerBtnSecondary}
              onClick={() => setPage(pageCount)}
              disabled={page >= pageCount}
              title="Jump to last page"
            >
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
                const key = (typeof e?.id === "string" && e.id) || `${ts}:${itemId}:${idx}`;

                return (
                  <tr key={key}>
                    <td style={s.td}>
                      <span style={s.mono}>{ts}</span>
                    </td>
                    <td style={s.td}>
                      {itemId ? <span style={s.mono}>{itemId}</span> : <span style={s.muted}>—</span>}
                    </td>
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
          <li>Sorting is deterministic: ts ascending, then id as a tie-breaker if present.</li>
          <li>Cached refresh avoids re-downloading ledger events across views in the same tab.</li>
          <li>Force refresh explicitly clears the cache and re-fetches.</li>
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
  controls: { display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" },
  label: { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "#222" },
  input: { width: 280, padding: "8px 10px", borderRadius: 10, border
