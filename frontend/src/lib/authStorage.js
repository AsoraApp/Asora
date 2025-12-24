// frontend/src/lib/authStorage.js
// U20: Single source of truth for browser-held access token (short-lived).
// - Refresh token is HttpOnly cookie, not accessible here.
// - Access token is stored in sessionStorage and applied to /api calls.
// - Emits "asora:auth-changed" for deterministic UI refresh.

const KEY = "asora_auth:bearer_v1";

function safeDispatchAuthChanged() {
  try {
    window.dispatchEvent(new CustomEvent("asora:auth-changed", { detail: { at: Date.now() } }));
  } catch {
    // no-op
  }
}

export function getBearerToken() {
  try {
    return sessionStorage.getItem(KEY) || null;
  } catch {
    return null;
  }
}

export function setBearerToken(token) {
  try {
    const t = String(token || "").trim();
    if (!t) return;
    sessionStorage.setItem(KEY, t);
    safeDispatchAuthChanged();
  } catch {
    // no-op
  }
}

export function clearBearerToken() {
  try {
    sessionStorage.removeItem(KEY);
    safeDispatchAuthChanged();
  } catch {
    // no-op
  }
}

// Back-compat aliases used in some UI code paths:
export function setAccessToken(token) {
  return setBearerToken(token);
}
export function getAccessToken() {
  return getBearerToken();
}
export function clearAccessToken() {
  return clearBearerToken();
}

// Mode indicator used by AdminHeader / SessionBanner
export function getAuthMode() {
  const t = getBearerToken();
  if (t) return "BEARER";
  return "UNAUTH";
}
