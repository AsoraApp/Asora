"use client";

import Link from "next/link";
import { useMemo } from "react";
import { getStoredDevToken } from "@/lib/asoraFetch";
import { useDensity } from "./CompactBar.jsx";

export const runtime = "edge";

export default function AdminHeader({ title = "Asora Admin", subtitle = "" }) {
  const devToken = useMemo(() => getStoredDevToken(), []);
  const missingToken = !devToken;

  const [dense, setDense] = useDensity(true);

  return (
    <header style={styles.shell}>
      <div style={styles.left}>
        <div style={styles.brandRow}>
          <div style={styles.brand}>Asora</div>
          <span style={styles.dot}>·</span>
          <div style={styles.title}>{title}</div>
          {subtitle ? (
            <>
              <span style={styles.dot}>·</span>
              <div style={styles.sub}>{subtitle}</div>
            </>
          ) : null}
        </div>

        <nav style={styles.nav}>
          <Link href="/" style={styles.navLink}>
            Home
          </Link>
          <Link href="/ledger" style={styles.navLink}>
            Ledger
          </Link>
          <Link href="/inventory/items" style={styles.navLink}>
            Items
          </Link>
          <Link href="/inventory/snapshot" style={styles.navLink}>
            Snapshot
          </Link>
          <Link href="/inventory/movements" style={styles.navLink}>
            Movements
          </Link>
          <Link href="/inventory/anomalies" style={styles.navLink}>
            Anomalies
          </Link>
          <Link href="/inventory/reconciliation" style={styles.navLink}>
            Reconciliation
          </Link>
        </nav>
      </div>

      <div style={styles.right}>
        <div style={{ ...styles.pill, ...(missingToken ? styles.pillWarn : styles.pillOk) }}>
          <span style={styles.pillLabel}>dev_token</span>
          <span style={styles.pillValue}>{missingToken ? "missing" : "active"}</span>
        </div>

        <label style={styles.toggleRow} title="Persisted per-tab density preference">
          <input type="checkbox" checked={dense} onChange={(e) => setDense(e.target.checked)} />
          <span style={styles.toggleText}>Dense</span>
        </label>
      </div>
    </header>
  );
}

const styles = {
  shell: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 14,
    padding: "14px 16px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.02)",
    marginBottom: 14,
  },
  left: { display: "flex", flexDirection: "column", gap: 10, minWidth: 0 },
  brandRow: { display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" },
  brand: { fontSize: 14, fontWeight: 900, letterSpacing: 0.2, opacity: 0.95 },
  title: { fontSize: 13, fontWeight: 800, opacity: 0.9 },
  sub: { fontSize: 12, opacity: 0.75 },
  dot: { opacity: 0.35 },

  nav: { display: "flex", gap: 10, flexWrap: "wrap" },
  navLink: {
    fontSize: 12,
    opacity: 0.85,
    textDecoration: "none",
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.18)",
    padding: "6px 10px",
    borderRadius: 999,
  },

  right: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" },

  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    padding: "6px 10px",
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.18)",
  },
  pillOk: { borderColor: "rgba(100,220,160,0.35)", background: "rgba(100,220,160,0.08)" },
  pillWarn: { borderColor: "rgba(255,200,80,0.35)", background: "rgba(255,200,80,0.08)" },
  pillLabel: { fontSize: 11, opacity: 0.8 },
  pillValue: { fontSize: 11, fontWeight: 800, opacity: 0.95 },

  toggleRow: { display: "flex", alignItems: "center", gap: 8 },
  toggleText: { fontSize: 12, opacity: 0.85 },
};
