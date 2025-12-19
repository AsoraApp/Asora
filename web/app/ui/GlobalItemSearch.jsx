"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function GlobalItemSearch() {
  const router = useRouter();
  const [itemId, setItemId] = useState("");

  function onSubmit(e) {
    e.preventDefault();
    const v = itemId.trim();
    if (!v) return;
    router.push(`/inventory/item?itemId=${encodeURIComponent(v)}`);
  }

  return (
    <form
      onSubmit={onSubmit}
      style={{
        padding: 12,
        borderBottom: "1px solid #e5e7eb",
        display: "flex",
        gap: 8,
        alignItems: "center",
      }}
    >
      <input
        type="text"
        value={itemId}
        onChange={(e) => setItemId(e.target.value)}
        placeholder="Go to itemId…"
        style={{ padding: 8, width: 260, fontSize: 14 }}
      />
      <button
        type="submit"
        disabled={!itemId.trim()}
        style={{
          padding: "8px 12px",
          fontSize: 14,
          cursor: itemId.trim() ? "pointer" : "not-allowed",
        }}
      >
        Go
      </button>
    </form>
  );
}
