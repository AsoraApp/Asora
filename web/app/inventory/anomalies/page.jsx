"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import CompactBar, { useDensity } from "../_ui/CompactBar.jsx";
import { asoraGetJson } from "@/lib/asoraFetch";
import { clearLedgerCache, getLedgerEventsCached } from "@/lib/ledgerCache";
import { usePersistedString } from "../_ui/useViewState.jsx";
import SavedViewsBar from "@/app/ui/SavedViewsBar";

export const runtime = "edge";

const PAGE_SIZE = 200;

const FOCUS_STORE_KEY = "asora_view:anomalies:focusItemId";
const SAVED_VIEWS_KEY = "asora_saved_views:anomalies:focusItemId";

function itemHref(itemId) {
  return `/inventory/item?itemId=${encodeURIComponent(String(itemId))}`;
}
function movementsHref(itemId) {
  return `/inventory/movements?itemId=${encodeURIComponent(String(itemId))}`;
}

export default function InventoryAnomaliesPage() {
  const { isCompact } = useDensity();
  const s = isCompact ? compact : styles;

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [events, setEvents] = useState([]);

  // unified persisted focus
  const [focusItemId, setFocusItemId] = usePersistedString(FOCUS_STORE_KEY, "");

  const focus = (focusItemId || "").trim();

  // paging
  const [p1, setP1] = useState(1);
  const [p2, setP2] = useState(1);
  const [p3, setP3] = useState(1);
  const [p4, setP4] = useState(1);

  async function load({ force = false } = {}) {
    setLoading(true);
    setErr("");
    try {
      if (force) clearLedgerCache();
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

  const analysis = useMemo(() => {
    const missingItemId = [];
    const missingQtyDelta = [];
    const negativeDelta = [];
    const totals = new Map();

    for (const e of events) {
      const itemId = typeof e?.itemId === "string" ? e.itemId : "";
      const hasItemId = itemId.trim() !== "";

      const q = e?.qtyDelta;
      const hasQty = typeof q === "number" && Number.isFinite(q);

      if (!hasItemId) missingItemId.push(e);
      if (!hasQty) missingQtyDelta.push(e);
      if (hasQty && q < 0) negativeDelta.push(e);

      if (hasItemId && hasQty) {
        totals.set(itemId, (totals.get(itemId) || 0) + q);
      }
    }

    const negativeTotals = Array.from(totals.entries())
      .filter(([, v]) => v < 0)
      .map(([itemId, derivedTotal]) => ({ itemId, derivedTotal }))
      .sort((a, b) => a.itemId.localeCompare(b.itemId));

    return { missingItemId, missingQtyDelta, negativeDelta, negativeTotals };
  }, [events]);

  const negDeltaFiltered = useMemo(() => {
    if (!focus) return analysis.negativeDelta;
    return analysis.negativeDelta.filter((e) => e?.itemId === focus);
  }, [analysis.negativeDelta, focus]);

  const negTotalsFiltered = useMemo(() => {
    if (!focus) return analysis.negativeTotals;
    return analysis.negativeTotals.filter((r) => r.itemId === focus);
  }, [analysis.negativeTotals, focus]);

  useEffect(() => setP1(1), [analysis.missingItemId.length]);
  useEffect(() => setP2(1), [analysis.missingQtyDelta.length]);
  useEffect(() => setP3(1), [negDeltaFiltered.length]);
  useEffect(() => setP4(1), [negTotalsFiltered.length]);

  function slice(list, page) {
    return list.slice(0, Math.min(list.length, page * PAGE_SIZE));
  }
  function pages(list) {
    return Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  }

  function Pager({ list, page, setPage }) {
    const pc = pages(list);
    return (
      <div style={s.pagerRow}>
        <button style={s.pagerBtn} onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
          Prev
        </button>
        <div style={s.pagerText}>
          Page <span style={s.mono}>{page}</span> / <span style={s.mono}>{pc}</span>
        </div>
        <button style={s.pagerBtn} onClick={() => setPage((p) => Math.min(pc, p + 1))} disabled={page >= pc}>
          Next
        </button>
        <button style={s.pagerBtnSecondary} onClick={() => setPage(pc)} disabled={page >= pc}>
          End
        </button>
      </div>
    );
  }

  function applySaved(v) {
    setFocusItemId((v || "").trim());
  }

  return (
    <main style={s.shell}>
      <CompactBar here="Anomalies" />

      <section style={s.card}>
        <div style={s.controls}>
          <button style={s.button} onClick={() => load({ force: false })} disabled={loading}>
            Refresh (cached)
          </button>
          <button style={s.buttonSecondary} onClick={() => load({ force: true })} disabled={loading}>
            Refresh (force)
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
      </section>

      {/* Missing itemId */}
      <section style={s.card}>
        <div style={s.sectionTitle}>Missing itemId</div>
        <Pager list={analysis.missingItemId} page={p1} setPage={setP1} />
      </section>

      {/* Missing qtyDelta */}
      <section style={s.card}>
        <div style={s.sectionTitle}>Missing qtyDelta</div>
        <Pager list={analysis.missingQtyDelta} page={p2} setPage={setP2} />
      </section>

      {/* Negative deltas */}
      <section style={s.card}>
        <div style={s.sectionTitle}>Negative qtyDelta</div>
        <Pager list={negDeltaFiltered} page={p3} setPage={setP3} />
      </section>

      {/* Negative totals */}
      <section style={s.card}>
        <div style={s.sectionTitle}>Negative derived totals</div>
        <Pager list={negTotalsFiltered} page={p4} setPage={setP4} />
      </section>
    </main>
  );
}

const styles = {
  shell: { minHeight: "100vh", padding: 24 },
  card: { border: "1px solid #e5e5e5", borderRadius: 12, padding: 16, marginBottom: 16 },
  controls: { display: "flex", gap: 12, flexWrap: "wrap" },
  label: { display: "flex", flexDirection: "column", fontSize: 13 },
  input: { width: 260, padding: "8px 10px", borderRadius: 10, border: "1px solid #ccc" },
  button: { padding: "8px 12px", borderRadius: 10, background: "#111", color: "#fff", cursor: "pointer" },
  buttonSecondary: { padding: "8px 12px", borderRadius: 10, border: "1px solid #bbb", background: "#fff" },
  pagerRow: { display: "flex", gap: 10, alignItems: "center" },
  pagerBtn: { padding: "6px 10px" },
  pagerBtnSecondary: { padding: "6px 10px" },
  pagerText: { fontSize: 13 },
  err: { color: "#b00020" },
  sectionTitle: { fontWeight: 800, marginBottom: 8 },
  mono: { fontFamily: "ui-monospace, monospace" },
};

const compact = styles;
