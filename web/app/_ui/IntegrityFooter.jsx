export default function IntegrityFooter({
  processedCount,
  skippedCount,
  skippedReasons,
  renderUtc,
}) {
  return (
    <footer style={styles.footer}>
      <div>
        <strong>Integrity:</strong>{" "}
        {processedCount} events processed ·{" "}
        {skippedCount} skipped
      </div>
      {skippedReasons && skippedReasons.length > 0 && (
        <ul style={styles.list}>
          {skippedReasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      <div style={styles.meta}>
        Deterministic read-only derivation · Rendered {renderUtc} UTC
      </div>
    </footer>
  );
}

const styles = {
  footer: {
    marginTop: 24,
    paddingTop: 12,
    borderTop: "1px solid #e5e7eb",
    fontSize: 12,
    color: "#374151",
  },
  list: {
    marginTop: 4,
    paddingLeft: 16,
  },
  meta: {
    marginTop: 4,
    color: "#6b7280",
  },
};
