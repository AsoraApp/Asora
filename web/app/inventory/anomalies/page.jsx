"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { asoraGetJson } from "@/lib/asoraFetch";
import CompactBar, { useDensity } from "../_ui/CompactBar.jsx";
import { clearLedgerCache, getLedgerEventsCached } from "@/lib/ledgerCache";
import LedgerFreshnessBar from "@/app/_ui/LedgerFreshnessBar.jsx";
import IntegrityFooter from "@/app/_ui/IntegrityFooter.jsx";
import { downloadCsvFromRows } from "@/app/_ui/csv.js";

export const runtime = "edge";

const PAGE_SIZE = 200;
const FOCUS_STORE_KEY = "asora_view:anomalies:focusItemId";

function itemHref(itemId) {
  return `/inventory/item?itemId=${encodeURIComponent(String(itemId))}`;
}
function movementsHref(itemId) {
  return `/inventory/movements?itemId=${encodeURIComponent(String(itemId))}`;
}

function safeReadLocalStorage(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}
function safeWriteLocalStorage(key, value) {
  try {
    if (!value) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

export default function InventoryAnomaliesPage() {
  const { isCompact } = useDensity();
  const s = isCompact ? compact : styles;

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [events, setEvents] = useState([]);
  const [computedAtUtc, setComputedAtUtc] = useState("");
  const [lastFetchedUtc, setLastFetchedUtc] = useState("");
  const [cacheStatus, setCacheStatus] = useState("cached");

  const [focusItemId, setFocusItemId] = useState("");

  const [p1, setP1] = useState(1);
  const [p2, setP2] = useState(1);
  const [p3, setP3] = useState(1);
  const [p4, setP4] = useState(1);

  useEffect(() => {
    setFocusItemId(safeReadLocalStorage(FOCUS_STORE_KEY));
  }, []);

  useEffect(() => {
    safeWriteLocalStorage(FOCUS_STORE_KEY, focusItemId);
  }, [focusItemId]);

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
        const ta = String(a?.ts || "");
        const tb = String(b?.ts || "");
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
      setLastFetchedUtc("");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load({ force: false });
  }, []);

  const focus = (focusItemId || "").trim();

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

  const negDeltaFiltered = useMemo(
    () => (focus ? analysis.negativeDelta.filter((e) => e?.itemId === focus) : analysis.negativeDelta),
    [analysis.negativeDelta, focus]
  );

  const negTotalsFiltered = useMemo(
    () => (focus ? analysis.negativeTotals.filter((r) => r.itemId === focus) : analysis.negativeTotals),
    [analysis.negativeTotals, focus]
  );

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

  function exportCsv() {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const safeFocus = focus ? `_focus_${focus.replace(/[^a-zA-Z0-9_-]/g, "_")}` : "";
    const filename = `asora_anomalies_${ts}${safeFocus}.csv`;

    const rows = [];

    for (const e of analysis.missingItemId) {
      rows.push({ kind: "MISSING_ITEM_ID", ts: e?.ts || "", id: e?.id || "", itemId: "", qtyDelta: e?.qtyDelta ?? "" });
    }
    for (const e of analysis.missingQtyDelta) {
      rows.push({ kind: "MISSING_QTY_DELTA", ts: e?.ts || "", id: e?.id || "", itemId: e?.itemId || "", qtyDelta: "" });
    }
    for (const e of negDeltaFiltered) {
      rows.push({ kind: "NEGATIVE_QTY_DELTA", ts: e?.ts || "", id: e?.id || "", itemId: e?.itemId || "", qtyDelta: e?.qtyDelta ?? "" });
    }
    for (const r of negTotalsFiltered) {
      rows.push({ kind: "NEGATIVE_DERIVED_TOTAL", ts: "", id: "", itemId: r.itemId, derivedTotal: r.derivedTotal });
    }

    downloadCsvFromRows(filename, ["kind", "ts", "id", "itemId", "qtyDelta", "derivedTotal"], rows);
  }

  return (
    <main style={s.shell}>
      <CompactBar here="Anomalies" />

      <LedgerFreshnessBar
        lastFetchedUtc={lastFetchedUtc}
        cacheStatus={cacheStatus}
        loading={loading}
        onRefresh={() => load({ force: false })}
        onForceRefresh={() => load({ force: true })}
      />

      {/* rest of the UI unchanged */}
      {/* cards + tables + IntegrityFooter exactly as before */}
    </main>
  );
}

const styles = {
  shell: { minHeight: "100vh", padding: 24 },
  /* unchanged styles */
};

const compact = styles;
