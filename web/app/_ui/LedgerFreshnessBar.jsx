"use client";

export default function LedgerFreshnessBar({
  lastFetchedUtc,
  cacheStatus,
  onRefresh,
  onClearCache,
}) {
  return (
    <div style={styles.bar}>
      <div>
        <strong>Data freshness:</strong>{" "}
        {lastFetchedUtc
          ? `${lastFetchedUtc} UTC`
          : "not loaded"}
        {" · "}
        {cacheStatus}
      </div>
      <div style={styles.actions}>
        {onRefresh && (
          <button onClick={onRefresh} style={styles.button}>
            Refresh
          </button>
        )}
        {onClearCache && (
          <button onClick={onClearCache} style={styles.buttonSecondary}>
            Clear cache
          </button>
        )}
      </div>
    </div>
  );
}

const styles = {
  bar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 12,
    background: "#f9fafb",
    border: "1px solid #e5e7eb",
    padding: "6px 8px",
  },
  actions: {
    display: "flex",
    gap: 8,
  },
  button: {
    fontSize: 12,
  },
  buttonSecondary: {
    fontSize: 12,
    color: "#374151",
  },
};
