"use client";

import { useEffect, useMemo, useState } from "react";
import { getStoredDevToken, setStoredDevToken } from "@/lib/asoraFetch";

export default function DevTokenBar() {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    const t = getStoredDevToken();
    setValue(t || "");
    setSaved(t || "");
  }, []);

  const statusLabel = useMemo(() => {
    if (!saved) return "No dev_token set";
    return "dev_token set";
  }, [saved]);

  function onSave() {
    const t = (value || "").trim();
    setStoredDevToken(t);
    setSaved(t);
    setValue(t);
  }

  function onClear() {
    setStoredDevToken("");
    setSaved("");
    setValue("");
  }

  function onUseDemo() {
    const t = "tenant:demo";
    setStoredDevToken(t);
    setSaved(t);
    setValue(t);
  }

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        borderBottom: "1px solid rgba(0,0,0,0.12)",
        background: "white"
      }}
    >
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "10px 16px",
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap"
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>Dev Token</div>
          <div style={{ fontSize: 12, opacity: 0.75 }}>{statusLabel}</div>
        </div>

        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder='e.g. "tenant:demo"'
          style={{
            flex: "1 1 320px",
            minWidth: 260,
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid rgba(0,0,0,0.25)",
            fontSize: 14
          }}
          aria-label="dev_token input"
        />

        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={onSave}
            style={buttonStyle}
            aria-label="save dev_token"
          >
            Save
          </button>

          <button
            type="button"
            onClick={onClear}
            style={buttonStyle}
            aria-label="clear dev_token"
          >
            Clear
          </button>

          <button
            type="button"
            onClick={onUseDemo}
            style={buttonStyle}
            aria-label="use tenant:demo"
          >
            Use demo
          </button>
        </div>

        <div style={{ fontSize: 12, opacity: 0.75 }}>
          Applied automatically to all GET requests as <code>dev_token</code>.
        </div>
      </div>
    </div>
  );
}

const buttonStyle = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid rgba(0,0,0,0.25)",
  background: "white",
  fontSize: 14,
  cursor: "pointer"
};
