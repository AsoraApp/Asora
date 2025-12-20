"use client";

export default function IntegrityFooter({ ledgerEventsProcessed, skipped, renderUtc }) {
  const list = Array.isArray(skipped) ? skipped : [];
  return (
    <div style={styles.wrap}>
      <div style={styles.row}>
        <span style={styles.k}>Ledger events processed</span>
        <span style={styles.vMono}>{String(ledgerEventsProcessed ?? 0)}</span>
      </div>

      <div style={styles.row}>
        <span style={styles.k}>Rendered at (UTC)</span>
        <span style={styles.vMono}>{renderUtc || "—"}</span>
      </div>

      {list.length ? (
        <div style={styles.skipped}>
          <div style={styles.skippedTitle}>Skipped</div>
          <ul style={styles.ul}>
            {list.map((x, i) => (
              <li key={i} style={styles.li}>
                <span style={styles.vMono}>{x?.reason || "unknown"}</span>:{" "}
                <span style={styles.vMono}>{String(x?.count ?? 0)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

const styles = {
  wrap: { marginTop: 14, borderTop: "1px solid #eee", paddingTop: 12, display: "flex", flexDirection: "column", gap: 6 },
  row: { display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" },
  k: { fontSize: 12, color: "#555" },
  vMono: { fontSize: 12, color: "#111", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },

  skipped: { marginTop: 8 },
  skippedTitle: { fontSize: 12, fontWeight: 800, marginBottom: 6 },
  ul: { margin: 0, paddingLeft: 18 },
  li: { fontSize: 12, color: "#333", lineHeight: 1.4 },
};
