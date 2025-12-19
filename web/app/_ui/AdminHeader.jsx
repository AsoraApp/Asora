// web/app/_ui/AdminHeader.jsx
"use client";

import Link from "next/link";
import { useMemo } from "react";
import { getStoredDevToken } from "@/lib/asoraFetch";
import { useDensity } from "./CompactBar.jsx";

export const runtime = "edge";

/**
 * U8 — Shared admin header + unified primary nav.
 *
 * Rules:
 * - UI-only, read-only
 * - Tenant scope indicator is dev_token from localStorage (read-only)
 * - Build stamp is optional (caller passes string if available)
 * - “Freshness row” is optional (caller passes a ReactNode)
 *
 * Props:
 *  - title: string
 *  - subtitle?: string | ReactNode
 *  - buildStamp?: string
 *  - rightSlot?: ReactNode (optional, for page-specific controls)
 *  - freshnessSlot?: ReactNode (optional, e.g., <LedgerFreshnessBar ... />)
 */

const NAV = [
  { href: "/ledger", label: "Ledger" },
  { href: "/inventory/items", label: "Items" },
  { href: "/inventory/snapshot", label: "Snapshot" },
  { href: "/inventory/movements", label: "Movements" },
  { href: "/inventory/reconciliation", label: "Reconciliation" },
  { href: "/inventory/anomalies", label: "Anomalies" },
  { href: "/inventory/exports", label: "Exports" },
];

export default function AdminHeader({ title, subtitle, buildStamp, rightSlot, freshnessSlot }) {
  const { isCompact } = useDensity();
  const s = isCompact ? compact : styles;

  const devToken = useMemo(() => getStoredDevToken(), []);
  const tenantLabel = devToken || "(none)";

  return (
    <header style={s.shell}>
      <div style={s.topRow}>
        <div style={s.brandCol}>
          <div style={s.brand}>Asora</div>
          <div style={s.titleRow}>
            <div style={s.title}>{String(title || "")}</div>
            {buildStamp ? <div style={s.buildPill}>build: {String(buildStamp)}</div> : null}
          </div>

          {subtitle ? <div style={s.subtitle}>{subtitle}</div> : null}

          <div style={s.tenantRow}>
            <span style={s.tenantLabel}>Tenant (dev_token)</span>
            <span style={s.tenantValue}>{tenantLabel}</span>
          </div>
        </div>

        <div style={s.rightCol}>{rightSlot || null}</div>
      </div>

      <nav style={s.nav}>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} style={s.navLink}>
            {n.label}
          </Link>
        ))}
      </nav>

      {freshnessSlot ? <div style={s.freshness}>{freshnessSlot}</div> : null}
    </header>
  );
}

const styles = {
  shell: {
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    padding: 14,
    marginBottom: 14,
    color: "#e6edf3",
  },

  topRow: { display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap", alignItems: "flex-start" },

  brandCol: { display: "flex", flexDirection: "column", gap: 8, minWidth: 280, flex: "1 1 auto" },
  rightCol: { display: "flex", alignItems: "flex-start", justifyContent: "flex-end", flex: "0 0 auto" },

  brand: { fontSize: 16, fontWeight: 900, letterSpacing: 0.3, opacity: 0.95 },

  titleRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  title: { fontSize: 18, fontWeight: 900 },

  buildPill: {
    padding: "2px 8px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.18)",
    fontSize: 11,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    opacity: 0.9,
  },

  subtitle: { fontSize: 12, opacity: 0.8, lineHeight: 1.4 },

  tenantRow: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  tenantLabel: { fontSize: 11, fontWeight: 900, opacity: 0.7 },
  tenantValue: {
    fontSize: 12,
    padding: "2px 8px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.18)",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    opacity: 0.95,
  },

  nav: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    marginTop: 10,
    paddingTop: 10,
    borderTop: "1px solid rgba(255,255,255,0.08)",
  },
  navLink: {
    padding: "7px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.14)",
    color: "#e6edf3",
    textDecoration: "none",
    fontSize: 12,
    fontWeight: 800,
    opacity: 0.95,
  },

  freshness: { marginTop: 10 },
};

const compact = {
  ...styles,
  shell: { ...styles.shell, padding: 12, marginBottom: 12 },
  brand: { ...styles.brand, fontSize: 15 },
  title: { ...styles.title, fontSize: 16 },
  navLink: { ...styles.navLink, padding: "6px 9px", fontSize: 11 },
};
