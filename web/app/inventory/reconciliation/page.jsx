"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { asoraGetJson } from "@/lib/asoraFetch";
import CompactBar, { useDensity } from "../_ui/CompactBar.jsx";
import { usePersistedString } from "../_ui/useViewState.jsx";

export const runtime = "edge";

const STORE_KEY = "asora_view:reconciliation:itemId";

function itemHref(itemId) {
  return `/inventory/item?itemId=${encodeURIComponent(String(itemId))}`;
}

function movementsHref(itemId) {
  return `/inventory/movements?itemId=${encodeURIComponent(String(itemId))}`;
}

function normalizeInventoryItemsPayload(r) {
  const candidates = [];
  const rootItems = Array.isArray(r?.items) ? r.items : null;
  if (rootItems) candidates.push(...rootItems);

  const nestedItems = Array.isArray(r?.data?.items) ? r.data.items : null;
  if (nestedItems) candidates.push(...nestedItems);

  const out = [];
  for (const it of candidates) {
    if (!it || typeof it !== "object") continue;
    const itemId = it.itemId;
    const qty = it.quantity;
    if (typeof itemId !== "string" || itemId.trim() === "") continue;
    if (typeof qty !== "number" || Number.isNaN(qty) || !Number.isFinite(qty)) continue;
    out.push({ itemId, quantity: qty });
  }
  return out;
}

export default function InventoryReconciliationPage() {
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
  const [invMap, setInvMap] = useState(new Map());
  const [ledgerMap, setLedgerMap] = useState(new Map());

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const [invR, ledR] = await Promise.all([asoraGetJson("/v1/inventory/items", {}), asoraGetJson("/v1/ledger/events", {})]);

      const invItems = normalizeInventoryItemsPayload(invR);
      const iMap = new Map();
      for (const it of invItems) iMap.set(it.itemId, it.quantity);

      const events = Array.isArray(ledR?.events) ? ledR.events : [];
      const lMap = new Map();
      for (const e of events) {
        if (!e || typeof e !== "object") continue;
        const itemId = e.itemId;
        const q = e.qtyDelta;
        if (typeof itemId !== "string" || itemId.trim() === "") continue;
        if (typeof q !== "number" || Number.isNaN(q) || !Number.isFinite(q)) continue;
        lMap.set(itemId, (lMap.get(itemId) || 0) + q);
      }

      setInvMap(iMap);
      setLedgerMap(lMap);
    } catch (e) {
      setErr(e?.message || "Failed to load inventory and/or ledger data.");
      setInvMap(new Map());
      setLedgerMap(new Map());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const focus = (focusItemId || "").trim();

  const rows = useMemo(() => {
    const ids = new Set();
    for (const k of invMap.keys()) ids.add(k);
    for (const k of ledgerMap.keys()) ids.add(k);

    let out = Array.from(ids)
      .map((itemId) => {
        const invQty = invMap.has(itemId) ? invMap.get(itemId) : null;
        const ledQty = ledgerMap.has(itemId) ? ledgerMap.get(itemId) : null;
        const mismatch =
          typeof invQty === "number" && typeof ledQty === "number" ? invQty !== ledQty : invQty !== ledQty;
        return { itemId, invQty, ledQty, mismatch };
      })
      .sort((a, b) => a.itemId.localeCompare(b.itemId));

    if (focus) out = out.filter((r) => r.itemId === focus);

    return out;
  }, [invMap, ledgerMap, focus]);

  const mismatchCount = useMemo(() => rows.filter((r) => r.mismatch).length, [rows]);

  const s = isCompact ? compact : styles;

  return (
    <main style={s.shell}>
      <CompactBar here="Reconciliation" />

      <header style={s.header}>
        <div style={s.title}>Ledger ↔ Inventory Reconciliation</div>
        <div style={s.sub}>
          Side-by-side comparison between inventory read quantity (best-effort) and ledger-derived quantity. Focus is
          saved locally.
        </div>
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
            Rows: <span style={s.mono}>{rows.length}</span> | Mismatches: <span style={s.mono}>{mismatchCount}</span>
          </div>
        </div>

        {err ? <div style={s.err}>Error: {err}</div> : null}
        {rows.length === 0 && !loading ? <div style={s.empty}>No reconciliation rows to display.</div> : null}

        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>itemId</th>
                <th style={s.thRight}>inventoryQty</th>
                <th style={s.thRight}>ledgerDerivedQty</th>
                <th style={s.th}>status</th>
                <th style={s.th}>Links</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const status = r.mismatch ? "MISMATCH" : "OK";
                const statusStyle = r.mismatch ? s.badgeBad : s.badgeOk;

                return (
                  <tr key={r.itemId}>
                    <td style={s.td}>
                      <span style={s.mono}>{r.itemId}</span>
                    </td>
                    <td style={s.tdRight}>
                      <span style={s.mono}>{typeof r.invQty === "number" ? r.invQty : "—"}</span>
                    </td>
                    <td style={s.tdRight}>
                      <span style={s.mono}>{typeof r.ledQty === "number" ? r.ledQty : "—"}</span>
                    </td>
                    <td style={s.td}>
                      <span style={{ ...s.badge, ...statusStyle }}>{status}</span>
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
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section style={s.card}>
        <div style={s.noteTitle}>Notes</div>
        <ul style={s.ul}>
          <li>URL itemId overrides saved focus and will be persisted.</li>
          <li>Inventory quantity extraction is best-effort and explicitly non-authoritative.</li>
          <li>All derivation and mismatch signaling is client-side and read-only.</li>
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
  empty: { marginTop: 12, color: "#666", fontSize: 13 },

  tableWrap: { width: "100%", overflowX: "auto", marginTop: 12 },
  table: { borderCollapse: "collapse", width: "100%" },
  th: { textAlign: "left", fontSize: 12, color: "#444", borderBottom: "1px solid #eee", padding: "10px 8px" },
  thRight: { textAlign: "right", fontSize: 12, color: "#444", borderBottom: "1px solid #eee", padding: "10px 8px" },
  td: { padding: "10px 8px", borderBottom: "1px solid #f0f0f0", fontSize: 13, verticalAlign: "top" },
  tdRight: { padding: "10px 8px", borderBottom: "1px solid #f0f0f0", fontSize: 13, textAlign: "right", verticalAlign: "top" },

  badge: { display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 12, border: "1px solid #ddd" },
  badgeOk: { background: "#f2f8f2", borderColor: "#cfe7cf", color: "#145a14" },
  badgeBad: { background: "#fff3f3", borderColor: "#f1c2c2", color: "#8a1f1f" },

  linkRow: { display: "flex", gap: 10, flexWrap: "wrap" },
  link: { color: "#0b57d0", textDecoration: "none", fontSize: 13 },
  linkSecondary: { color: "#444", textDecoration: "none", fontSize: 13 },

  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },

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

  badge: { ...styles.badge, fontSize: 11, padding: "2px 7px" },

  link: { ...styles.link, fontSize: 12 },
  linkSecondary: { ...styles.linkSecondary, fontSize: 12 },

  noteTitle: { ...styles.noteTitle, fontSize: 13 },
  ul: { ...styles.ul, fontSize: 12 },
};
