"use client";

import { useEffect, useMemo, useState } from "react";
import { getStoredDevToken } from "@/lib/asoraFetch";

export const runtime = "edge";

const DENSITY_KEY = "asora_ui:dense";

function safeReadBool(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    if (v === null || v === undefined) return fallback;
    return v === "1" || v === "true";
  } catch {
    return fallback;
  }
}

function safeWriteBool(key, value) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // ignore
  }
}

export function useDensity(defaultDense = true) {
  const [dense, setDense] = useState(defaultDense);

  useEffect(() => {
    setDense(safeReadBool(DENSITY_KEY, defaultDense));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setAndPersist = (next) => {
    const v = typeof next === "function" ? Boolean(next(dense)) : Boolean(next);
    setDense(v);
    safeWriteBool(DENSITY_KEY, v);
  };

  return { dense, setDense: setAndPersist };
}

/**
 * Minimal shared top bar used across read-only views.
 * - Dev token display only (token entry UI lives in AdminHeader)
 * - Optional actions provided via props
 */
export default function CompactBar({
  title = "",
  right = null,
  actions = null,
  style = null
}) {
  const devToken = useMemo(() => getStoredDevToken(), []);

  return (
    <div style={{ ...styles.bar, ...(style || null) }}>
      <div style={styles.left}>
        {title ? <div style={styles.title}>{title}</div> : <div style={styles.title}>Asora</div>}
        <div style={styles.meta}>
          <span style={styles.k}>dev_token:</span>{" "}
          <span style={styles.v}>{devToken ? String(devToken) : "(not set)"}</span>
        </div>
      </div>

      <div style={styles.right}>
        {actions ? <div style={styles.actions}>{actions}</div> : null}
        {right}
      </div>
    </div>
  );
}

const styles = {
  bar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.02)",
    marginBottom: 12
  },
  left: { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 },
  title: { fontSize: 13, fontWeight: 800, opacity: 0.95 },
  meta: {
    fontSize: 12,
    opacity: 0.85,
    display: "flex",
    gap: 6,
    alignItems: "center",
    minWidth: 0
  },
  k: { opacity: 0.8 },
  v: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: 520
  },
  right: { display: "flex", gap: 10, alignItems: "center", justifyContent: "flex-end" },
  actions: { display: "flex", gap: 8, alignItems: "center" }
};
