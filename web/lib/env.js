// web/lib/env.js

function trimSlash(s) {
  return String(s || "").replace(/\/+$/g, "");
}

/**
 * Base API origin for the UI.
 *
 * Priority:
 *  1) NEXT_PUBLIC_ASORA_API_BASE (set in Cloudflare Pages env vars)
 *  2) window.__ASORA_API_BASE (optional escape hatch)
 *  3) default hard-coded Worker dev host
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

  // 3) Default (your current Worker dev URL)
  return "https://asora-ui.dblair1027.workers.dev";
}
