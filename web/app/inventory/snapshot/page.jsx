"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import AdminHeader from "@/app/_ui/AdminHeader.jsx";
import CompactBar, { useDensity } from "@/app/_ui/CompactBar.jsx";
import SavedViewsBar from "@/app/ui/SavedViewsBar";
import LedgerFreshnessBar from "@/app/_ui/LedgerFreshnessBar.jsx";
import IntegrityFooter from "@/app/_ui/IntegrityFooter.jsx";

import { asoraGetJson } from "@/lib/asoraFetch";
import { clearLedgerCache, getLedgerEventsCached } from "@/lib/ledgerCache";
import { toCsv, downloadCsv } from "@/app/_ui/csv.js";

export const runtime = "edge";

const PAGE_SIZE = 500;

// Snapshot focus (local-only)
const FOCUS_STORE_KEY = "asora_view:snapshot:focusItemId";
const SAVED_VIEWS_KEY = "asora_saved_views:snapshot:focusItemId";

function itemHref(itemId) {
  return `/inventory/item?itemId=${encodeURIComponent(String(itemId))}`;
}

function movementsHref(itemId) {
  return `/inventory/movements?itemId=${encodeURIComponent(String(itemId))}`;
}

function utcNowIso() {
  return new Date().toISOString();
}

function csvSafeFocus(focus) {
  if (!focus) return "";
  return `_focus_${String(focus).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function coerceNumber(x) {
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
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

export default function InventorySnapshotPage() {
  const { isCompact } = useDensity();
  const s = isCompact ? compact : styles;

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [events, setEvents] = useState([]);
  const [computedAtUtc, setComputedAtUtc] = useState("");

  // Focus itemId (optional, persisted)
  const [focusItemId, setFocusItemId] = useState("");

  // Saved views apply exact values
  function applySaved(value) {
    const v = (value || "").trim();
    setFocusItemId(v);
    try {
      if (!v) localStorage.removeItem(FOCUS_STORE_KEY);
      else localStorage.setItem(FOCUS_STORE_KEY, v);
    } catch {
      // ignore
    }
  }

  // Ledger freshness state
  const [lastFetchedUtc, setLastFetchedUtc] = useState("");
  const [cacheStatus, setCacheStatus] = useState("unknown"); // cached | fresh | unknown

  // Integrity footer state
  const [integrity, setIntegrity] = useState({ eventsProcessed: 0, skipped: [], renderUtc: "" });

  // Paging
  const [page, setPage] = useState(1);

  // hydrate focus once
  useEffect(() => {
    try {
      const v = localStorage.getItem(FOCUS_STORE_KEY) || "";
      setFocusItemId(v);
    } catch {
      // ignore
    }
  }, []);

  async function load({ force = false } = {}) {
    setLoading(true);
    setErr("");
    try {
      if (force) clearLedgerCache();

      const raw = await getLedgerEventsCached(asoraGetJson);
      const sorted = normalizeLedgerEvents(raw);

      setEvents(sorted);

      const now = utcNowIso();
      setComputedAtUtc(now);
      setLastFetchedUtc(now);
      setCacheStatus(force ? "fresh" : "cached");

      setIntegrity({ eventsProcessed: sorted.length, skipped: [], renderUtc: now });
    } catch (e) {
      setErr(e?.message || "Failed to load ledger events.");
      setEvents([]);
      setComputedAtUtc("");
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

  const derived = useMemo(() => {
    const m = new Map();
    let skippedMissingItemId = 0;
    let skippedMissingQtyDelta = 0;

    for (const e of events) {
      if (!e || typeof e !== "object") continue;

      const itemId = e.itemId;
      if (itemId === null || itemId === undefined || String(itemId).trim() === "") {
        skippedMissingItemId += 1;
        continue;
      }

      const q = coerceNumber(e?.qtyDelta);
      if (q === null) {
        skippedMissingQtyDelta += 1;
        continue;
      }

      const id = String(itemId);
      m.set(id, (m.get(id) || 0) + q);
    }

    const rows = Array.from(m.entries())
      .map(([itemId, derivedQuantity]) => ({ itemId, derivedQuantity }))
      .sort((a, b) => a.itemId.localeCompare(b.itemId));

    const skipped = [
      { reason: "ledger event missing itemId", count: skippedMissingItemId },
      { reason: "ledger event missing/non-numeric qtyDelta", count: skippedMissingQtyDelta },
    ].filter((x) => x.count > 0);

    return { rows, skipped, skippedMissingItemId, skippedMissingQtyDelta };
  }, [events]);

  // keep integrity footer updated when derivation changes
  useEffect(() => {
    setIntegrity({ eventsProcessed: events.length, skipped: derived.skipped, renderUtc: utcNowIso() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.length, derived.skippedMissingItemId, derived.skippedMissingQtyDelta]);

  const filteredRows = useMemo(() => {
    if (!focus) return derived.rows;
    return derived.rows.filter((r) => r.itemId === focus);
  }, [derived.rows, focus]);

  useEffect(() => {
    setPage(1);
  }, [focus, filteredRows.length]);

  const pageCount = useMemo(() => Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE)), [filteredRows.length]);

  const visible = useMemo(() => {
    const end = Math.min(filteredRows.length, page * PAGE_SIZE);
    return filteredRows.slice(0, end);
  }, [filteredRows, page]);

  function exportCsv() {
    const ts = utcNowIso().replace(/[:.]/g, "-");
    const filename = `asora_inventory_snapshot_${ts}${csvSafeFocus(focus)}.csv`;

    const headers = ["itemId", "derivedQuantity"];
    const rows = filteredRows.map((r) => ({ itemId: r.itemId, derivedQuantity: r.derivedQuantity }));

    downloadCsv(filename, toCsv(headers, rows, { bom: false }));

    setIntegrity({ eventsProcessed: events.length, skipped: derived.skipped, renderUtc: utcNowIso() });
  }

  return (
    <main style={s.shell}>
      <AdminHeader
        title="Inventory Snapshot (Derived)"
        subtitle="Client-side on-hand state computed from ledger events (read-only). Cached per-tab unless forced."
      >
        <LedgerFreshnessBar
          lastFetchedUtc={lastFetchedUtc}
          cacheStatus={cacheStatus}
          busy={loading || loading === true}
          onRefreshCached={() => load({ force: false })}
          onRefreshForce={() => load({ force: true })}
          onClearCache={() => {
            clearLedgerCache();
            setCacheStatus("unknown");
          }}
        />
      </AdminHeader>

      <CompactBar here="Snapshot" />

      <section style={s.card}>
        <div style={s.controls}>
          <button style={s.button} onClick={() => load({ force: false })} disabled={loading}>
            {loading ? "Refreshing..." : "Recompute (cached)"}
          </button>

          <button style={s.buttonSecondary} onClick={() => load({ force: true })} disabled={loading}>
            Recompute (force)
          </button>

          <button style={s.buttonSecondary} onClick={exportCsv} disabled={loading || filteredRows.length === 0}>
            Export CSV
          </button>

          <label style={s.label}>
            Focus itemId (optional)
            <input
              style={s.input}
              value={focusItemId}
              onChange={(e) => {
                const v = e.target.value;
                setFocusItemId(v);
                try {
                  if (!v) localStorage.removeItem(FOCUS_STORE_KEY);
                  else localStorage.setItem(FOCUS_STORE_KEY, v);
                } catch {
                  // ignore
                }
              }}
              placeholder="exact itemId (filters table)"
            />
          </label>

          <div style={s.meta}>
            Items: <span style={s.mono}>{derived.rows.length}</span> | Focus rows:{" "}
            <span style={s.mono}>{filteredRows.length}</span> | Events: <span style={s.mono}>{events.length}</span> | Computed
            at (UTC): <span style={s.mono}>{computedAtUtc || "—"}</span>
            {focus ? (
              <>
                {" "}
                | Focus: <span style={s.mono}>{focus}</span>
              </>
            ) : null}
          </div>

          <div style={s.metaSmall}>
            Skipped events — missing itemId: <span style={s.mono}>{derived.skippedMissingItemId}</span>, missing numeric qtyDelta:{" "}
            <span style={s.mono}>{derived.skippedMissingQtyDelta}</span>
          </div>

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
        </div>

        <div style={{ marginTop: 12 }}>
          <SavedViewsBar storageKey={SAVED_VIEWS_KEY} valueLabel="focus itemId" currentValue={focus} onApply={applySaved} />
        </div>

        {err ? <div style={s.err}>Error: {err}</div> : null}
        {filteredRows.length === 0 && !loading ? (
          <div style={s.empty}>{focus ? "No derived rows for this focus itemId." : "No derived inventory rows to display."}</div>
        ) : null}

        {filteredRows.length > 0 ? (
          <div style={s.pagerRow}>
            <button style={s.pagerBtn} onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              Prev
            </button>
            <div style={s.pagerText}>
              Page <span style={s.mono}>{page}</span> / <span style={s.mono}>{pageCount}</span> (page size{" "}
              <span style={s.mono}>{PAGE_SIZE}</span>, showing <span style={s.mono}>{visible.length}</span>)
            </div>
            <button style={s.pagerBtn} onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page >= pageCount}>
              Next
            </button>
            <button style={s.pagerBtnSecondary} onClick={() => setPage(pageCount)} disabled={page >= pageCount} title="Jump to last page">
              End
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
                  <td style={s.td}>
                    <span style={s.mono}>{r.itemId}</span>
                  </td>
                  <td style={s.tdRight}>
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
      </section>

      <section style={s.card}>
        <div style={s.noteTitle}>Notes</div>
        <ul style={s.ul}>
          <li>Negative totals are allowed and shown as-is (no clamping).</li>
          <li>Derivation ignores events missing itemId or numeric qtyDelta.</li>
          <li>“Force” recompute clears the in-tab cache and refetches ledger events.</li>
          <li>Focus itemId filters the derived rows table only; derivation rules are unchanged.</li>
          <li>Saved Views are local-only (localStorage) and do not affect backend behavior.</li>
        </ul>
      </section>

      <IntegrityFooter eventsProcessed={integrity.eventsProcessed} skipped={integrity.skipped} renderUtc={integrity.renderUtc} />
    </main>
  );
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
  controls: { display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" },

  button: {
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(255,255,255,0.08)",
    color: "#e6edf3",
    cursor: "pointer",
    fontSize: 13,
    height: 34,
  },
  buttonSecondary: {
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.18)",
    color: "#e6edf3",
    cursor: "pointer",
    fontSize: 13,
    height: 34,
  },

  label: { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, opacity: 0.9 },
  input: {
    width: 280,
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.25)",
    color: "#e6edf3",
    outline: "none",
    fontSize: 13,
  },

  meta: { fontSize: 13, opacity: 0.85 },
  metaSmall: { fontSize: 12, opacity: 0.75 },

  quickLinks: { fontSize: 13, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  dot: { opacity: 0.6 },
  linkRow: { display: "flex", gap: 10, flexWrap: "wrap" },
  link: { color: "#93c5fd", textDecoration: "none", fontSize: 13 },
  linkSecondary: { color: "#e6edf3", opacity: 0.85, textDecoration: "none", fontSize: 13 },

  err: { marginTop: 10, color: "#ff7b7b", fontSize: 13 },
  empty: { marginTop: 12, opacity: 0.8, fontSize: 13 },

  pagerRow: { marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
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

  tableWrap: { width: "100%", overflowX: "auto", marginTop: 12 },
  table: { borderCollapse: "collapse", width: "100%" },
  th: { textAlign: "left", fontSize: 12, opacity: 0.85, borderBottom: "1px solid rgba(255,255,255,0.10)", padding: "10px 8px" },
  thRight: { textAlign: "right", fontSize: 12, opacity: 0.85, borderBottom: "1px solid rgba(255,255,255,0.10)", padding: "10px 8px" },
  td: { padding: "10px 8px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 13, verticalAlign: "top" },
  tdRight: { padding: "10px 8px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 13, textAlign: "right", verticalAlign: "top" },

  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },

  noteTitle: { fontSize: 14, fontWeight: 800, marginBottom: 8 },
  ul: { margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.5, opacity: 0.9 },
};

const compact = {
  ...styles,
  shell: { ...styles.shell, padding: 12 },
  card: { ...styles.card, padding: 12, margin: "0 auto 12px auto" },

  button: { ...styles.button, padding: "6px 10px", fontSize: 12, height: 30 },
  buttonSecondary: { ...styles.buttonSecondary, padding: "6px 10px", fontSize: 12, height: 30 },

  label: { ...styles.label, fontSize: 12 },
  input: { ...styles.input, padding: "6px 8px", fontSize: 12, width: 240 },

  meta: { ...styles.meta, fontSize: 12 },
  metaSmall: { ...styles.metaSmall, fontSize: 11 },

  pagerBtn: { ...styles.pagerBtn, fontSize: 12 },
  pagerBtnSecondary: { ...styles.pagerBtnSecondary, fontSize: 12 },
  pagerText: { ...styles.pagerText, fontSize: 12 },

  th: { ...styles.th, padding: "8px 6px", fontSize: 11 },
  thRight: { ...styles.thRight, padding: "8px 6px", fontSize: 11 },
  td: { ...styles.td, padding: "8px 6px", fontSize: 12 },
  tdRight: { ...styles.tdRight, padding: "8px 6px", fontSize: 12 },

  noteTitle: { ...styles.noteTitle, fontSize: 13 },
  ul: { ...styles.ul, fontSize: 12 },
};
