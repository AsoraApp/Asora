export default function IntegrityFooter({ processedCount, skippedCount, skippedReasons, renderUtc }) {
  return (
    <footer style={styles.footer}>
      <div style={styles.line}>
        <b>Integrity:</b> processed <span style={styles.mono}>{processedCount ?? "—"}</span> · skipped{" "}
        <span style={styles.mono}>{skippedCount ?? "—"}</span>
      </div>

      {Array.isArray(skippedReasons) && skippedReasons.length > 0 ? (
        <ul style={styles.ul}>
          {skippedReasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      ) : null}

      <div style={styles.meta}>
        Deterministic read-only derivation · Rendered <span style={styles.mono}>{renderUtc || "—"}</span> UTC
      </div>
    </footer>
  );
}

const styles = {
  footer: { marginTop: 18, paddingTop: 12, borderTop: "1px solid rgba(0,0,0,0.08)", fontSize: 12, opacity: 0.9 },
  line: { marginBottom: 6 },
  ul: { margin: "6px 0 0 0", paddingLeft: 18, lineHeight: 1.5 },
  meta: { marginTop: 6, opacity: 0.8 },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },
};
