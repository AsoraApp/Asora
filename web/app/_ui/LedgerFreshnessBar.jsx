"use client";

export default function LedgerFreshnessBar({ lastFetchedUtc, cacheStatus, loading, onRefresh, onForceRefresh }) {
  return (
    <div style={styles.wrap}>
      <div style={styles.meta}>
        <div style={styles.row}>
          <span style={styles.k}>Ledger cache</span>
          <span style={styles.v}>{cacheStatus || "cached"}</span>
        </div>
        <div style={styles.row}>
          <span style={styles.k}>Last fetched (UTC)</span>
          <span style={styles.vMono}>{lastFetchedUtc || "—"}</span>
        </div>
      </div>

      <div style={styles.actions}>
        <button style={styles.btn} onClick={onRefresh} disabled={Boolean(loading)}>
          Refresh (cached)
        </button>
        <button style={styles.btnSecondary} onClick={onForceRefresh} disabled={Boolean(loading)}>
          Refresh (force)
        </button>
      </div>
    </div>
  );
}

const styles = {
  wrap: {
    border: "1px solid #e5e5e5",
    borderRadius: 12,
    padding: 12,
    background: "#fff",
    minWidth: 320,
  },
  meta: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 },
  row: { display: "flex", justifyContent: "space-between", gap: 10 },
  k: { fontSize: 12, color: "#555" },
  v: { fontSize: 12, fontWeight: 700, color: "#111" },
  vMono: { fontSize: 12, color: "#111", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },

  actions: { display: "flex", gap: 10, flexWrap: "wrap" },
  btn: { padding: "8px 10px", borderRadius: 10, border: "1px solid #111", background: "#111", color: "#fff", cursor: "pointer", fontSize: 12 },
  btnSecondary: { padding: "8px 10px", borderRadius: 10, border: "1px solid #bbb", background: "#fff", color: "#111", cursor: "pointer", fontSize: 12 },
};
