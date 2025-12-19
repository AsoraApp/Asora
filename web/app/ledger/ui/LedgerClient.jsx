"use client";

import { useEffect, useMemo, useState } from "react";
import { asoraGetJson } from "@/lib/asoraFetch";

const DEFAULT_DEV_TOKEN = "tenant:demo";

export default function LedgerClient() {
  const [devToken, setDevToken] = useState(DEFAULT_DEV_TOKEN);
  const [eventType, setEventType] = useState("");
  const [itemId, setItemId] = useState("");
  const [order, setOrder] = useState("desc"); // deterministic UI order
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const query = useMemo(() => {
    // We do not assume backend supports filtering params.
    // We fetch all and filter client-side for U1 determinism.
    return { dev_token: devToken };
  }, [devToken]);

  async function load() {
    setLoading(true);
    try {
      const r = await asoraGetJson("/v1/ledger/events", query);
      setResult(r);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const events = useMemo(() => {
    const raw = result?.ok ? result?.data?.events : null;
    if (!Array.isArray(raw)) return [];

    let filtered = raw;

    if (eventType.trim()) {
      filtered = filtered.filter((e) => String(e?.eventType || "") === eventType.trim());
    }
    if (itemId.trim()) {
      filtered = filtered.filter((e) => String(e?.itemId || "") === itemId.trim());
    }

    // Deterministic ordering:
    // Prefer ts if present; otherwise fall back to ledgerEventId; otherwise stable JSON string.
    const withKey = filtered.map((e, idx) => {
      const ts = e?.ts ? String(e.ts) : "";
      const id = e?.ledgerEventId ? String(e.ledgerEventId) : "";
      const key = ts || id || JSON.stringify(e) || String(idx);
      return { e, key, idx };
    });

    withKey.sort((a, b) => {
      if (a.key < b.key) return -1;
      if (a.key > b.key) return 1;
      return a.idx - b.idx;
    });

    if (order === "desc") withKey.reverse();

    return withKey.map((x) => x.e);
  }, [result, eventType, itemId, order]);

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
          <div style={styles.label}>Filter: eventType</div>
          <input
            style={styles.input}
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            placeholder="ITEM_CREATED"
            spellCheck={false}
          />
        </div>

        <div style={styles.field}>
          <div style={styles.label}>Filter: itemId</div>
          <input
            style={styles.input}
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
            placeholder="item_test_001"
            spellCheck={false}
          />
        </div>

        <div style={styles.field}>
          <div style={styles.label}>Order</div>
          <select style={styles.select} value={order} onChange={(e) => setOrder(e.target.value)}>
            <option value="desc">Newest first (desc)</option>
            <option value="asc">Oldest first (asc)</option>
          </select>
        </div>

        <div style={styles.row}>
          <button style={styles.button} onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        <div style={styles.hint}>
          The UI fetches all events (tenant-scoped by dev_token) and filters client-side for U1.
        </div>
      </div>

      <div style={styles.panel}>
        <div style={styles.panelTitle}>Results</div>

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
              <b>Count:</b> {events.length}
            </div>
            {result?.ok ? (
              <div style={{ opacity: 0.8 }}>
                <b>Source:</b> <span style={styles.mono}>{result.url}</span>
              </div>
            ) : null}
          </div>
        ) : null}

        <div style={styles.list}>
          {events.map((e, i) => {
            const ts = e?.ts ? String(e.ts) : "";
            const et = e?.eventType ? String(e.eventType) : "";
            const iid = e?.itemId ? String(e.itemId) : "";
            const qd = e?.qtyDelta !== undefined ? String(e.qtyDelta) : "";

            return (
              <details key={`${i}-${ts}-${et}-${iid}`} style={styles.item}>
                <summary style={styles.summary}>
                  <span style={styles.badge}>{et || "UNKNOWN_EVENT"}</span>
                  <span style={styles.monoSmall}>{iid ? `itemId=${iid}` : ""}</span>
                  <span style={styles.monoSmall}>{qd ? `qtyDelta=${qd}` : ""}</span>
                  <span style={styles.monoSmall}>{ts ? `ts=${ts}` : ""}</span>
                </summary>
                <pre style={styles.pre}>{safeStringify(e)}</pre>
              </details>
            );
          })}
        </div>
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
  select: {
    padding: "10px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.25)",
    color: "#e6edf3",
    outline: "none"
  },
  row: { display: "flex", gap: 10, alignItems: "center" },
  button: {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "#e6edf3",
    cursor: "pointer"
  },
  hint: { marginTop: 10, fontSize: 12, opacity: 0.75, lineHeight: 1.35 },
  meta: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 10, fontSize: 13 },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },
  monoSmall: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: 12,
    opacity: 0.85
  },
  list: { display: "flex", flexDirection: "column", gap: 10 },
  item: {
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 12,
    padding: 10,
    background: "rgba(0,0,0,0.18)"
  },
  summary: { cursor: "pointer", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
  badge: {
    display: "inline-block",
    padding: "4px 8px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(255,255,255,0.05)",
    fontSize: 12,
    fontWeight: 700
  },
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
