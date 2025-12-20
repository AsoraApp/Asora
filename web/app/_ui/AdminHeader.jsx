"use client";

import { useMemo } from "react";
import Link from "next/link";
import { getStoredDevToken } from "@/lib/asoraFetch";

export default function AdminHeader({ title, subtitle, rightSlot }) {
  const devToken = useMemo(() => getStoredDevToken(), []);
  const hasToken = Boolean(devToken);

  return (
    <header style={styles.wrap}>
      <div style={styles.topRow}>
        <div style={styles.left}>
          <div style={styles.titleRow}>
            <Link href="/" style={styles.back}>← Home</Link>
            <div style={styles.title}>{title}</div>
          </div>
          {subtitle ? <div style={styles.sub}>{subtitle}</div> : null}
          <div style={styles.tokenRow}>
            <span style={{ ...styles.pill, ...(hasToken ? styles.pillOk : styles.pillWarn) }}>
              {hasToken ? "dev_token active" : "dev_token missing"}
            </span>
            <span style={styles.tokenText}>
              {hasToken ? devToken : "Set dev_token in the header bar."}
            </span>
          </div>
        </div>

        <div style={styles.right}>{rightSlot || null}</div>
      </div>
    </header>
  );
}

const styles = {
  wrap: { marginBottom: 14 },
  topRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" },
  left: { minWidth: 280, flex: "1 1 520px" },
  right: { flex: "0 0 auto" },

  titleRow: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" },
  back: {
    color: "#111",
    textDecoration: "none",
    border: "1px solid #ddd",
    padding: "8px 10px",
    borderRadius: 10,
    background: "#fff",
    fontSize: 13,
  },
  title: { fontSize: 22, fontWeight: 800 },
  sub: { marginTop: 6, color: "#555", fontSize: 13, lineHeight: 1.35 },

  tokenRow: { marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
  pill: { fontSize: 11, padding: "4px 8px", borderRadius: 999, border: "1px solid #ddd", background: "#fff" },
  pillOk: { borderColor: "rgba(0,120,60,0.35)", background: "rgba(0,120,60,0.06)" },
  pillWarn: { borderColor: "rgba(180,120,0,0.35)", background: "rgba(180,120,0,0.06)" },
  tokenText: { fontSize: 12, color: "#333", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },
};
