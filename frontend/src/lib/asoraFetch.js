import { getBearerToken, getDevToken } from "./authStorage";

const SESSION_DENIAL_KEY = "asora_session:denial_v1";

/**
 * UI fetch helper.
 * - Calls same-origin /api/*
 * - Attaches Authorization: Bearer <token> when present
 * - Else appends dev_token query param for legacy compat
 * - Fail-closed: throws on non-2xx with a stable error shape
 *
 * U15-6:
 * - Emits a deterministic session denial event on 401/403
 * - Stores a tab-scoped snapshot in sessionStorage
 */

function withDevToken(url) {
  const dev = getDevToken();
  if (!dev) return url;

  const u = new URL(url, window.location.origin);
  u.searchParams.set("dev_token", dev);
  return u.toString();
}

function getHeaders() {
  const h = new Headers();
  const bearer = getBearerToken();
  if (bearer) {
    h.set("Authorization", `Bearer ${bearer}`);
  }
  h.set("Accept", "application/json");
  return h;
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

function safeReadSessionDenial() {
  try {
    const raw = sessionStorage.getItem(SESSION_DENIAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function emitSessionDenied(payload) {
  // Persist then emit. Deterministic shape.
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
  return safeReadSessionDenial();
}

export async function asoraGetJson(path) {
  // path must be /api/...
  const url = typeof window !== "undefined" ? withDevToken(path) : path;

  const res = await fetch(url, {
    method: "GET",
    headers: getHeaders(),
    cache: "no-store",
  });

  const requestId = res.headers.get("X-Request-Id") || null;

  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
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

    // U15-6: session expiry UX signal
    if (res.status === 401 || res.status === 403) {
      emitSessionDenied({
        status: res.status,
        code: err.code,
        path,
        requestId,
      });
    }

    throw err;
  }

  return body;
}
