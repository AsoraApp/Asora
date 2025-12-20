"use client";

export { default, useDensity } from "../../_ui/CompactBar.jsx";

import Link from "next/link";
import { useEffect, useState } from "react";

export const runtime = "edge";

const KEY = "asora_ui_density"; // "compact" | "comfortable"

function getInitial() {
  if (typeof window === "undefined") return "comfortable";
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "compact" ? "compact" : "comfortable";
  } catch {
    return "comfortable";
  }
}

export function useDensity() {
  const [density, setDensity] = useState(getInitial());

  useEffect(() => {
    // keep in sync if multiple tabs flip it
    function onStorage(e) {
      if (e.key === KEY) setDensity(e.newValue === "compact" ? "compact" : "comfortable");
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function toggle() {
    const next = density === "compact" ? "comfortable" : "compact";
    setDensity(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // ignore
    }
  }

  return { density, isCompact: density === "compact", toggle };
}

export default function CompactBar({ here }) {
  const { isCompact, toggle } = useDensity();

  return (
    <header style={styles.topbar}>
      <div style={styles.brandRow}>
        <div style={styles.brand}>Asora</div>

        <div style={styles.nav}>
          <Link href="/" style={styles.navLink}>
            Home
          </Link>
          <span style={styles.navSep}>/</span>
          <Link href="/inventory/items" style={styles.navLink}>
            Inventory Items
          </Link>
          {here ? (
            <>
              <span style={styles.navSep}>/</span>
              <span style={styles.navHere}>{here}</span>
            </>
          ) : null}
        </div>

        <button style={styles.toggle} onClick={toggle} type="button" aria-label="Toggle compact density">
          Compact: <span style={styles.toggleVal}>{isCompact ? "On" : "Off"}</span>
        </button>
      </div>
    </header>
  );
}

const styles = {
  topbar: { marginBottom: 14 },
  brandRow: { display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 12 },
  brand: { fontSize: 16, fontWeight: 800, letterSpacing: 0.2 },
  nav: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  navLink: { color: "#0b57d0", textDecoration: "none", fontSize: 13 },
  navHere: { color: "#222", fontSize: 13, fontWeight: 700 },
  navSep: { color: "#999", fontSize: 13 },

  toggle: {
    padding: "6px 10px",
    borderRadius: 10,
    border: "1px solid #bbb",
    background: "#fff",
    cursor: "pointer",
    fontSize: 13,
    color: "#111",
  },
  toggleVal: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },
};
