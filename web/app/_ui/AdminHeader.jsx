// web/app/_ui/AdminHeader.jsx
"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { getStoredDevToken, setStoredDevToken } from "@/lib/asoraFetch";
import { useDensity } from "./CompactBar.jsx";

export const runtime = "edge";

/**
 * Standard header used across U4+ derived views.
 * - Read-only UI
 * - dev_token control (localStorage) for tenant scoping
 * - Deterministic rendering (no timers)
 */

function safeReadToken() {
  try {
    return getStoredDevToken() || "";
  } catch {
    return "";
  }
}

export default function AdminHeader({ title, subtitle, children }) {
  const { isCompact } = useDensity();
  const s = isCompact ? compact : styles;

  const initial = useMemo(() => safeReadToken(), []);
  const [token, setToken] = useState(initial);

  const active = (token || "").trim();

  function apply() {
    const v = (token || "").trim();
    try {
      setStoredDevToken(v);
    } catch {
      // ignore; fail-closed
    }
  }

  function clear() {
    setToken("");
    try {
      setStoredDevToken("");
    } catch {
      // ignore
    }
  }

  return (
    <header style={s.shell}>
      <div style={s.topRow}>
        <div style={s.left}>
          <div style={s.brandRow}>
            <div style={s.brand}>Asora</div>
            <div style={s.badge}>Read-only</div>
          </div>

          <div style={s.titleRow}>
            <div style={s.title}>{title || "Admin"}</div>
            {subtitle ? <div style={s.sub}>{subtitle}</div> : null}
          </div>
        </div>

        <div style={s.right}>
          <Link href="/" style={s.homeLink}>
            Home
          </Link>
        </div>
      </div>

      <div style={s.tokenCard}>
        <div style={s.tokenLeft}>
          <div style={s.tokenLabel}>Tenant (dev_token)</div>
          <input
            style={s.input}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="tenant:demo"
            spellCheck={false}
          />
          <div style={s.tokenHint}>
            Stored in localStorage. Used by asoraFetch to scope all requests. No login UI.
          </div>
        </div>

        <div style={s.tokenRight}>
          <button style={s.btnPrimary} onClick={apply}>
            Apply
          </button>
          <button style={s.btn} onClick={clear}>
            Clear
          </button>

          <div style={s.statusRow}>
            <span style={s.statusDot(active ? "ok" : "warn")} />
            <span style={s.statusText}>{active ? "active" : "not set"}</span>
          </div>
        </div>
      </div>

      {children ? <div style={s.children}>{children}</div> : null}
    </header>
  );
}

function dotColor(kind) {
  if (kind === "ok") return "rgba(100,220,160,0.95)";
  return "rgba(255,200,80,0.95)";
}

const styles = {
  shell: {
    maxWidth: 1200,
    margin: "0 auto 14px auto",
    padding: 16,
    borderRadius: 14,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.10)",
    color: "#e6edf3",
  },

  topRow: { display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap" },
  left: { display: "flex", flexDirection: "column", gap: 10, minWidth: 260 },
  right: { display: "flex", alignItems: "flex-start" },

  brandRow: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
  brand: { fontSize: 18, fontWeight: 900, letterSpacing: 0.2 },
  badge: {
    fontSize: 11,
    fontWeight: 800,
    padding: "3px 8px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.18)",
    opacity: 0.95,
  },

  titleRow: { display: "flex", flexDirection: "column", gap: 6 },
  title: { fontSize: 16, fontWeight: 900 },
  sub: { fontSize: 12, opacity: 0.8, lineHeight: 1.35, maxWidth: 860 },

  homeLink: {
    color: "#e6edf3",
    textDecoration: "none",
    border: "1px solid rgba(255,255,255,0.14)",
    padding: "8px 10px",
    borderRadius: 10,
    background: "rgba(0,0,0,0.18)",
    fontSize: 13,
  },

  tokenCard: {
    marginTop: 14,
    display: "flex",
    justifyContent: "space-between",
    gap: 14,
    flexWrap: "wrap",
    padding: 14,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(0,0,0,0.18)",
  },
  tokenLeft: { display: "flex", flexDirection: "column", gap: 8, flex: "1 1 520px" },
  tokenRight: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },

  tokenLabel: { fontSize: 11, opacity: 0.75, fontWeight: 800 },
  tokenHint: { fontSize: 12, opacity: 0.7, lineHeight: 1.35 },

  input: {
    width: "100%",
    maxWidth: 520,
    padding: "10px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.25)",
    color: "#e6edf3",
    outline: "none",
    fontSize: 13,
  },

  btnPrimary: {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(99,102,241,0.35)",
    color: "#e6edf3",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 13,
  },
  btn: {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "#e6edf3",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 13,
  },

  statusRow: { display: "inline-flex", gap: 8, alignItems: "center", marginLeft: 6 },
  statusDot: (kind) => ({
    width: 10,
    height: 10,
    borderRadius: 999,
    background: dotColor(kind),
    boxShadow: `0 0 0 3px ${dotColor(kind).replace("0.95", "0.12")}`,
  }),
  statusText: { fontSize: 12, opacity: 0.85, fontWeight: 800 },

  children: { marginTop: 12 },
};

const compact = {
  ...styles,
  shell: { ...styles.shell, padding: 12, margin: "0 auto 12px auto" },
  title: { ...styles.title, fontSize: 15 },
  sub: { ...styles.sub, fontSize: 12 },
  tokenCard: { ...styles.tokenCard, padding: 12 },
  btnPrimary: { ...styles.btnPrimary, padding: "8px 10px", fontSize: 12 },
  btn: { ...styles.btn, padding: "8px 10px", fontSize: 12 },
  homeLink: { ...styles.homeLink, padding: "7px 9px", fontSize: 12 },
};
