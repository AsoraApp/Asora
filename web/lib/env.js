// web/lib/env.js

function trimSlash(s) {
  return String(s || "").replace(/\/+$/g, "");
}

/**
 * Base API origin for the UI.
 *
 * Enterprise default (U14):
 * - Prefer SAME-ORIGIN requests (Pages) to avoid CORS and keep a stable contract.
 * - Only use a cross-origin Worker base if explicitly configured.
 *
 * Priority:
 *  1) NEXT_PUBLIC_ASORA_API_BASE (optional override)
 *  2) window.__ASORA_API_BASE (optional escape hatch)
 *  3) window.location.origin (same-origin default)
 *  4) fallback hard-coded Worker dev host (last resort)
 */
export function getBaseUrl() {
  // 1) Build-time env (Next public env)
  const fromEnv =
    (typeof process !== "undefined" && process?.env && process.env.NEXT_PUBLIC_ASORA_API_BASE) || "";
  if (fromEnv) return trimSlash(fromEnv);

  // 2) Runtime override
  if (typeof window !== "undefined" && window && window.__ASORA_API_BASE) {
    return trimSlash(window.__ASORA_API_BASE);
  }

  // 3) Same-origin default (best long-term: no CORS, stable contract)
  if (typeof window !== "undefined" && window?.location?.origin) {
    return trimSlash(window.location.origin);
  }

  // 4) Fallback (should not be used for Pages runtime)
  return "https://asora-ui.dblair1027.workers.dev";
}
