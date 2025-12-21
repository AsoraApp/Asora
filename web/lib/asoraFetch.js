// web/lib/asoraFetch.js
import { getBaseUrl } from "@/lib/env";

const DEV_TOKEN_STORAGE_KEY = "asora_dev_token";
const BEARER_STORAGE_KEY = "asora_auth:bearer";

/**
 * Read dev_token from localStorage (client-only).
 * Safe no-op on server/edge render.
 */
export function getStoredDevToken() {
  try {
    if (typeof window === "undefined" || !window?.localStorage) return "";
    return window.localStorage.getItem(DEV_TOKEN_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

/**
 * Persist dev_token to localStorage (client-only).
 * Safe no-op on server/edge render.
 */
export function setStoredDevToken(token) {
  try {
    if (typeof window === "undefined" || !window?.localStorage) return;
    const t = (token || "").trim();
    if (!t) {
      window.localStorage.removeItem(DEV_TOKEN_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(DEV_TOKEN_STORAGE_KEY, t);
  } catch {
    // ignore
  }
}

/**
 * Read Bearer token from localStorage (client-only).
 * Safe no-op on server/edge render.
 */
export function getStoredBearerToken() {
  try {
    if (typeof window === "undefined" || !window?.localStorage) return "";
    return window.localStorage.getItem(BEARER_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

/**
 * Persist Bearer token to localStorage (client-only).
 * Safe no-op on server/edge render.
 */
export function setStoredBearerToken(token) {
  try {
    if (typeof window === "undefined" || !window?.localStorage) return;
    const t = (token || "").trim();
    if (!t) {
      window.localStorage.removeItem(BEARER_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(BEARER_STORAGE_KEY, t);
  } catch {
    // ignore
  }
}

/**
 * Clear all local auth state (client-only).
 */
export function clearStoredAuth() {
  try {
    if (typeof window === "undefined" || !window?.localStorage) return;
    window.localStorage.removeItem(BEARER_STORAGE_KEY);
    window.localStorage.removeItem(DEV_TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Normalize UI paths to enterprise-safe API routing.
 *
 * Rule:
 * - UI code may call "/v1/*" (legacy).
 * - We rewrite it to "/api/v1/*" so Pages Functions can proxy same-origin.
 * - If caller already uses "/api/*", we keep it.
 */
function normalizePath(path) {
  const p = String(path || "");
  if (!p.startsWith("/")) return `/${p}`;
  if (p.startsWith("/api/")) return p;
  if (p === "/api") return "/api";
  if (p.startsWith("/v1/")) return `/api${p}`; // "/v1/..." -> "/api/v1/..."
  if (p === "/v1") return "/api/v1";
  return p;
}

/**
 * Build an absolute URL against configured base URL.
 *
 * AUTH RULES (U14 authoritative):
 * 1) If Bearer exists, DO NOT attach dev_token query param.
 * 2) Else if dev_token exists, attach dev_token query param (legacy bridge).
 * 3) Else, no auth.
 */
export function buildUrl(path, params) {
  const base = getBaseUrl();
  const normalizedPath = normalizePath(path);
  const u = new URL(normalizedPath, base);

  // Shallow copy so we can safely inject params without mutating caller object
  const merged = params && typeof params === "object" ? { ...params } : {};

  const bearer = getStoredBearerToken();
  if (bearer) {
    // Rule #1: Bearer present => never attach dev_token.
    if (merged.dev_token !== undefined) delete merged.dev_token;
  } else {
    // Rule #2: No Bearer => inject dev_token from localStorage if caller didn't provide one.
    if (merged.dev_token === undefined || merged.dev_token === null || merged.dev_token === "") {
      const stored = getStoredDevToken();
      if (stored) merged.dev_token = stored;
    }
  }

  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined || v === null || v === "") continue;
    u.searchParams.set(k, String(v));
  }

  return u.toString();
}

function buildAuthHeaders(extraHeaders) {
  const h = new Headers(extraHeaders || {});
  const bearer = getStoredBearerToken();
  if (bearer) {
    h.set("Authorization", `Bearer ${bearer}`);
  }
  return h;
}

async function readJsonBodyOrNull(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function asoraGetJson(path, params) {
  const url = buildUrl(path, params);
  const res = await fetch(url, {
    method: "GET",
    headers: buildAuthHeaders(),
    cache: "no-store",
  });

  const json = await readJsonBodyOrNull(res);

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      url,
      error: json?.error || "HTTP_ERROR",
      code: json?.code || "HTTP_ERROR",
      details: json?.details ?? json ?? null,
    };
  }

  return { ok: true, status: res.status, url, data: json };
}

/**
 * Minimal POST JSON helper for browser-only flows (U14 exchange, etc.).
 */
export async function asoraPostJson(path, body, params) {
  const url = buildUrl(path, params);

  const res = await fetch(url, {
    method: "POST",
    headers: buildAuthHeaders({ "Content-Type": "application/json; charset=utf-8" }),
    cache: "no-store",
    body: body === undefined ? "" : JSON.stringify(body),
  });

  const json = await readJsonBodyOrNull(res);

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      url,
      error: json?.error || "HTTP_ERROR",
      code: json?.code || "HTTP_ERROR",
      details: json?.details ?? json ?? null,
    };
  }

  return { ok: true, status: res.status, url, data: json };
}
