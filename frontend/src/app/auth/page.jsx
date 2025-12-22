"use client";

import { useEffect, useMemo, useState } from "react";
import { asoraGetJson } from "@/lib/asoraFetch";
import {
  clearBearerToken,
  clearDevToken,
  getAuthMode,
  getBearerToken,
  getDevToken,
  setBearerToken,
  setDevToken,
} from "@/lib/authStorage";

export const runtime = "edge";

function masked(token) {
  const t = String(token || "");
  if (t.length <= 10) return t ? "********" : "";
  return `${t.slice(0, 6)}…${t.slice(-4)}`;
}

export default function AuthPage() {
  const [mode, setMode] = useState("UNAUTH");

  const [bearerInput, setBearerInput] = useState("");
  const [devInput, setDevInput] = useState("");

  const [storedBearer, setStoredBearer] = useState("");
  const [storedDev, setStoredDev] = useState("");

  const [probe, setProbe] = useState({ status: "idle", result: null, error: null });

  useEffect(() => {
    // Deterministic: read once.
    const b = getBearerToken();
    const d = getDevToken();
    setStoredBearer(b);
    setStoredDev(d);
    setMode(getAuthMode());
  }, []);

  const canUseDev = useMemo(() => !storedBearer, [storedBearer]);

  async function doProbe() {
    setProbe({ status: "loading", result: null, error: null });
    try {
      const r = await asoraGetJson("/api/auth/me");
      setProbe({ status: "ok", result: r, error: null });
    } catch (e) {
      setProbe({ status: "error", result: null, error: e });
    }
  }

  function refreshStored() {
    const b = getBearerToken();
    const d = getDevToken();
    setStoredBearer(b);
    setStoredDev(d);
    setMode(getAuthMode());
  }

  function onSetBearer() {
    setBearerToken(bearerInput);
    setBearerInput("");
    refreshStored();
  }

  function onClearBearer() {
    clearBearerToken();
    refreshStored();
  }

  function onSetDev() {
    setDevToken(devInput);
    setDevInput("");
    refreshStored();
  }

  function onClearDev() {
    clearDevToken();
    refreshStored();
  }

  return (
    <div className="card">
      <h1 style={{ marginTop: 0 }}>Auth</h1>
      <p className="muted" style={{ marginTop: 6 }}>
        Bearer supersedes dev_token. Missing auth fails closed.
      </p>

      <hr />

      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <div className="muted" style={{ fontSize: 12 }}>
            Current mode
          </div>
          <div style={{ fontWeight: 700, marginTop: 4 }}>{mode}</div>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          Stored Bearer: {storedBearer ? masked(storedBearer) : "—"} <br />
          Stored dev_token: {storedDev ? masked(storedDev) : "—"}
        </div>
      </div>

      <hr />

      <h2 style={{ margin: "0 0 8px 0", fontSize: 16 }}>Set Bearer Token</h2>
      <div className="row" style={{ alignItems: "stretch" }}>
        <input
          className="input"
          value={bearerInput}
          onChange={(e) => setBearerInput(e.target.value)}
          placeholder="Paste Bearer token (no 'Bearer ' prefix)"
        />
        <button className="button" onClick={onSetBearer} disabled={!bearerInput.trim()}>
          Save Bearer
        </button>
        <button className="button danger" onClick={onClearBearer} disabled={!storedBearer}>
          Clear Bearer
        </button>
      </div>

      <p className="muted" style={{ marginTop: 10 }}>
        Saving a Bearer token automatically removes dev_token from storage.
      </p>

      <hr />

      <h2 style={{ margin: "0 0 8px 0", fontSize: 16 }}>Legacy dev_token (Deprecated)</h2>
      <div className="row" style={{ alignItems: "stretch" }}>
        <input
          className="input"
          value={devInput}
          onChange={(e) => setDevInput(e.target.value)}
          placeholder="tenant:<tenantId>"
          disabled={!canUseDev}
        />
        <button className="button secondary" onClick={onSetDev} disabled={!canUseDev || !devInput.trim()}>
          Save dev_token
        </button>
        <button className="button danger" onClick={onClearDev} disabled={!storedDev}>
          Clear dev_token
        </button>
      </div>

      {!canUseDev ? (
        <p className="muted" style={{ marginTop: 10 }}>
          dev_token is suppressed because a Bearer token is present.
        </p>
      ) : (
        <p className="muted" style={{ marginTop: 10 }}>
          dev_token is appended as a query param on requests when Bearer is absent.
        </p>
      )}

      <hr />

      <h2 style={{ margin: "0 0 8px 0", fontSize: 16 }}>Validate Session</h2>
      <div className="row">
        <button className="button" onClick={doProbe}>
          Call /api/auth/me
        </button>
        <span className="muted" style={{ fontSize: 12 }}>
          No polling. One-shot operator probe.
        </span>
      </div>

      {probe.status === "loading" ? (
        <p className="muted" style={{ marginTop: 10 }}>
          Probing…
        </p>
      ) : null}

      {probe.status === "ok" ? (
        <pre
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 12,
            border: "1px solid #e5e7eb",
            background: "#f9fafb",
            overflowX: "auto",
            fontSize: 12,
          }}
        >
{JSON.stringify(probe.result, null, 2)}
        </pre>
      ) : null}

      {probe.status === "error" ? (
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
    status: probe.error?.status ?? null,
    code: probe.error?.code ?? null,
    error: probe.error?.error ?? null,
    details: probe.error?.details ?? null,
    requestId: probe.error?.requestId ?? null,
  },
  null,
  2
)}
        </pre>
      ) : null}
    </div>
  );
}
