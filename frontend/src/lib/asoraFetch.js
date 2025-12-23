// frontend/src/lib/asoraFetch.js

import { getBearerToken, setBearerToken, clearBearerToken } from "./authStorage";

const SESSION_DENIAL_KEY = "asora_session:denial_v1";

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

async function refreshAccessToken() {
  const res = await fetch("/api/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // cookies are same-origin; browser includes them automatically
    body: JSON.stringify({}),
  });

  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!res.ok || !body?.ok || !body?.accessToken) {
    clearBearerToken();
    return false;
  }

  setBearerToken(body.accessToken);
  return true;
}

function getHeaders() {
  const h = new Headers();
  const bearer = getBearerToken();
  if (bearer) h.set("Authorization", `Bearer ${bearer}`);
  h.set("Accept", "application/json");
  return h;
}

export async function asoraGetJson(path) {
  const doFetch = async () => {
    const res = await fetch(path, { method: "GET", headers: getHeaders(), cache: "no-store" });
    const requestId = res.headers.get("X-Request-Id") || null;

    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }

    return { res, body, requestId };
  };

  let { res, body, requestId } = await doFetch();

  // If unauthorized, attempt one refresh rotation then retry once.
  if (res.status === 401 || res.status === 403) {
    const ok = await refreshAccessToken();
    if (ok) {
      ({ res, body, requestId } = await doFetch());
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
