"use client";

import Link from "next/link";

export default function AdminHeader({ title, subtitle, tenantId, build, freshnessBar }) {
  return (
    <header style={styles.header}>
      <div style={styles.top}>
        <div>
          <div style={styles.title}>{title}</div>
          {subtitle ? <div style={styles.sub}>{subtitle}</div> : null}
        </div>

        <div style={styles.meta}>
          <div style={styles.metaRow}>
            <span style={styles.metaLabel}>Tenant</span>
            <span style={styles.metaValue}>{tenantId || "—"}</span>
          </div>
          {build ? (
            <div style={styles.metaRow}>
              <span style={styles.metaLabel}>Build</span>
              <span style={styles.metaValue}>{build}</span>
            </div>
          ) : null}
        </div>
      </div>

      <nav style={styles.nav}>
        <NavLink href="/ledger">/ledger</NavLink>
        <NavLink href="/inventory/items">/inventory/items</NavLink>
        <NavLink href="/inventory/snapshot">/inventory/snapshot</NavLink>
        <NavLink href="/inventory/movements">/inventory/movements</NavLink>
        <NavLink href="/inventory/reconciliation">/inventory/reconciliation</NavLink>
        <NavLink href="/inventory/anomalies">/inventory/anomalies</NavLink>
        <NavLink href="/inventory/exports">/inventory/exports</NavLink>
      </nav>

      {freshnessBar ? <div style={styles.freshness}>{freshnessBar}</div> : null}
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
    borderBottom: "1px solid rgba(0,0,0,0.08)",
    paddingBottom: 12,
    marginBottom: 14,
  },
  top: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    alignItems: "flex-start",
  },
  title: { fontSize: 20, fontWeight: 800 },
  sub: { marginTop: 4, fontSize: 12, opacity: 0.8, lineHeight: 1.35 },
  meta: { textAlign: "right", fontSize: 12, opacity: 0.9 },
  metaRow: { display: "flex", gap: 8, justifyContent: "flex-end" },
  metaLabel: { opacity: 0.7 },
  metaValue: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },

  nav: { display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 },
  link: {
    textDecoration: "none",
    fontSize: 13,
    padding: "6px 8px",
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.10)",
    color: "inherit",
  },
  freshness: { marginTop: 10 },
};
