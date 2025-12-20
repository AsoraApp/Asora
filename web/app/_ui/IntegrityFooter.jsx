"use client";

export const runtime = "edge";

export default function IntegrityFooter({
  processedCount = 0,
  skippedCount = 0,
  skippedReasons = {},
  renderedAtUtc,
}) {
  const ts = renderedAtUtc || new Date().toISOString();

  return (
    <footer style={styles.shell}>
      <div style={styles.row}>
        <span style={styles.k}>ledger events processed</span>
        <span style={styles.v}>{processedCount}</span>
      </div>

      <div style={styles.row}>
        <span style={styles.k}>events skipped</span>
        <span style={styles.v}>{skippedCount}</span>
      </div>

      {skippedReasons && Object.keys(skippedReasons).length > 0 ? (
        <div style={styles.reasons}>
          {Object.entries(skippedReasons).map(([reason, count]) => (
            <div key={reason} style={styles.reasonRow}>
              <span style={styles.k}>{reason}</span>
              <span style={styles.v}>{count}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div style={styles.hr} />

      <div style={styles.meta}>
        <span>Deterministic, read-only derived view.</span>
        <span>UTC render time:</span>
        <span style={styles.mono}>{ts}</span>
      </div>
    </footer>
  );
}

const styles = {
  shell: {
    marginTop: 16,
    padding: 12,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(0,0,0,0.20)",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 12,
  },
  reasons: {
    marginTop: 4,
    paddingLeft: 6,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  reasonRow: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 12,
    opacity: 0.85,
  },
  k: { opacity: 0.7 },
  v: { fontWeight: 700 },
  hr: {
    height: 1,
    background: "rgba(255,255,255,0.10)",
    margin: "6px 0",
  },
  meta: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
    fontSize: 11,
    opacity: 0.7,
  },
  mono: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
};
