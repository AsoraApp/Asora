// frontend/src/lib/asoraFetch.js
// U20: Same-origin /api helper with:
// - Authorization: Bearer <accessToken> (memory only)
// - Auto-refresh via POST /api/auth/refresh when missing/expired
// - Refresh requires X-Asora-Tenant (fail-closed) until U20-B improves it
//
// NOTE: dev_token compatibility remains for non-prod workflows.

import { getAccessToken, setAccessToken, clearAccessToken, getDevToken } from "./authStorage";

const SESSION_DENIAL_KEY = "asora_session:denial_v1";

function withDevToken(url) {
  const dev = getDevToken();
  if (!dev) return url;

  const u = new URL(url, window.location.origin);
  u.searchParams.set("dev_token", dev);
  return u.toString();
}

function nowIso() {
  try {
    return new Date().toISOString();
  } catch {
    return null;
  }
}

function safeWriteSessionDenial(payload) {
  try {
    sessionStorage.setItem(SESSION_DENIAL_KEY, JSON.stringify(payload));
  } catch {
    // no-op
  }
}

function emitSessionDenied(payload) {
  const p = {
    kind: "SESSION_DENIED",
    atUtc: nowIso(),
    status: payload?.status ?? null,
    code: payload?.code ?? null,
    path: payload?.path ?? null,
    requestId: payload?.requestId ?? null,
  };

  safeWriteSessionDenial(p);

  try {
    window.dispatchEvent(new CustomEvent("asora:session-denied", { detail: p }));
  } catch {
    // no-op
  }
}

export function readLastSessionDenial() {
  try {
    const raw = sessionStorage.getItem(SESSION_DENIAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function getHeaders(extra) {
  const h = new Headers(extra || {});
  const bearer = getAccessToken();
  if (bearer) h.set("Authorization", `Bearer ${bearer}`);
  h.set("Accept", "application/json");
  return h;
}

async function safeJson(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function refreshAccessToken(tenantHint) {
  const h = new Headers();
  h.set("Content-Type", "application/json");
  if (tenantHint) h.set("X-Asora-Tenant", String(tenantHint));

  const res = await fetch("/api/auth/refresh", { method: "POST", headers: h, cache: "no-store" });
  const requestId = res.headers.get("X-Request-Id") || null;
  const body = await safeJson(res);

  if (!res.ok) {
    clearAccessToken();
    emitSessionDenied({ status: res.status, code: body?.code || body?.error || "REFRESH_FAILED", path: "/api/auth/refresh", requestId });
    throw { ok: false, status: res.status, code: body?.code || "REFRESH_FAILED", error: body?.error || "UNAUTHORIZED", details: body?.details ?? null, requestId };
  }

  const token = body?.accessToken ? String(body.accessToken) : "";
  if (!token) throw { ok: false, status: 500, code: "REFRESH_NO_TOKEN", error: "INTERNAL_ERROR", details: null, requestId };

  setAccessToken(token);
  return body;
}

export async function asoraGetJson(path, opts = {}) {
  const url = typeof window !== "undefined" ? withDevToken(path) : path;

  // First attempt
  let res = await fetch(url, { method: "GET", headers: getHeaders(opts.headers), cache: "no-store" });
  let requestId = res.headers.get("X-Request-Id") || null;
  let body = await safeJson(res);

  // If unauthorized and we have refresh cookie, attempt refresh then retry once.
  if ((res.status === 401 || res.status === 403) && !getDevToken()) {
    try {
      // tenant hint can come from last-known value if caller provides it; otherwise refresh will fail-closed until U20-B.
      await refreshAccessToken(opts.tenantId || "");
      res = await fetch(url, { method: "GET", headers: getHeaders(opts.headers), cache: "no-store" });
      requestId = res.headers.get("X-Request-Id") || null;
      body = await safeJson(res);
    } catch (e) {
      // refresh already emitted sessionDenied
      throw e;
    }
  }

  if (!res.ok) {
    const err = {
      ok: false,
      status: res.status,
      code: body?.code || body?.error || "HTTP_ERROR",
      error: body?.error || "HTTP_ERROR",
      details: body?.details ?? null,
      requestId,
    };

    if (res.status === 401 || res.status === 403) {
      emitSessionDenied({ status: res.status, code: err.code, path, requestId });
    }

    throw err;
  }

  return body;
}
