"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const LS_KEY = "asora:lastItemSearch";

export default function GlobalItemSearch() {
  const router = useRouter();
  const [itemId, setItemId] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Load last value once on mount (tab-safe, deterministic: no timers)
    try {
      const v = localStorage.getItem(LS_KEY);
      if (v && typeof v === "string") setItemId(v);
    } catch {
      // ignore
    } finally {
      setHydrated(true);
    }
  }, []);

  function persist(v) {
    try {
      if (!v) localStorage.removeItem(LS_KEY);
      else localStorage.setItem(LS_KEY, v);
    } catch {
      // ignore
    }
  }

  function gotoItem(v) {
    router.push(`/inventory/item?itemId=${encodeURIComponent(v)}`);
  }

  function gotoMovements(v) {
    router.push(`/inventory/movements?itemId=${encodeURIComponent(v)}`);
  }

  function onSubmit(e) {
    e.preventDefault();
    const v = itemId.trim();
    if (!v) return;
    persist(v);
    gotoItem(v);
  }

  function onClear() {
    setItemId("");
    persist("");
  }

  const v = itemId.trim();
  const disabled = !hydrated; // prevents mismatch during first paint

  return (
    <div
      style={{
        padding: 12,
        borderBottom: "1px solid #e5e7eb",
        display: "flex",
        gap: 8,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <form onSubmit={onSubmit} style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="text"
          value={itemId}
          onChange={(e) => setItemId(e.target.value)}
          placeholder="Go to itemId…"
          style={{ padding: 8, width: 260, fontSize: 14 }}
          disabled={disabled}
        />

        <button
          type="submit"
          disabled={disabled || !v}
          style={{
            padding: "8px 12px",
            fontSize: 14,
            cursor: disabled || !v ? "not-allowed" : "pointer",
          }}
        >
          Item
        </button>
      </form>

      <button
        type="button"
        disabled={disabled || !v}
        onClick={() => {
          persist(v);
          gotoMovements(v);
        }}
        style={{
          padding: "8px 12px",
          fontSize: 14,
          cursor: disabled || !v ? "not-allowed" : "pointer",
        }}
      >
        Movements
      </button>

      <button
        type="button"
        disabled={disabled || (!itemId && !localStorage)}
        onClick={onClear}
        style={{
          padding: "8px 12px",
          fontSize: 14,
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        Clear
      </button>

      <div style={{ fontSize: 12, opacity: 0.7 }}>
        Tip: Enter navigates to Item.
      </div>
    </div>
  );
}
