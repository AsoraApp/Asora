"use client";

import { useMemo } from "react";
import CompactBar from "./CompactBar.jsx";

export const runtime = "edge";

export default function LedgerFreshnessBar({
  lastFetchedUtc,
  cacheStatus,
  onRefresh,
  onForceRefresh,
}) {
  const ts = useMemo(() => {
    if (!lastFetchedUtc) return "—";
    try {
      return String(lastFetchedUtc);
    } catch {
      return "—";
    }
  }, [lastFetchedUtc]);

  return (
    <CompactBar
      title="Data freshness"
      right={
        <div style={styles.right}>
          <span style={styles.kv}>
            <span style={styles.k}>status</span>
            <span style={styles.v}>{cacheStatus || "unknown"}</span>
          </span>
          <span style={styles.kv}>
            <span style={styles.k}>last fetched</span>
            <span style={styles.vMono}>{ts}</span>
          </span>

          <button style={styles.btn} onClick={onRefresh}>
            Refresh
          </button>
          <button style={styles.btnSecondary} onClick={onForceRefresh}>
            Force
          </button>
        </div>
      }
    />
  );
}

const styles = {
  right: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
  kv: {
    display: "inline-flex",
    gap: 6,
    alignItems: "center",
    border: "1px solid rgba(255,255,255,0.12)",
    padding: "4px 8px",
    borderRadius: 999,
    background: "rgba(255,255,255,0.03)",
  },
  k: { fontSize: 12, opacity: 0.75 },
  v: { fontSize: 12, fontWeight: 700 },
  vMono: {
    fontSize: 12,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
  btn: {
    padding: "6px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "#e6edf3",
    cursor: "pointer",
    fontSize: 12,
  },
  btnSecondary: {
    padding: "6px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.20)",
    color: "#e6edf3",
    cursor: "pointer",
    fontSize: 12,
  },
};
