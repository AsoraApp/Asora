import { getBearerToken, getDevToken } from "./authStorage";

/**
 * UI fetch helper.
 * - Calls same-origin /api/*
 * - Attaches Authorization: Bearer <token> when present
 * - Else appends dev_token query param for legacy compat
 * - Fail-closed: throws on non-2xx with a stable error shape
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

export async function asoraGetJson(path) {
  // path must be /api/...
  const url = typeof window !== "undefined" ? withDevToken(path) : path;

  const res = await fetch(url, {
    method: "GET",
    headers: getHeaders(),
    cache: "no-store",
  });

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
      requestId: res.headers.get("X-Request-Id") || null,
    };
    throw err;
  }

  return body;
}
