"use client";

import { useEffect, useMemo, useState } from "react";

export const runtime = "edge";

/**
 * CompactBar
 * - Small horizontal bar used across admin views.
 * - Deterministic: no intervals/timers.
 * - Includes a shared density toggle hook for list views.
 */

const DENSITY_KEY = "asora_ui:dense";

export function useDensity(defaultDense = true) {
  const [dense, setDense] = useState(defaultDense);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DENSITY_KEY);
      if (raw === "0") setDense(false);
      if (raw === "1") setDense(true);
    } catch {
      // ignore
    }
  }, []);

  function setDensePersist(v) {
    const b = Boolean(v);
    setDense(b);
    try {
      localStorage.setItem(DENSITY_KEY, b ? "1" : "0");
    } catch {
      // ignore
    }
  }

  return useMemo(() => [dense, setDensePersist], [dense]);
}

export default function CompactBar({ title, left, right }) {
  return (
    <div style={styles.shell}>
      <div style={styles.left}>
        {title ? <div style={styles.title}>{title}</div> : null}
        {left ? <div style={styles.leftExtras}>{left}</div> : null}
      </div>
      <div style={styles.right}>{right}</div>
    </div>
  );
}

const styles = {
  shell: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.02)",
    marginBottom: 12,
  },
  left: { display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 },
  title: { fontSize: 13, fontWeight: 800, opacity: 0.9, whiteSpace: "nowrap" },
  leftExtras: { display: "flex", alignItems: "center", gap: 10, minWidth: 0 },
  right: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
};
