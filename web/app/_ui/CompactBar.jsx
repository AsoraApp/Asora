"use client";

import { useEffect, useState } from "react";

export const runtime = "edge";

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

  return [dense, setDensePersist];
}

export default function CompactBar({ title, left, right }) {
  return (
    <div style={styles.shell}>
      <div style={styles.left}>
        {title ? <div style={styles.title}>{title}</div> : null}
        {left}
      </div>
      <div style={styles.right}>{right}</div>
    </div>
  );
}

const styles = {
  shell: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.02)",
    marginBottom: 12,
  },
  left: { display: "flex", gap: 10, alignItems: "center" },
  title: { fontSize: 13, fontWeight: 800 },
  right: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
};
