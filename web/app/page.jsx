// web/app/page.jsx
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
          <Link style={styles.link} href="/inventory/snapshot">
            Inventory Snapshot
          </Link>
          <Link style={styles.link} href="/inventory/movements">
            Inventory Movements
          </Link>
          <Link style={styles.link} href="/inventory/item">
            Item Drill-Down
          </Link>
          <Link style={styles.link} href="/inventory/reconciliation">
            Inventory Reconciliation
          </Link>
          <Link style={styles.link} href="/inventory/anomalies">
            Inventory Anomalies
          </Link>
          <Link style={styles.link} href="/inventory/exports">
            Integrity Exports (Evidence)
          </Link>
          <Link style={styles.linkSecondary} href="/audit">
            Audit Log (placeholder)
          </Link>
        </div>
      </section>

      <section style={styles.card}>
        <div style={styles.cardTitle}>Notes</div>
        <ul style={styles.ul}>
          <li>Read-only UI.</li>
          <li>Ledger remains the only write path.</li>
          <li>Use dev_token for now (no login UI).</li>
          <li>All derived views are deterministic and client-generated.</li>
        </ul>
      </section>
    </main>
  );
}

const styles = {
  shell: {
    minHeight: "100vh",
    padding: "24px",
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"',
    background: "#0b1220",
    color: "#e5e7eb",
  },
  header: {
    maxWidth: "1100px",
    margin: "0 auto 16px auto",
    padding: "16px",
    borderRadius: "14px",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
  },
  brand: { fontSize: "20px", fontWeight: 800, letterSpacing: "0.3px" },
  sub: { fontSize: "13px", opacity: 0.8, marginTop: "6px" },

  card: {
    maxWidth: "1100px",
    margin: "0 auto 16px auto",
    padding: "16px",
    borderRadius: "14px",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
  },
  cardTitle: { fontSize: "14px", fontWeight: 700, marginBottom: "10px" },
  links: { display: "flex", flexWrap: "wrap", gap: "10px" },
  link: {
    padding: "8px 10px",
    borderRadius: "10px",
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    color: "#e5e7eb",
    textDecoration: "none",
    fontSize: "13px",
  },
  linkSecondary: {
    padding: "8px 10px",
    borderRadius: "10px",
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.02)",
    color: "#e5e7eb",
    textDecoration: "none",
    fontSize: "13px",
    opacity: 0.9,
  },
  ul: {
    margin: 0,
    paddingLeft: "18px",
    lineHeight: 1.6,
    opacity: 0.9,
    fontSize: "13px",
  },
};
