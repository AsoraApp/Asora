"use client";

import { useEffect, useMemo, useState } from "react";
import { asoraGetJson } from "@/lib/asoraFetch";

export const runtime = "edge";

const STORE_KEY = "asora_view:ledger_export:v1";

const DEFAULTS = {
  limit: 2000,
  order: "asc",
  itemId: "",
  includeHash: true,
};

function safeReadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? { ...fallback, ...parsed } : fallback;
  } catch {
    return fallback;
  }
}

function safeWriteJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // no-op
  }
}

function csvEscape(value) {
  const s = value === null || value === undefined ? "" : String(value);
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// Deterministic stringify: sorts object keys recursively.
function stableStringify(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);

  if (Array.isArray(value)) {
    return "[" + value.map((v) => stableStringify(v)).join(",") + "]";
  }

  const keys = Object.keys(value).sort();
  const parts = [];
  for (const k of keys) {
    parts.push(JSON.stringify(k) + ":" + stableStringify(value[k]));
  }
  return "{" + parts.join(",") + "}";
}

function buildCsv(events) {
  // Fixed, stable columns. "eventJson" captures full deterministic representation.
  const cols = ["createdAtUtc", "ledgerEventId", "itemId", "hubId", "binId", "qtyDelta", "reasonCode", "eventJson"];

  const header = cols.map(csvEscape).join(",") + "\n";

  const lines = events.map((e) => {
    const row = {
      createdAtUtc: e?.createdAtUtc ?? "",
      ledgerEventId: e?.ledgerEventId ?? "",
      itemId: e?.itemId ?? "",
      hubId: e?.hubId ?? "",
      binId: e?.binId ?? "",
      qtyDelta: e?.qtyDelta ?? "",
      reasonCode: e?.reasonCode ?? "",
      eventJson: stableStringify(e ?? null),
    };

    return cols.map((c) => csvEscape(row[c])).join(",");
  });

  return header + lines.join("\n") + (lines.length ? "\n" : "");
}

async function sha256Hex(text) {
  const enc = new TextEncoder();
  const bytes = enc.encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function isoForFilename() {
  try {
    return new Date().toISOString().replace(/[:]/g, "-");
  } catch {
    return "unknown-time";
  }
}

export default function LedgerExportPage() {
  const [form, setForm] = useState(DEFAULTS);
  const [loading, setLoading] = useState(false);

  const [result, setResult] = useState({
    events: [],
    csv: "",
    csvBytes: 0,
    hash: null,
    page: null,
  });

  const [err, setErr] = useState(null);

  const limitOk = useMemo(() => Number.isInteger(form.limit) && form.limit > 0 && form.limit <= 2000, [form.limit]);
  const orderOk = useMemo(() => form.order === "asc" || form.order === "desc", [form.order]);

  useEffect(() => {
    const saved = safeReadJson(STORE_KEY, DEFAULTS);
    // normalize types
    const next = {
      limit: Number(saved.limit) || DEFAULTS.limit,
      order: saved.order === "desc" ? "desc" : "asc",
      itemId: saved.itemId ? String(saved.itemId) : "",
      includeHash: saved.includeHash !== false,
    };
    setForm(next);
  }, []);

  async function runExport() {
    setErr(null);

    if (!limitOk || !orderOk) {
      setErr({
        ok: false,
        status: 400,
        code: "INVALID_EXPORT_PARAMS",
        error: "BAD_REQUEST",
        details: { limit: form.limit, order: form.order },
        requestId: null,
      });
      return;
    }

    safeWriteJson(STORE_KEY, form);

    setLoading(true);
    setResult({ events: [], csv: "", csvBytes: 0, hash: null, page: null });

    try {
      const qs = new URLSearchParams();
      qs.set("limit", String(form.limit));
      qs.set("order", form.order);
      if (form.itemId && String(form.itemId).trim()) qs.set("itemId", String(form.itemId).trim());

      const r = await asoraGetJson(`/api/ledger/events?${qs.toString()}`);
      const events = Array.isArray(r?.events) ? r.events : [];

      // Deterministic CSV from returned order. No re-sorting in UI.
      const csv = buildCsv(events);

      let hash = null;
      if (form.includeHash) {
        hash = await sha256Hex(csv);
      }

      const bytes = new TextEncoder().encode(csv).byteLength;

      setResult({
        events,
        csv,
        csvBytes: bytes,
        hash,
        page: r?.page || null,
      });

      setLoading(false);
    } catch (e) {
      setLoading(false);
      setErr(e || { ok: false, status: null, code: "HTTP_ERROR", error: "HTTP_ERROR", details: null, requestId: null });
    }
  }

  function onDownload() {
    if (!result.csv) return;

    const ts = isoForFilename();
    const base = form.itemId ? `asora-ledger-${form.itemId}-${ts}` : `asora-ledger-${ts}`;
    const name = result.hash ? `${base}-sha256_${result.hash.slice(0, 12)}.csv` : `${base}.csv`;
    downloadText(name, result.csv);
  }

  return (
    <div className="card">
      <h1 style={{ marginTop: 0 }}>Ledger Export</h1>
      <p className="muted" style={{ marginTop: 6 }}>
        Deterministic CSV export from <code>/api/ledger/events</code>. Optional SHA-256 hash for evidence integrity. No
        polling.
      </p>

      <hr />

      <div className="row" style={{ alignItems: "stretch" }}>
        <div style={{ minWidth: 160 }}>
          <div className="muted" style={{ fontSize: 12 }}>Limit (1–2000)</div>
          <input
            className="input"
            value={String(form.limit)}
            onChange={(e) => setForm((f) => ({ ...f, limit: Number(e.target.value) }))}
            placeholder="2000"
          />
        </div>

        <div style={{ minWidth: 140 }}>
          <div className="muted" style={{ fontSize: 12 }}>Order</div>
          <select
            className="input"
            value={form.order}
            onChange={(e) => setForm((f) => ({ ...f, order: e.target.value === "desc" ? "desc" : "asc" }))}
          >
            <option value="asc">asc (replay-friendly)</option>
            <option value="desc">desc</option>
          </select>
        </div>

        <div style={{ flex: 1, minWidth: 240 }}>
          <div className="muted" style={{ fontSize: 12 }}>Optional itemId filter</div>
          <input
            className="input"
            value={form.itemId}
            onChange={(e) => setForm((f) => ({ ...f, itemId: e.target.value }))}
            placeholder="item-123 (optional)"
          />
        </div>

        <div style={{ minWidth: 170, display: "flex", alignItems: "center", gap: 8 }}>
          <input
            id="hash"
            type="checkbox"
            checked={form.includeHash}
            onChange={(e) => setForm((f) => ({ ...f, includeHash: e.target.checked }))}
          />
          <label htmlFor="hash" className="muted" style={{ fontSize: 12 }}>
            Include SHA-256 hash
          </label>
        </div>

        <button className="button" onClick={runExport} disabled={loading}>
          {loading ? "Exporting…" : "Run Export"}
        </button>
      </div>

      {!limitOk || !orderOk ? (
        <p className="muted" style={{ marginTop: 10 }}>
          Invalid export parameters. Limit must be 1–2000 and order must be asc/desc.
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

      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="muted" style={{ fontSize: 12 }}>
          returned: {result.page?.returned ?? result.events.length} / limit: {result.page?.limit ?? form.limit}{" "}
          {result.csv ? `• csvBytes: ${result.csvBytes}` : ""}
        </div>

        <div className="row">
          <button className="button secondary" onClick={onDownload} disabled={!result.csv}>
            Download CSV
          </button>
        </div>
      </div>

      {result.hash ? (
        <div style={{ marginTop: 12 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
            SHA-256 (CSV bytes)
          </div>
          <div
            style={{
              padding: 10,
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              background: "#f9fafb",
              fontSize: 12,
              overflowX: "auto",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
            }}
          >
            {result.hash}
          </div>
        </div>
      ) : null}

      {result.csv ? (
        <div style={{ marginTop: 12 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
            Preview (first ~30 lines)
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
              maxHeight: 340,
            }}
          >
{result.csv.split("\n").slice(0, 31).join("\n")}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
