"use client";

import Link from "next/link";

export default function AdminHeader({
  title,
  subtitle,
  tenantId,
  build,
  freshnessBar,
}) {
  return (
    <header style={styles.header}>
      <div style={styles.topRow}>
        <div>
          <div style={styles.title}>{title}</div>
          {subtitle && <div style={styles.subtitle}>{subtitle}</div>}
        </div>
        <div style={styles.meta}>
          {tenantId && <div style={styles.tenant}>Tenant: {tenantId}</div>}
          {build && <div style={styles.build}>Build: {build}</div>}
        </div>
      </div>

      <nav style={styles.nav}>
        <NavLink href="/ledger">Ledger</NavLink>
        <NavLink href="/inventory/items">Items</NavLink>
        <NavLink href="/inventory/snapshot">Snapshot</NavLink>
        <NavLink href="/inventory/movements">Movements</NavLink>
        <NavLink href="/inventory/reconciliation">Reconciliation</NavLink>
        <NavLink href="/inventory/anomalies">Anomalies</NavLink>
        <NavLink href="/inventory/exports">Exports</NavLink>
      </nav>

      {freshnessBar && <div style={styles.freshness}>{freshnessBar}</div>}
    </header>
  );
}

function NavLink({ href, children }) {
  return (
    <Link href={href} style={styles.link}>
      {children}
    </Link>
  );
}

const styles = {
  header: {
    borderBottom: "1px solid #e5e7eb",
    marginBottom: 16,
  },
  topRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  title: {
    fontSize: 20,
    fontWeight: 600,
  },
  subtitle: {
    fontSize: 12,
    color: "#6b7280",
  },
  meta: {
    textAlign: "right",
    fontSize: 12,
    color: "#374151",
  },
  tenant: {
    fontWeight: 500,
  },
  build: {
    color: "#6b7280",
  },
  nav: {
    display: "flex",
    gap: 16,
    marginTop: 12,
    flexWrap: "wrap",
  },
  link: {
    fontSize: 14,
    textDecoration: "none",
    color: "#111827",
  },
  freshness: {
    marginTop: 8,
  },
};
