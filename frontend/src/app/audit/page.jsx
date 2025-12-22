"use client";

import { useEffect, useMemo, useState } from "react";
import { asoraGetJson } from "@/lib/asoraFetch";

export const runtime = "edge";

const LIMIT_KEY = "asora_view:audit:limit";
const DEFAULT_LIMIT = 500;

function safeReadInt(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    if (v === null || v === undefined || v === "") return fallback;
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) return fallback;
    return n;
  } catch {
    return fallback;
  }
}

function safeWriteInt(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // no-op
  }
}

function fmtTs(ts) {
  const s = String(ts || "");
  if (!s) return "—";
  return s;
}

function clip(s, n) {
  const t = String(s || "");
  if (!t) return "—";
  if (t.length <= n) return t;
  return t.slice(0, n - 1) + "…";
}

export default function AuditPage() {
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [pageInfo, setPageInfo] = useState(null);

  const [err, setErr] = useState(null);
  const [selected, setSelected] = useState(null);

  const limitIsValid = useMemo(() => Number.isInteger(limit) && limit > 0 && limit <= 2000, [limit]);

  async function loadOnce(nextLimit) {
    const useLimit = Number(nextLimit);
    if (!Number.isInteger(useLimit) || useLimit <= 0 || useLimit > 2000) {
      setErr({
        ok: false,
        status: 400,
        code: "INVALID_LIMIT",
        error: "BAD_REQUEST",
        details: { limit: String(nextLimit) },
        requestId: null,
      });
      return;
    }

    setLoading(true);
    setErr(null);
    setSelected(null);

    try {
      const r = await asoraGetJson(`/api/audit/events?limit=${encodeURIComponent(String(useLimit))}`);
      const events = Array.isArray(r?.events) ? r.events : [];
      setRows(events);
      setPageInfo(r?.page || null);
      setLoading(false);
    } catch (e) {
      setRows([]);
      setPageInfo(null);
      setLoading(false);
      setErr(e || { ok: false, status: null, code: "HTTP_ERROR", error: "HTTP_ERROR", details: null, requestId: null });
    }
  }

  useEffect(() => {
    const initial = safeReadInt(LIMIT_KEY, DEFAULT_LIMIT);
    setLimit(initial);
    loadOnce(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onApplyLimit() {
    if (!limitIsValid) return;
    safeWriteInt(LIMIT_KEY, limit);
    loadOnce(limit);
  }

  function onRefresh() {
    loadOnce(limit);
  }

  return (
    <div className="card">
      <h1 style={{ marginTop: 0 }}>Audit Events</h1>
      <p className="muted" style={{ marginTop: 6 }}>
        Read-only. Deterministic ordering as returned by the Worker. No polling.
      </p>

      <hr />

      <div className="row" style={{ alignItems: "stretch" }}>
        <div style={{ minWidth: 220 }}>
          <div className="muted" style={{ fontSize: 12 }}>
            Limit (1–2000)
          </div>
          <input
            className="input"
            value={String(limit)}
            onChange={(e) => setLimit(Number(e.target.value))}
            placeholder="500"
          />
        </div>

        <button className="button" onClick={onApplyLimit} disabled={!limitIsValid || loading}>
          Apply
        </button>

        <button className="button secondary" onClick={onRefresh} disabled={loading}>
          Refresh
        </button>

        <div className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>
          returned: {pageInfo?.returned ?? rows.length} / limit: {pageInfo?.limit ?? limit}
        </div>
      </div>

      {!limitIsValid ? (
        <p className="muted" style={{ marginTop: 10 }}>
          Invalid limit. Must be an integer between 1 and 2000.
        </p>
      ) : null}

      {loading ? (
        <p className="muted" style={{ marginTop: 10 }}>
          Loading…
        </p>
      ) : null}

      {err ? (
        <pre
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 12,
            border: "1px solid #fecaca",
            background: "#fef2f2",
            overflowX: "auto",
            fontSize: 12,
          }}
        >
{JSON.stringify(
  {
    ok: false,
    status: err?.status ?? null,
    code: err?.code ?? null,
    error: err?.error ?? null,
    details: err?.details ?? null,
    requestId: err?.requestId ?? null,
  },
  null,
  2
)}
        </pre>
      ) : null}

      <hr />

      <div className="row" style={{ alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 520 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            Events (click a row to inspect)
          </div>

          <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "190px 160px 160px 1fr",
                gap: 0,
                padding: "10px 12px",
                borderBottom: "1px solid #e5e7eb",
                background: "#f9fafb",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              <div>createdAtUtc</div>
              <div>eventType</div>
              <div>reasonCode</div>
              <div>objectId</div>
            </div>

            {rows.length === 0 ? (
              <div style={{ padding: 12 }} className="muted">
                No events returned.
              </div>
            ) : (
              rows.map((r, idx) => {
                const createdAtUtc = r?.createdAtUtc ?? null;
                const eventType = r?.eventType ?? r?.type ?? null;
                const reasonCode = r?.reasonCode ?? null;
                const objectId = r?.objectId ?? null;

                const isSel = selected === idx;

                return (
                  <button
                    key={String(r?.auditEventId ?? idx)}
                    onClick={() => setSelected(idx)}
                    className="button secondary"
                    style={{
                      width: "100%",
                      border: "none",
                      borderTop: idx === 0 ? "none" : "1px solid #e5e7eb",
                      borderRadius: 0,
                      textAlign: "left",
                      padding: "10px 12px",
                      background: isSel ? "#eef2ff" : "#fff",
                      color: "#111827",
                      cursor: "pointer",
                      display: "grid",
                      gridTemplateColumns: "190px 160px 160px 1fr",
                      gap: 0,
                      fontSize: 12,
                    }}
                    title="Select to view full JSON"
                  >
                    <div>{clip(fmtTs(createdAtUtc), 26)}</div>
                    <div>{clip(eventType, 22)}</div>
                    <div>{clip(reasonCode, 22)}</div>
                    <div>{clip(objectId, 60)}</div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 360 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            Selected event JSON
          </div>

          <pre
            style={{
              margin: 0,
              padding: 12,
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              background: "#f9fafb",
              overflowX: "auto",
              fontSize: 12,
              minHeight: 240,
            }}
          >
{selected === null ? "Select an event to inspect." : JSON.stringify(rows[selected], null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}
