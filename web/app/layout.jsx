"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import DevTokenBar from "@/app/ui/DevTokenBar";

export const runtime = "edge";

export const metadata = {
  title: "Asora — U1",
  description: "Asora U1 read-only admin console",
};

export default function RootLayout({ children }) {
  const router = useRouter();
  const [itemId, setItemId] = useState("");

  function onSubmit(e) {
    e.preventDefault();
    if (!itemId.trim()) return;

    router.push(`/inventory/item?itemId=${encodeURIComponent(itemId.trim())}`);
  }

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial",
        }}
      >
        <DevTokenBar />

        {/* GLOBAL ITEM SEARCH */}
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
            style={{
              padding: 8,
              width: 260,
              fontSize: 14,
            }}
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

        <div style={{ padding: 16 }}>{children}</div>
      </body>
    </html>
  );
}
