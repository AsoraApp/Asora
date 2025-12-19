"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * SavedViewsBar
 * - localStorage-only named presets
 * - deterministic ordering: name asc (case-insensitive), then original name
 * - read-only: no backend calls
 *
 * Props:
 * - storageKey: string (required)
 * - valueLabel: string (optional, e.g. "itemId")
 * - currentValue: string (required)
 * - onApply: (value: string) => void (required)
 */
export default function SavedViewsBar({ storageKey, valueLabel = "value", currentValue, onApply }) {
  const [hydrated, setHydrated] = useState(false);
  const [err, setErr] = useState("");
  const [name, setName] = useState("");
  const [views, setViews] = useState([]);

  function read() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // Normalize shape defensively.
      return parsed
        .map((v) => ({
          name: typeof v?.name === "string" ? v.name : "",
          value: typeof v?.value === "string" ? v.value : "",
        }))
        .filter((v) => v.name.trim() && v.value.trim());
    } catch {
      return [];
    }
  }

  function write(next) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    setViews(read());
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sortedViews = useMemo(() => {
    const list = Array.isArray(views) ? views : [];
    return [...list].sort((a, b) => {
      const an = (a?.name || "").toLowerCase();
      const bn = (b?.name || "").toLowerCase();
      if (an < bn) return -1;
      if (an > bn) return 1;
      return (a?.name || "").localeCompare(b?.name || "");
    });
  }, [views]);

  function saveCurrent() {
    setErr("");
    const n = name.trim();
    const v = (currentValue || "").trim();

    if (!hydrated) return;
    if (!n) return setErr("Name is required.");
    if (!v) return setErr(`Current ${valueLabel} is empty.`);

    const existing = read();

    // Upsert by exact name match (case-sensitive to avoid surprising merges).
    const next = existing.filter((x) => x.name !== n).concat([{ name: n, value: v }]);

    // Deterministic storage ordering: store sorted by name
    const nextSorted = [...next].sort((a, b) => {
      const an = (a?.name || "").toLowerCase();
      const bn = (b?.name || "").toLowerCase();
      if (an < bn) return -1;
      if (an > bn) return 1;
      return (a?.name || "").localeCompare(b?.name || "");
    });

    write(nextSorted);
    setViews(nextSorted);
    setName("");
  }

  function removeByName(n) {
    setErr("");
    if (!hydrated) return;

    const existing = read();
    const next = existing.filter((x) => x.name !== n);

    write(next);
    setViews(next);
  }

  return (
    <div
      style={{
        border: "1px solid #e5e5e5",
        borderRadius: 12,
        padding: 12,
        background: "#fff",
        width: "100%",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Saved Views</div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Boiler Parts"
            style={{
              width: 240,
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid #ccc",
              outline: "none",
              fontSize: 13,
            }}
            disabled={!hydrated}
          />
        </label>

        <button
          onClick={saveCurrent}
          disabled={!hydrated}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid #111",
            background: "#111",
            color: "#fff",
            cursor: hydrated ? "pointer" : "not-allowed",
            fontSize: 13,
            height: 34,
          }}
          title={`Save current ${valueLabel} as a named preset`}
        >
          Save current
        </button>

        <div style={{ fontSize: 13, color: "#444", paddingBottom: 2 }}>
          Current {valueLabel}:{" "}
          <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
            {(currentValue || "").trim() || "—"}
          </span>
        </div>
      </div>

      {err ? <div style={{ marginTop: 10, color: "#b00020", fontSize: 13 }}>Error: {err}</div> : null}

      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {sortedViews.length === 0 ? (
          <div style={{ fontSize: 13, color: "#666" }}>No saved views yet.</div>
        ) : (
          sortedViews.map((v) => {
            const n = v.name;
            const val = v.value;

            return (
              <div
                key={n}
                style={{
                  border: "1px solid #eee",
                  borderRadius: 12,
                  padding: "8px 10px",
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  background: "#fafafa",
                }}
              >
                <button
                  type="button"
                  onClick={() => onApply(val)}
                  disabled={!hydrated}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 10,
                    border: "1px solid #bbb",
                    background: "#fff",
                    cursor: hydrated ? "pointer" : "not-allowed",
                    fontSize: 13,
                  }}
                  title={`Apply ${valueLabel}=${val}`}
                >
                  {n}
                </button>

                <div style={{ fontSize: 12, color: "#555" }}>
                  {valueLabel}:{" "}
                  <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
                    {val}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => removeByName(n)}
                  disabled={!hydrated}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 10,
                    border: "1px solid #bbb",
                    background: "#f7f7f7",
                    cursor: hydrated ? "pointer" : "not-allowed",
                    fontSize: 13,
                  }}
                  title="Delete preset"
                >
                  Delete
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
