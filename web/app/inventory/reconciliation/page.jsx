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

function normalizeInventoryItemsPayload(r) {
  // Best-effort detection; do not assume shape beyond common patterns.
  // Returns array of { itemId, quantity } with only valid types.
  const candidates = [];
  const rootItems = Array.isArray(r?.items) ? r.items : null;
  if (rootItems) candidates.push(...rootItems);

  // Some APIs nest: { data: { items: [...] } }
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
  const sp = useSearchParams();
  const initialFocus = sp?.get("itemId") || "";

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [focusItemId, setFocusItemId] = useState(initialFocus);
  const [invMap, setInvMap] = useState(new Map());
  const [ledgerMap, setLedgerMap] = useState(new Map());

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const [invR, ledR] = await Promise.all([
        asoraGetJson("/v1/inventory/items", {}),
        asoraGetJson("/v1/ledger/events", {}),
      ]);

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

    const focus = (focusItemId || "").trim();
    if (focus) out = out.filter((r) => r.itemId === focus);

    return out;
  }, [invMap, ledgerMap, focusItemId]);

  const mismatchCount = useMemo(() => rows.filter((r) => r.mismatch).length, [rows]);

  return (
    <main style={styles.shell}>
      <header style={styles.header}>
        <div style={styles.title}>Ledger ↔ Inventory Reconciliation</div>
        <div style={styles.sub}>
          Side-by-side comparison between inventory read quantity (best-effort) and ledger-derived quantity. No
          assumptions about which side is correct.
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
          <div style={styles.meta}>
            Rows: <span style={styles.mono}>{rows.length}</span> | Mismatches:{" "}
            <span style={styles.mono}>{mismatchCount}</span>
          </div>
        </div>

        {err ? <div style={styles.err}>Error: {err}</div> : null}
        {rows.length === 0 && !loading ? <div style={styles.empty}>No reconciliation rows to display.</div> : null}

        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>itemId</th>
                <th style={styles.thRight}>inventoryQty</th>
                <th style={styles.thRight}>ledgerDerivedQty</th>
                <th style={styles.th}>status</th>
                <th style={styles.th}>Links</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const status = r.mismatch ? "MISMATCH" : "OK";
                const statusStyle = r.mismatch ? styles.badgeBad : styles.badgeOk;

                return (
                  <tr key={r.itemId}>
                    <td style={styles.td}>
                      <span style={styles.mono}>{r.itemId}</span>
                    </td>
                    <td style={styles.tdRight}>
                      <span style={styles.mono}>{typeof r.invQty === "number" ? r.invQty : "—"}</span>
                    </td>
                    <td style={styles.tdRight}>
                      <span style={styles.mono}>{typeof r.ledQty === "number" ? r.ledQty : "—"}</span>
                    </td>
                    <td style={styles.td}>
                      <span style={{ ...styles.badge, ...statusStyle }}>{status}</span>
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
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section style={styles.card}>
        <div style={styles.noteTitle}>Notes</div>
        <ul style={styles.ul}>
          <li>Query parameter support: /inventory/reconciliation?itemId=… filters to a single itemId.</li>
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
  meta: { fontSize: 13, color: "#444", paddingBottom: 2 },
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
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },
  badge: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 12,
    border: "1px solid #ddd",
  },
  badgeOk: { background: "#f2f8f2", borderColor: "#cfe7cf", color: "#145a14" },
  badgeBad: { background: "#fff3f3", borderColor: "#f1c2c2", color: "#8a1f1f" },
  linkRow: { display: "flex", gap: 10, flexWrap: "wrap" },
  link: { color: "#0b57d0", textDecoration: "none", fontSize: 13 },
  linkSecondary: { color: "#444", textDecoration: "none", fontSize: 13 },
  noteTitle: { fontSize: 14, fontWeight: 700, marginBottom: 8 },
  ul: { margin: 0, paddingLeft: 18, color: "#333", fontSize: 13, lineHeight: 1.5 },
};
