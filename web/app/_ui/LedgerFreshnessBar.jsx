// web/app/_ui/LedgerFreshnessBar.jsx
"use client";

export default function LedgerFreshnessBar({
  lastFetchedUtc = "",
  cacheStatus = "unknown", // "cached" | "fresh" | "unknown"
  onRefreshCached,
  onRefreshForce,
  onClearCache,
  busy = false,
}) {
  return (
    <div style={styles.row}>
      <div style={styles.left}>
        <div style={styles.label}>Data freshness</div>
        <div style={styles.meta}>
          <span style={styles.k}>Last fetched (UTC):</span>{" "}
          <span style={styles.mono}>{lastFetchedUtc || "—"}</span>
          <span style={styles.sep}>·</span>
          <span style={styles.k}>Cache:</span>{" "}
          <span style={styles.badge}>{cacheStatus}</span>
        </div>
      </div>

      <div style={styles.actions}>
        <button style={styles.btn} onClick={onRefreshCached} disabled={busy || !onRefreshCached}>
          Refresh (cached)
        </button>
        <button style={styles.btn} onClick={onRefreshForce} disabled={busy || !onRefreshForce}>
          Refresh (force)
        </button>
        <button style={styles.btnMuted} onClick={onClearCache} disabled={busy || !onClearCache}>
          Clear cache
        </button>
      </div>
    </div>
  );
}

const styles = {
  row: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    alignItems: "center",
  },
  left: { display: "flex", flexDirection: "column", gap: 6 },
  label: { fontSize: 12, fontWeight: 800, opacity: 0.9 },
  meta: { fontSize: 12, opacity: 0.9, lineHeight: 1.35 },
  k: { opacity: 0.75 },
  sep: { margin: "0 8px", opacity: 0.5 },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },
  badge: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.18)",
    fontSize: 12,
  },
  actions: { display: "flex", gap: 8, flexWrap: "wrap" },
  btn: {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "#e6edf3",
    cursor: "pointer",
    fontSize: 12,
  },
  btnMuted: {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.03)",
    color: "#e6edf3",
    cursor: "pointer",
    fontSize: 12,
    opacity: 0.9,
  },
};
