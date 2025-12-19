import Link from "next/link";
import ItemsClient from "./ui/ItemsClient";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default function InventoryItemsPage() {
  return (
    <main style={styles.shell}>
      <header style={styles.header}>
        <div style={styles.row}>
          <Link href="/" style={styles.back}>
            ← Home
          </Link>
          <div style={styles.title}>Inventory Items</div>
        </div>
        <div style={styles.sub}>
          Read-only. Fetches <code style={styles.code}>GET /v1/inventory/items</code> using dev_token.
        </div>
      </header>

      <ItemsClient />
    </main>
  );
}

const styles = {
  shell: { minHeight: "100vh", background: "#0b0f14", color: "#e6edf3", padding: 24 },
  header: { display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 },
  row: { display: "flex", alignItems: "center", gap: 12 },
  back: {
    color: "#e6edf3",
    textDecoration: "none",
    border: "1px solid rgba(255,255,255,0.14)",
    padding: "8px 10px",
    borderRadius: 10,
    background: "rgba(255,255,255,0.03)"
  },
  title: { fontSize: 20, fontWeight: 700 },
  sub: { opacity: 0.8, fontSize: 13, lineHeight: 1.4 },
  code: { background: "rgba(255,255,255,0.06)", padding: "2px 6px", borderRadius: 8 }
};
