import { getBaseUrl } from "@/lib/env";

export function buildUrl(path, params) {
  const base = getBaseUrl();
  const u = new URL(path, base);
  if (params && typeof params === "object") {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === "") continue;
      u.searchParams.set(k, String(v));
    }
  }
  return u.toString();
}

export async function asoraGetJson(path, params) {
  const url = buildUrl(path, params);
  const res = await fetch(url, {
    method: "GET",
    // Prevent Next from caching during U1 so responses reflect live state deterministically.
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
