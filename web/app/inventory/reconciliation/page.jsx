"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { asoraGetJson } from "@/lib/asoraFetch";
import CompactBar, { useDensity } from "../_ui/CompactBar.jsx";
import { usePersistedString } from "../_ui/useViewState.jsx";
import { clearLedgerCache, getLedgerEventsCached } from "@/lib/ledgerCache";
import SavedViewsBar from "@/app/ui/SavedViewsBar";

export const runtime = "edge";

const STORE_KEY = "asora_view:reconciliation:itemId";
const SAVED_VIEWS_KEY = "asora_saved_views:reconciliation:itemId";

function itemHref(itemId) {
  return `/inventory/item?itemId=${encodeURIComponent(String(itemId))}`;
}
function movementsHref(itemId) {
  return `/inventory/movements?itemId=${encodeURIComponent(String(itemId))}`;
}

function csvEscape(v) {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadCsv(filename, rows) {
  const content = rows.map((r) => r.join(",")).join("\n") + "\n";
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function InventoryReconciliationPage() {
  const { isCompact } = useDensity();
  const s = isCompact ? compact : styles;

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [persistedItemId, setPersistedItemId] = usePersistedString(STORE_KEY, "");
  const [filterItemId, setFilterItemId] = useState(persistedItemId);

  const [items, setItems] = useState([]);
  const [events, setEvents] = useState([]);
  const [computedAtUtc, setComputedAtUtc] = useState("");

  async function load({ force = false } = {}) {
    setLoading(true);
    setErr("");
    try {
      if (force) clearLedgerCache();

      // Inventory items (GET-only)
      const inv = await asoraGetJson("/v1/inventory/items", {});
      const invItems = Array.isArray(inv?.items) ? inv.items : [];
      setItems(invItems);

      // Ledger events (cached per tab)
      const led = await getLedgerEventsCached(asoraGetJson);
      const list = Array.isArray(led?.events) ? led.events : [];

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

      // Render-only stamp (UTC string if backend provided; otherwise “now” from event ts max is not reliable)
      // We keep this simple: show client-side UTC timestamp label.
      const now = new Date();
      setComputedAtUtc(now.toISOString());
    } catch (e) {
      setErr(e?.message || "Failed to load inventory and ledger.");
      setItems([]);
      setEvents([]);
      setComputedAtUtc("");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load({ force: false });
  }, []);

  const focus = (filterItemId || "").trim();

  const inventoryById = useMemo(() => {
    const m = new Map();
    for (const it of items) {
      const id = typeof it?.id === "string" ? it.id : "";
      if (!id) continue;
      const q = it?.qty;
      const qty = typeof q === "number" && Number.isFinite(q) ? q : 0;
      m.set(id, qty);
    }
    return m;
  }, [items]);

  const ledgerDerivedById = useMemo(() => {
    const m = new Map();
    for (const e of events) {
      const id = typeof e?.itemId === "string" ? e.itemId : "";
      if (!id) continue;
      const q = e?.qtyDelta;
      if (typeof q !== "number" || !Number.isFinite(q)) continue;
      m.set(id, (m.get(id) || 0) + q);
    }
    return m;
  }, [events]);

  const rows = useMemo(() => {
    // Union of ids, deterministic sort by itemId
    const ids = new Set();
    for (const k of inventoryById.keys()) ids.add(k);
    for (const k of ledgerDerivedById.keys()) ids.add(k);

    const list = Array.from(ids).sort((a, b) => a.localeCompare(b));

    const out = list.map((id) => {
      const hasInv = inventoryById.has(id);
      const hasLed = ledgerDerivedById.has(id);
      const invQty = hasInv ? inventoryById.get(id) : null;
      const ledQty = hasLed ? ledgerDerivedById.get(id) : null;

      let status = "MATCH";
      if (!hasInv && hasLed) status = "MISSING_INVENTORY";
      else if (hasInv && !hasLed) status = "MISSING_LEDGER";
      else if (hasInv && hasLed && invQty !== ledQty) status = "MISMATCH";

      return {
        itemId: id,
        inventoryQty: invQty,
        ledgerDerivedQty: ledQty,
        status,
      };
    });

    return out;
  }, [inventoryById, ledgerDerivedById]);

  const filtered = useMemo(() => {
    if (!focus) return rows;
    // Exact match only (deterministic, no fuzzy search)
    return rows.filter((r) => r.itemId === focus);
  }, [rows, focus]);

  const mismatchesOnly = useMemo(() => filtered.filter((r) => r.status !== "MATCH"), [filtered]);

  function exportMismatchesCsv() {
    const header = ["itemId", "inventoryQty", "ledgerDerivedQty", "status"].map(csvEscape);
    const body = mismatchesOnly.map((r) => [
      csvEscape(r.itemId),
      csvEscape(r.inventoryQty === null ? "" : String(r.inventoryQty)),
      csvEscape(r.ledgerDerivedQty === null ? "" : String(r.ledgerDerivedQty)),
      csvEscape(r.status),
    ]);
    const safe = (focus || "all").replace(/[^a-zA-Z0-9_-]/g, "_");
    downloadCsv(`asora_reconciliation_mismatches_${safe}.csv`, [header, ...body]);
  }

  function applySaved(value) {
    const v = (value || "").trim();
    setFilterItemId(v);
    setPersistedItemId(v);
  }

  return (
    <main style={s.shell}>
      <CompactBar here="Reconciliation" />

      <header style={s.header}>
        <div style={s.title}>Inventory Reconciliation</div>
        <div style={s.sub}>
          Compares inventory quantities to ledger-derived totals (read-only). Deterministic union by itemId. Uses cached
          ledger fetch per tab.
        </div>
      </header>

      <section style={s.card}>
        <div style={s.controls}>
          <label style={s.label}>
            Focus itemId (exact)
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
            {loading ? "Recomputing..." : "Recompute (cached)"}
          </button>

          <button style={s.buttonSecondary} onClick={() => load({ force: true })} disabled={loading}>
            Recompute (force)
          </button>

          <button style={s.buttonSecondary} onClick={exportMismatchesCsv} disabled={loading || mismatchesOnly.length === 0}>
            Export mismatches CSV
          </button>

          <div style={s.meta}>
            Rows: <span style={s.mono}>{rows.length}</span> | Focus rows: <span style={s.mono}>{filtered.length}</span> | Mismatches:{" "}
            <span style={s.mono}>{mismatchesOnly.length}</span>
            {computedAtUtc ? (
              <>
                {" "}
                | Computed at (UTC): <span style={s.mono}>{computedAtUtc}</span>
              </>
            ) : null}
          </div>
        </div>

        {/* Saved Views */}
        <div style={{ marginTop: 12 }}>
          <SavedViewsBar storageKey={SAVED_VIEWS_KEY} valueLabel="itemId" currentValue={focus} onApply={applySaved} />
        </div>

        {err ? <div style={s.err}>Error: {err}</div> : null}
        {rows.length === 0 && !loading ? <div style={s.empty}>No data to reconcile.</div> : null}

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
              {filtered.map((r) => {
                const key = r.itemId;
                const isMismatch = r.status !== "MATCH";
                return (
                  <tr key={key}>
                    <td style={s.td}>
                      <span style={s.mono}>{r.itemId}</span>
                    </td>
                    <td style={s.tdRight}>
                      <span style={s.mono}>{r.inventoryQty === null ? "—" : r.inventoryQty}</span>
                    </td>
                    <td style={s.tdRight}>
                      <span style={s.mono}>{r.ledgerDerivedQty === null ? "—" : r.ledgerDerivedQty}</span>
                    </td>
                    <td style={{ ...s.td, ...(isMismatch ? s.bad : null) }}>{r.status}</td>
                    <td style={s.td}>
                      <Link style={s.link} href={itemHref(r.itemId)}>
                        Drill-down
                      </Link>
                      <span style={s.muted}> · </span>
                      <Link style={s.link} href={movementsHref(r.itemId)}>
                        Movements
                      </Link>
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
          <li>Ledger-derived totals are computed by summing numeric qtyDelta by itemId (negative allowed).</li>
          <li>Status meanings: MATCH, MISMATCH, MISSING_INVENTORY, MISSING_LEDGER.</li>
          <li>Saved Views are local-only (localStorage) and do not affect backend behavior.</li>
          <li>Deterministic ordering by itemId ascending.</li>
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
  input: { width: 280, padding: "8px 10px", borderRadius: 10, border: "1px solid #ccc", outline: "none", fontSize: 13 },

  button: { padding: "8px 12px", borderRadius: 10, border: "1px solid #111", background: "#111", color: "#fff", cursor: "pointer", fontSize: 13, height: 34 },
  buttonSecondary: { padding: "8px 12px", borderRadius: 10, border: "1px solid #bbb", background: "#fff", color: "#111", cursor: "pointer", fontSize: 13, height: 34 },

  meta: { fontSize: 13, color: "#444", paddingBottom: 2 },

  tableWrap: { width: "100%", overflowX: "auto", marginTop: 12 },
  table: { borderCollapse: "collapse", width: "100%" },
  th: { textAlign: "left", fontSize: 12, color: "#444", borderBottom: "1px solid #eee", padding: "10px 8px" },
  thRight: { textAlign: "right", fontSize: 12, color: "#444", borderBottom: "1px solid #eee", padding: "10px 8px" },
  td: { padding: "10px 8px", borderBottom: "1px solid #f0f0f0", fontSize: 13, verticalAlign: "top" },
  tdRight: { padding: "10px 8px", borderBottom: "1px solid #f0f0f0", fontSize: 13, textAlign: "right", verticalAlign: "top" },

  link: { color: "#0b57d0", textDecoration: "none", fontSize: 13 },
  muted: { color: "#777" },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },

  err: { marginTop: 10, color: "#b00020", fontSize: 13 },
  empty: { marginTop: 12, color: "#666", fontSize: 13 },
  bad: { color: "#b00020", fontWeight: 700 },

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
  buttonSecondary: { ...styles.buttonSecondary, padding: "6px 10px", fontSize: 12, height: 30 },

  meta: { ...styles.meta, fontSize: 12 },

  th: { ...styles.th, padding: "8px 6px", fontSize: 11 },
  thRight: { ...styles.thRight, padding: "8px 6px", fontSize: 11 },
  td: { ...styles.td, padding: "8px 6px", fontSize: 12 },
  tdRight: { ...styles.tdRight, padding: "8px 6px", fontSize: 12 },

  link: { ...styles.link, fontSize: 12 },

  err: { ...styles.err, fontSize: 12 },
  empty: { ...styles.empty, fontSize: 12 },

  noteTitle: { ...styles.noteTitle, fontSize: 13 },
  ul: { ...styles.ul, fontSize: 12 },
};
