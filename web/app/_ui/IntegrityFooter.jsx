// web/app/_ui/IntegrityFooter.jsx
"use client";

export default function IntegrityFooter({
  eventsProcessed = 0,
  skipped = [], // [{ reason: string, count: number }]
  renderUtc = "",
}) {
  const sorted = [...(skipped || [])].sort((a, b) => String(a.reason).localeCompare(String(b.reason)));

  return (
    <footer style={styles.wrap}>
      <div style={styles.title}>Integrity</div>

      <div style={styles.row}>
        <div style={styles.k}>Ledger events processed</div>
        <div style={styles.vMono}>{Number(eventsProcessed) || 0}</div>
      </div>

      <div style={styles.row}>
        <div style={styles.k}>Skipped</div>
        <div style={styles.v}>
          {sorted.length === 0 ? (
            <span style={styles.vMono}>0</span>
          ) : (
            <ul style={styles.ul}>
              {sorted.map((s) => (
                <li key={s.reason} style={styles.li}>
                  <span style={styles.vMono}>{Number(s.count) || 0}</span>{" "}
                  <span style={styles.muted}>—</span> {String(s.reason)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div style={styles.row}>
        <div style={styles.k}>Determinism</div>
        <div style={styles.v}>
          Static view. Read-only. Client-side derivation only. No writes. UTC timestamps. Deterministic sorting keys applied.
        </div>
      </div>

      <div style={styles.row}>
        <div style={styles.k}>Rendered (UTC)</div>
        <div style={styles.vMono}>{renderUtc || "—"}</div>
      </div>
    </footer>
  );
}

const styles = {
  wrap: {
    maxWidth: 1200,
    margin: "0 auto 24px auto",
    padding: 14,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.03)",
    color: "#e6edf3",
  },
  title: { fontSize: 13, fontWeight: 850, marginBottom: 10, opacity: 0.95 },
  row: {
    display: "grid",
    gridTemplateColumns: "220px 1fr",
    gap: 10,
    padding: "8px 0",
    borderTop: "1px solid rgba(255,255,255,0.08)",
  },
  k: { fontSize: 12, opacity: 0.75 },
  v: { fontSize: 12, opacity: 0.92, lineHeight: 1.35 },
  vMono: { fontSize: 12, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },
  muted: { opacity: 0.6 },
  ul: { margin: 0, paddingLeft: 18 },
  li: { margin: "2px 0" },
};
