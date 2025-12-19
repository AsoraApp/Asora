"use client";

export default function LedgerFreshnessBar({ lastFetchedUtc, cacheStatus, onRefresh, onClearCache }) {
  return (
    <div style={styles.bar}>
      <div style={styles.left}>
        <b>Data freshness:</b>{" "}
        <span style={styles.mono}>{lastFetchedUtc ? `${lastFetchedUtc} UTC` : "not loaded"}</span>
        {" · "}
        <span style={styles.badge}>{cacheStatus || "—"}</span>
      </div>

      <div style={styles.actions}>
        {onRefresh ? (
          <button style={styles.btn} onClick={onRefresh}>
            Refresh
          </button>
        ) : null}
        {onClearCache ? (
          <button style={styles.btnSecondary} onClick={onClearCache}>
            Clear cache
          </button>
        ) : null}
      </div>
    </div>
  );
}

const styles = {
  bar: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    alignItems: "center",
    padding: "8px 10px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.10)",
    background: "rgba(0,0,0,0.03)",
    fontSize: 12,
    flexWrap: "wrap",
  },
  left: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" },
  actions: { display: "flex", gap: 8 },
  btn: { padding: "6px 10px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)", background: "#111", color: "#fff", cursor: "pointer", fontSize: 12 },
  btnSecondary: { padding: "6px 10px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)", background: "#fff", color: "#111", cursor: "pointer", fontSize: 12 },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },
  badge: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", opacity: 0.85 },
};
