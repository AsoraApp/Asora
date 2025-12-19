"use client";

import { useEffect, useMemo, useState } from "react";
import { asoraGetJson } from "@/lib/asoraFetch";

const DEFAULT_DEV_TOKEN = "tenant:demo";

export default function ItemsClient() {
  const [devToken, setDevToken] = useState(DEFAULT_DEV_TOKEN);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const query = useMemo(() => ({ dev_token: devToken }), [devToken]);

  async function load() {
    setLoading(true);
    try {
      const r = await asoraGetJson("/v1/inventory/items", query);
      setResult(r);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = useMemo(() => {
    const raw = result?.ok ? result?.data?.items : null;
    if (!Array.isArray(raw)) return [];
    const q = search.trim().toLowerCase();
    if (!q) return raw;

    return raw.filter((it) => {
      const name = String(it?.name || "").toLowerCase();
      const sku = String(it?.sku || "").toLowerCase();
      const id = String(it?.itemId || it?.id || "").toLowerCase();
      return name.includes(q) || sku.includes(q) || id.includes(q);
    });
  }, [result, search]);

  const errorBox = !result
    ? null
    : result.ok
      ? null
      : {
          status: result.status,
          error: result.error,
          code: result.code,
          url: result.url,
          details: result.details
        };

  return (
    <section style={styles.grid}>
      <div style={styles.panel}>
        <div style={styles.panelTitle}>Controls</div>

        <div style={styles.field}>
          <div style={styles.label}>dev_token</div>
          <input
            style={styles.input}
            value={devToken}
            onChange={(e) => setDevToken(e.target.value)}
            placeholder="tenant:demo"
            spellCheck={false}
          />
        </div>

        <div style={styles.field}>
          <div style={styles.label}>Search (name / sku / id)</div>
          <input
            style={styles.input}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Test Item"
            spellCheck={false}
          />
        </div>

        <button style={styles.button} onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>

        <div style={styles.hint}>Read-only. No item creation endpoint exists. Items are ledger-derived.</div>
      </div>

      <div style={styles.panel}>
        <div style={styles.panelTitle}>Items</div>

        {errorBox ? (
          <div style={styles.error}>
            <div style={styles.errorTitle}>Fetch failed</div>
            <div style={styles.errorLine}>
              <b>Status:</b> {errorBox.status}
            </div>
            <div style={styles.errorLine}>
              <b>Error:</b> {errorBox.error} / {errorBox.code}
            </div>
            <div style={styles.errorLine}>
              <b>URL:</b> <span style={styles.mono}>{errorBox.url}</span>
            </div>
            <details style={styles.details}>
              <summary>details</summary>
              <pre style={styles.pre}>{safeStringify(errorBox.details)}</pre>
            </details>
          </div>
        ) : null}

        {!errorBox ? (
          <div style={styles.meta}>
            <div>
              <b>Count:</b> {items.length}
            </div>
            {result?.ok ? (
              <div style={{ opacity: 0.8 }}>
                <b>Source:</b> <span style={styles.mono}>{result.url}</span>
              </div>
            ) : null}
          </div>
        ) : null}

        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>itemId</th>
                <th style={styles.th}>name</th>
                <th style={styles.th}>sku</th>
                <th style={styles.th}>uom</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => {
                const itemId = it?.itemId || it?.id || "";
                return (
                  <tr key={`${itemId}-${idx}`}>
                    <td style={styles.tdMono}>{String(itemId)}</td>
                    <td style={styles.td}>{String(it?.name || "")}</td>
                    <td style={styles.tdMono}>{String(it?.sku || "")}</td>
                    <td style={styles.tdMono}>{String(it?.uom || "")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", opacity: 0.85 }}>Raw JSON</summary>
          <pre style={styles.pre}>{safeStringify(result?.ok ? result.data : result)}</pre>
        </details>
      </div>
    </section>
  );
}

function safeStringify(x) {
  try {
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x);
  }
}

const styles = {
  grid: { display: "grid", gridTemplateColumns: "360px 1fr", gap: 14, alignItems: "start" },
  panel: {
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 12,
    padding: 16,
    background: "rgba(255,255,255,0.02)"
  },
  panelTitle: { fontSize: 14, fontWeight: 700, marginBottom: 12, opacity: 0.9 },
  field: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 },
  label: { fontSize: 12, opacity: 0.8 },
  input: {
    padding: "10px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.25)",
    color: "#e6edf3",
    outline: "none"
  },
  button: {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "#e6edf3",
    cursor: "pointer",
    width: "fit-content"
  },
  hint: { marginTop: 10, fontSize: 12, opacity: 0.75, lineHeight: 1.35 },
  meta: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 10, fontSize: 13 },
  tableWrap: { overflowX: "auto", borderRadius: 12, border: "1px solid rgba(255,255,255,0.10)" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: {
    textAlign: "left",
    padding: "10px 10px",
    borderBottom: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.03)"
  },
  td: { padding: "10px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)" },
  tdMono: {
    padding: "10px 10px",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
  },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },
  pre: {
    margin: 0,
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    background: "rgba(0,0,0,0.35)",
    overflowX: "auto",
    fontSize: 12,
    lineHeight: 1.35
  },
  error: {
    border: "1px solid rgba(255,80,80,0.35)",
    background: "rgba(255,80,80,0.08)",
    padding: 12,
    borderRadius: 12,
    marginBottom: 10
  },
  errorTitle: { fontWeight: 800, marginBottom: 6 },
  errorLine: { fontSize: 13, marginBottom: 4 },
  details: { marginTop: 8 }
};
