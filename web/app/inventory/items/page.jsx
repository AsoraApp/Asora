"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { asoraGetJson } from "@/lib/asoraFetch";
import CompactBar, { useDensity } from "../_ui/CompactBar.jsx";

export const runtime = "edge";

function itemHref(itemId) {
  return `/inventory/item?itemId=${encodeURIComponent(String(itemId))}`;
}

function movementsHref(itemId) {
  return `/inventory/movements?itemId=${encodeURIComponent(String(itemId))}`;
}

function reconciliationHref(itemId) {
  return `/inventory/reconciliation?itemId=${encodeURIComponent(String(itemId))}`;
}

function isFiniteNumber(n) {
  return typeof n === "number" && Number.isFinite(n) && !Number.isNaN(n);
}

function normalizeInventoryItemsPayload(r) {
  const candidates = [];
  if (Array.isArray(r?.items)) candidates.push(...r.items);
  if (Array.isArray(r?.data?.items)) candidates.push(...r.data.items);

  const out = [];
  for (const it of candidates) {
    if (!it || typeof it !== "object") continue;

    const itemId = it.itemId;
    if (typeof itemId !== "string" || itemId.trim() === "") continue;

    const quantity = it.quantity;
    const hasQty = isFiniteNumber(quantity);

    out.push({
      itemId,
      quantity: hasQty ? quantity : null,
      raw: it,
    });
  }

  out.sort((a, b) => {
    const c = a.itemId.localeCompare(b.itemId);
    if (c !== 0) return c;
    const ra = JSON.stringify(a.raw || {});
    const rb = JSON.stringify(b.raw || {});
    return ra.localeCompare(rb);
  });

  return out;
}

export default function InventoryItemsPage() {
  const { isCompact } = useDensity();

  const sp = useSearchParams();
  const initialFocus = sp?.get("itemId") || "";

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [focusItemId, setFocusItemId] = useState(initialFocus);
  const [rows, setRows] = useState([]);

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const r = await asoraGetJson("/v1/inventory/items", {});
      const list = normalizeInventoryItemsPayload(r);
      setRows(list);
    } catch (e) {
      setErr(e?.message || "Failed to load inventory items.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const focus = (focusItemId || "").trim();

  const filtered = useMemo(() => {
    if (!focus) return rows;
    return rows.filter((r) => r.itemId === focus);
  }, [rows, focus]);

  const qtyStats = useMemo(() => {
    let withQty = 0;
    let withoutQty = 0;
    for (const r of filtered) {
      if (typeof r.quantity === "number") withQty += 1;
      else withoutQty += 1;
    }
    return { withQty, withoutQty };
  }, [filtered]);

  const s = isCompact ? compact : styles;

  return (
    <main style={s.shell}>
      <CompactBar here="Inventory Items" />

      <header style={s.header}>
        <div style={s.title}>Inventory Items</div>
        <div style={s.sub}>
          Read-only inventory item list (best-effort shape). Deterministic ordering by itemId. Cross-links provide
          coherence across derived views.
        </div>
      </header>

      <section style={s.card}>
        <div style={s.controls}>
          <label style={s.label}>
            Focus itemId (optional)
            <input
              style={s.input}
              value={focusItemId}
              onChange={(e) => setFocusItemId(e.target.value)}
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
              <span style={s.dot}>·</span>
              <Link style={s.linkSecondary} href={reconciliationHref(focus)}>
                Reconcile {focus}
              </Link>
            </div>
          ) : null}

          <div style={s.meta}>
            Rows: <span style={s.mono}>{filtered.length}</span> | With quantity:{" "}
            <span style={s.mono}>{qtyStats.withQty}</span> | Without quantity:{" "}
            <span style={s.mono}>{qtyStats.withoutQty}</span>
          </div>
        </div>

        {err ? <div style={s.err}>Error: {err}</div> : null}
        {filtered.length === 0 && !loading ? <div style={s.empty}>No inventory items to display.</div> : null}

        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>itemId</th>
                <th style={s.thRight}>quantity</th>
                <th style={s.th}>Links</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.itemId}>
                  <td style={s.td}>
                    <span style={s.mono}>{r.itemId}</span>
                  </td>
                  <td style={s.tdRight}>
                    <span style={s.mono}>{typeof r.quantity === "number" ? r.quantity : "—"}</span>
                  </td>
                  <td style={s.td}>
                    <div style={s.linkRow}>
                      <Link style={s.link} href={itemHref(r.itemId)}>
                        Drill-down
                      </Link>
                      <Link style={s.linkSecondary} href={movementsHref(r.itemId)}>
                        Movements
                      </Link>
                      <Link style={s.linkSecondary} href={reconciliationHref(r.itemId)}>
                        Reconcile
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
          <li>Query parameter support: /inventory/items?itemId=… focuses to a single itemId (client-side filter).</li>
          <li>Quantity is treated as optional because inventory read payload shapes may vary.</li>
          <li>Cross-links do not imply authority; they are navigation only.</li>
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

  link: { ...styles.link, fontSize: 12 },
  linkSecondary: { ...styles.linkSecondary, fontSize: 12 },

  noteTitle: { ...styles.noteTitle, fontSize: 13 },
  ul: { ...styles.ul, fontSize: 12 },
};
