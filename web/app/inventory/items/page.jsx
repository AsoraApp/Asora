import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { asoraGetJson } from "@/lib/asoraFetch";
import CompactBar, { useDensity } from "../_ui/CompactBar.jsx";
import { usePersistedString } from "../_ui/useViewState.jsx";

export const runtime = "edge";

const STORE_KEY = "asora_view:items:itemId";

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

  out.sort((a, b) => a.itemId.localeCompare(b.itemId));
  return out;
}

export default function InventoryItemsPage() {
  const { isCompact } = useDensity();
  const s = isCompact ? compact : styles;

  const sp = useSearchParams();
  const qpItemId = sp?.get("itemId") || "";

  const [persistedFocus, setPersistedFocus] = usePersistedString(STORE_KEY, "");
  const [focusItemId, setFocusItemId] = useState(qpItemId || persistedFocus);

  useEffect(() => {
    if (qpItemId && qpItemId !== focusItemId) {
      setFocusItemId(qpItemId);
      setPersistedFocus(qpItemId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qpItemId]);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [rows, setRows] = useState([]);

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const r = await asoraGetJson("/v1/inventory/items", {});
      setRows(normalizeInventoryItemsPayload(r));
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

  return (
    <main style={s.shell}>
      <AdminHeader
        title="Inventory Items"
        subtitle="Read-only inventory item list. Focus is saved locally."
      />

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
                Drill-down
              </Link>
              <Link style={s.linkSecondary} href={movementsHref(focus)}>
                Movements
              </Link>
              <Link style={s.linkSecondary} href={reconciliationHref(focus)}>
                Reconcile
              </Link>
            </div>
          ) : null}

          <div style={s.meta}>
            Rows: <span style={s.mono}>{filtered.length}</span> | With qty:{" "}
            <span style={s.mono}>{qtyStats.withQty}</span> | Without qty:{" "}
            <span style={s.mono}>{qtyStats.withoutQty}</span>
          </div>
        </div>

        {err ? <div style={s.err}>Error: {err}</div> : null}
        {filtered.length === 0 && !loading ? <div style={s.empty}>No inventory items.</div> : null}

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
                  <td style={s.td}><span style={s.mono}>{r.itemId}</span></td>
                  <td style={s.tdRight}><span style={s.mono}>{r.quantity ?? "—"}</span></td>
                  <td style={s.td}>
                    <Link style={s.link} href={itemHref(r.itemId)}>Drill-down</Link>{" "}
                    <Link style={s.linkSecondary} href={movementsHref(r.itemId)}>Movements</Link>{" "}
                    <Link style={s.linkSecondary} href={reconciliationHref(r.itemId)}>Reconcile</Link>
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
  controls: { display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" },
  label: { display: "flex", flexDirection: "column", fontSize: 13 },
  input: { width: 280, padding: "8px 10px", borderRadius: 10, border: "1px solid #ccc" },
  button: { padding: "8px 12px", borderRadius: 10, background: "#111", color: "#fff" },
  quickLinks: { display: "flex", gap: 10 },
  link: { color: "#0b57d0", textDecoration: "none" },
  linkSecondary: { color: "#444", textDecoration: "none" },
  meta: { fontSize: 13 },
  err: { color: "#b00020" },
  empty: { color: "#666" },
  tableWrap: { overflowX: "auto", marginTop: 12 },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", borderBottom: "1px solid #eee" },
  thRight: { textAlign: "right", borderBottom: "1px solid #eee" },
  td: { padding: "8px" },
  tdRight: { padding: "8px", textAlign: "right" },
  mono: { fontFamily: "ui-monospace, monospace" },
};

const compact = styles;
