// web/app/_ui/AdminHeader.jsx
"use client";

import Link from "next/link";
import { useMemo } from "react";
import { getStoredDevToken } from "@/lib/asoraFetch";

const NAV = [
  { href: "/ledger", label: "Ledger" },
  { href: "/inventory/items", label: "Items" },
  { href: "/inventory/snapshot", label: "Snapshot" },
  { href: "/inventory/movements", label: "Movements" },
  { href: "/inventory/reconciliation", label: "Reconciliation" },
  { href: "/inventory/anomalies", label: "Anomalies" },
  { href: "/inventory/exports", label: "Exports" },
];

export default function AdminHeader({
  title,
  subtitle,
  buildStamp = "",
  children,
}) {
  const devToken = useMemo(() => getStoredDevToken(), []);

  return (
    <header style={styles.wrap}>
      <div style={styles.topRow}>
        <div style={styles.left}>
          <div style={styles.titleRow}>
            <div style={styles.title}>{title || "Asora"}</div>
            {buildStamp ? <div style={styles.build}>{buildStamp}</div> : null}
          </div>
          {subtitle ? <div style={styles.sub}>{subtitle}</div> : null}
        </div>

        <div style={styles.right}>
          <div style={styles.tenantBox}>
            <div style={styles.tenantLabel}>Tenant (dev_token)</div>
            <div style={styles.tenantValue}>{devToken || "(none)"}</div>
          </div>
        </div>
      </div>

      <nav style={styles.nav}>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} style={styles.navLink}>
            {n.label}
          </Link>
        ))}
      </nav>

      {children ? <div style={styles.slot}>{children}</div> : null}
    </header>
  );
}

const styles = {
  wrap: {
    maxWidth: 1200,
    margin: "0 auto 14px auto",
    padding: 16,
    borderRadius: 14,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.10)",
    color: "#e6edf3",
  },
  topRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    alignItems: "flex-start",
  },
  left: { minWidth: 280, flex: "1 1 auto" },
  titleRow: { display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" },
  title: { fontSize: 18, fontWeight: 850, letterSpacing: 0.2 },
  build: {
    fontSize: 12,
    opacity: 0.85,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(0,0,0,0.18)",
    padding: "4px 8px",
    borderRadius: 999,
  },
  sub: { marginTop: 6, fontSize: 13, opacity: 0.82, lineHeight: 1.35 },

  right: { display: "flex", alignItems: "flex-start", justifyContent: "flex-end" },
  tenantBox: {
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(0,0,0,0.18)",
    padding: "8px 10px",
    borderRadius: 12,
    minWidth: 220,
  },
  tenantLabel: { fontSize: 11, opacity: 0.7, marginBottom: 4 },
  tenantValue: { fontSize: 13, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },

  nav: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    marginTop: 12,
    paddingTop: 12,
    borderTop: "1px solid rgba(255,255,255,0.08)",
  },
  navLink: {
    padding: "7px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.03)",
    color: "#e6edf3",
    textDecoration: "none",
    fontSize: 13,
  },
  slot: {
    marginTop: 12,
    paddingTop: 12,
    borderTop: "1px solid rgba(255,255,255,0.08)",
  },
};
