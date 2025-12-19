import { getBaseUrl } from "@/lib/env";

const DEV_TOKEN_STORAGE_KEY = "asora_dev_token";

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

export function buildUrl(path, params) {
  const base = getBaseUrl();
  const u = new URL(path, base);

  // Shallow copy so we can safely inject dev_token without mutating caller object
  const merged = params && typeof params === "object" ? { ...params } : {};

  // If caller didn't provide dev_token, inject from localStorage when available (client-only).
  if (
    merged.dev_token === undefined ||
    merged.dev_token === null ||
    merged.dev_token === ""
  ) {
    const stored = getStoredDevToken();
    if (stored) merged.dev_token = stored;
  }

  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined || v === null || v === "") continue;
    u.searchParams.set(k, String(v));
  }

  return u.toString();
}

export async function asoraGetJson(path, params) {
  const url = buildUrl(path, params);
  const res = await fetch(url, {
    method: "GET",
    // Prevent Next from caching so responses reflect live state deterministically.
    cache: "no-store"
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      url,
      error: json?.error || "HTTP_ERROR",
      code: json?.code || "HTTP_ERROR",
      details: json?.details ?? json ?? text ?? null
    };
  }

  return { ok: true, status: res.status, url, data: json };
}
