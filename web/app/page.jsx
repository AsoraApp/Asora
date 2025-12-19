import Link from "next/link";

export default function HomePage() {
  return (
    <main style={styles.shell}>
      <header style={styles.header}>
        <div style={styles.brand}>Asora</div>
        <div style={styles.sub}>U3 — Read-only Admin Console</div>
      </header>

      <section style={styles.card}>
        <div style={styles.cardTitle}>Navigation</div>
        <div style={styles.links}>
          <Link style={styles.link} href="/ledger">
            Ledger Viewer
          </Link>
          <Link style={styles.link} href="/inventory/items">
            Inventory Items
          </Link>
          <Link style={styles.linkSecondary} href="/audit">
            Audit Log (placeholder)
          </Link>
          <Link style={styles.link} href="/inventory/snapshot">
            Inventory Snapshot
          </Link>
          <Link style={styles.link} href="/inventory/movements">
            Inventory Movements
          </Link>
          <Link style={styles.link} href="/inventory/item">
            Item Drill-Down
          </Link>
        </div>
      </section>

      <section style={styles.card}>
        <div style={styles.cardTitle}>Notes</div>
        <ul style={styles.ul}>
          <li>Read-only UI.</li>
          <li>Ledger remains the only write path.</li>
          <li>Inventory reads are ledger-derived.</li>
          <li>Use <code>dev_token</code> for tenant scoping (no login UI).</li>
          <li>Audit Log UI is a placeholder until a read endpoint exists.</li>
        </ul>
      </section>
    </main>
  );
}

const styles = {
  shell: {
    minHeight: "100vh",
    background: "#0b0f14",
    color: "#e6edf3",
    padding: 24
  },
  header: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 18 },
  brand: { fontSize: 24, fontWeight: 700 },
  sub: { fontSize: 14, opacity: 0.8 },
  card: {
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    background: "rgba(255,255,255,0.02)"
  },
  cardTitle: { fontSize: 14, fontWeight: 700, marginBottom: 10, opacity: 0.9 },
  links: { display: "flex", gap: 12, flexWrap: "wrap" },
  link: {
    display: "inline-block",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    color: "#e6edf3",
    textDecoration: "none",
    background: "rgba(255,255,255,0.03)"
  },
  linkSecondary: {
    display: "inline-block",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px dashed rgba(255,255,255,0.18)",
    color: "#e6edf3",
    textDecoration: "none",
    background: "rgba(255,255,255,0.01)",
    opacity: 0.85
  },
  ul: { margin: 0, paddingLeft: 18, opacity: 0.85 }
};
