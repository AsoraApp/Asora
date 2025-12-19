// web/app/_ui/LedgerFreshnessBar.jsx
"use client";

import { useMemo } from "react";
import { useDensity } from "./CompactBar.jsx";

export const runtime = "edge";

/**
 * Unified cache / freshness indicator for U6–U8 derived views.
 *
 * Contract:
 * - Read-only UI
 * - No timers
 * - No side effects
 * - Parent owns state + actions
 *
 * Props:
 *  - lastFetchedUtc: string (ISO) | ""
 *  - cacheStatus: "cached" | "fresh" | "unknown"
 *  - busy: boolean
 *  - onRefreshCached(): void
 *  - onRefreshForce(): void
 *  - onClearCache(): void
 */

function labelForStatus(status) {
  if (status === "fresh") return { text: "fresh", color: "ok" };
  if (status === "cached") return { text: "cached", color: "warn" };
  return { text: "unknown", color: "muted" };
}

export default function LedgerFreshnessBar({
  lastFetchedUtc,
  cacheStatus,
  busy,
  onRefreshCached,
  onRefreshForce,
  onClearCache,
}) {
  const { isCompact } = useDensity();
  const s = isCompact ? compact : styles;

  const status = useMemo(() => labelForStatus(cacheStatus), [cacheStatus]);

  return (
    <div style={s.shell}>
      <div style={s.left}>
        <div style={s.row}>
          <span style={s.label}>Data freshness</span>
          <span style={s.sep}>•</span>
          <span style={{ ...s.badge, ...badgeStyle(status.color) }}>{status.text}</span>
        </div>

        <div style={s.row}>
          <span style={s.label}>Last fetched (UTC)</span>
          <span style={s.mono}>{lastFetchedUtc || "—"}</span>
        </div>
      </div>

      <div style={s.right}>
        <button style={s.btn} onClick={onRefreshCached} disabled={busy}>
          Refresh
        </button>
        <button style={s.btnSecondary} onClick={onRefreshForce} disabled={busy}>
          Force refresh
        </button>
        <button style={s.btnMuted} onClick={onClearCache} disabled={busy}>
          Clear cache
        </button>
      </div>
    </div>
  );
}

function badgeStyle(kind) {
  if (kind === "ok") {
    return {
      background: "rgba(100,220,160,0.20)",
      borderColor: "rgba(100,220,160,0.55)",
      color: "rgba(100,220,160,0.95)",
    };
  }
  if (kind === "warn") {
    return {
      background: "rgba(255,200,80,0.20)",
      borderColor: "rgba(255,200,80,0.55)",
      color: "rgba(255,200,80,0.95)",
    };
  }
  return {
    background: "rgba(255,255,255,0.10)",
    borderColor: "rgba(255,255,255,0.25)",
    color: "rgba(255,255,255,0.85)",
  };
}

const styles = {
  shell: {
    display: "flex",
    justifyContent: "space-between",
    gap: 14,
    flexWrap: "wrap",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(0,0,0,0.18)",
  },

  left: { display: "flex", flexDirection: "column", gap: 6 },
  right: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },

  row: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  sep: { opacity: 0.5 },

  label: { fontSize: 11, fontWeight: 800, opacity: 0.75 },
  mono: {
    fontSize: 12,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    opacity: 0.9,
  },

  badge: {
    padding: "2px 8px",
    borderRadius: 999,
    border: "1px solid",
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: 0.2,
  },

  btn: {
    padding: "6px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "#e6edf3",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 800,
  },
  btnSecondary: {
    padding: "6px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.18)",
    color: "#e6edf3",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 800,
  },
  btnMuted: {
    padding: "6px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.30)",
    color: "#e6edf3",
    cursor: "pointer",
    fontSize: 12,
    opacity: 0.9,
    fontWeight: 800,
  },
};

const compact = {
  ...styles,
  shell: { ...styles.shell, padding: "8px 10px" },
  btn: { ...styles.btn, padding: "5px 8px", fontSize: 11 },
  btnSecondary: { ...styles.btnSecondary, padding: "5px 8px", fontSize: 11 },
  btnMuted: { ...styles.btnMuted, padding: "5px 8px", fontSize: 11 },
  mono: { ...styles.mono, fontSize: 11 },
};
