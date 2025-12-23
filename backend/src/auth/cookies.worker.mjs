// backend/src/auth/cookies.worker.mjs
// Hardened cookie helpers for session/PKCE/state.
// - HttpOnly, Secure, SameSite=Lax by default (works with OIDC redirects)
// - Deterministic serialization
// - No dependencies

export function parseCookieHeader(cookieHeader) {
  const out = {};
  const raw = String(cookieHeader || "").trim();
  if (!raw) return out;

  const parts = raw.split(";").map((s) => s.trim()).filter(Boolean);
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq <= 0) continue;
    const k = p.slice(0, eq).trim();
    const v = p.slice(eq + 1).trim();
    if (!k) continue;
    out[k] = v;
  }
  return out;
}

function attr(k, v) {
  if (v === true) return k;
  if (v === false || v === null || v === undefined) return "";
  return `${k}=${v}`;
}

export function makeSetCookie({
  name,
  value,
  maxAgeSec,
  path = "/",
  httpOnly = true,
  secure = true,
  sameSite = "Lax",
}) {
  const parts = [];
  parts.push(`${name}=${value}`);
  if (typeof maxAgeSec === "number") parts.push(attr("Max-Age", String(Math.max(0, Math.floor(maxAgeSec)))));
  if (path) parts.push(attr("Path", path));
  if (secure) parts.push("Secure");
  if (httpOnly) parts.push("HttpOnly");
  if (sameSite) parts.push(attr("SameSite", sameSite));
  return parts.filter(Boolean).join("; ");
}

export function expireCookie({ name, path = "/" }) {
  // deterministic expiry
  return `${name}=; Max-Age=0; Path=${path}; Secure; HttpOnly; SameSite=Lax`;
}
