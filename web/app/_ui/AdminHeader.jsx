"use client";

import { useMemo } from "react";
import Link from "next/link";
import { getStoredDevToken } from "@/lib/asoraFetch";
import CompactBar, { useDensity } from "./CompactBar.jsx";

export const runtime = "edge";

export default function AdminHeader({
  title,
  subtitle = null,
  freshnessSlot = null,
  backHref = "/",
}) {
  const devToken = useMemo(() => getStoredDevToken(), []);
  const { dense } = useDensity(true);

  return (
    <header style={styles.wrap}>
      <CompactBar
        title={title}
        right={freshnessSlot}
      />

      <div style={styles.row}>
        <Link href={backHref} style={styles.back}>
          ← Home
        </Link>
        <div style={styles.title}>{title}</div>
      </div>

      {subtitle ? <div style={styles.sub}>{subtitle}</div> : null}

      <div style={styles.meta}>
        <span style={styles.k}>dev_token</span>
        <span style={styles.v}>{devToken || "(not set)"}</span>
        <span style={styles.dot}>·</span>
        <span style={styles.k}>density</span>
        <span style={styles.v}>{dense ? "compact" : "comfortable"}</span>
      </div>
    </header>
  );
}

const styles = {
  wrap: {
    marginBottom: 14,
    paddingBottom: 10,
    borderBottom: "1px solid rgba(255,255,255,0.08)",
  },
  row: { display: "flex", alignItems: "center", gap: 12, marginTop: 10 },
  back: {
    color: "#e6edf3",
    textDecoration: "none",
    border: "1px solid rgba(255,255,255,0.14)",
    padding: "6px 10px",
    borderRadius: 10,
    background: "rgba(255,255,255,0.03)",
    fontSize: 13,
  },
  title: { fontSize: 20, fontWeight: 800 },
  sub: { marginTop: 6, fontSize: 13, opacity: 0.85, lineHeight: 1.4 },
  meta: {
    marginTop: 6,
    fontSize: 12,
    opacity: 0.75,
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
  },
  k: { opacity: 0.7 },
  v: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
  dot: { opacity: 0.5 },
};
