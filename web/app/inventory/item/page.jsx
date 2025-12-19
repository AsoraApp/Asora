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

const STORE_KEY = "asora_view:item:itemId";
const SAVED_VIEWS_KEY = "asora_saved_views:item:itemId";

function movementsHref(itemId) {
  return `/inventory/movements?itemId=${encodeURIComponent(String(itemId))}`;
}

function itemHref(itemId) {
  return `/inventory/item?itemId=${encodeURIComponent(String(itemId))}`;
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

export default function InventoryItemDrillDownPage() {
  const { isCompact } = useDensity();

  const sp = useSearchParams();
  const qpItemId = sp?.get("itemId") || "";

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [persistedItemId, setPersistedItemId] = usePersistedString(STORE_KEY, "");

  // URL param wins; otherwise persisted.
  const [itemId, setItemId] = useState(qpItemId || persistedItemId);

  const [events, setEvents] = useState([]);

  // If URL itemId changes, adopt it and persist it.
  useEffect(() => {
    if (qpItemId && qpItemId !== itemId) {
      setItemId(qpItemId);
      setPersistedItemId(qpItemId);
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

      // Deterministic sort: ts asc, then id tie-break
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

  const focus = (itemId || "").trim();

  const filtered = useMemo(() => {
    if (!focus) return [];
    return events.filter((e) => typeof e?.itemId === "string" && e.itemId === focus);
  }, [events, focus]);

  const derivedTotalQtyDelta = useMemo(() => {
    let sum = 0;
    for (const e of filtered) {
      const q = e?.qtyDelta;
      if (typeof q === "number" && Number.isFinite(q)) sum += q;
    }
    return sum;
  }, [filtered]);

  function applySaved(value) {
    const v = (value || "").trim();
    setItemId(v);
    setPersistedItemId(v);
  }

  function exportCsv() {
    const v = focus;
    const header = ["itemId", "derivedTotalQtyDelt]()
