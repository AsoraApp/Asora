// frontend/src/lib/authStorage.js
// U20: Token storage changes
// - Access token: in-memory only (no localStorage)
// - Refresh cookie: HttpOnly; not accessible to JS
// - Dev token: preserved for non-prod only (optional), but bearer supersedes it

const KEY_DEV = "asora_auth:dev_token";

let __accessToken = ""; // memory only

function emitAuthChanged() {
  try {
    window.dispatchEvent(new Event("asora:auth-changed"));
  } catch {
    // no-op
  }
}

export function getAccessToken() {
  return __accessToken || "";
}

export function setAccessToken(token) {
  const t = String(token || "").trim();
  __accessToken = t;
  if (t) {
    // Bearer supersedes dev token
    try {
      localStorage.removeItem(KEY_DEV);
    } catch {
      // no-op
    }
  }
  emitAuthChanged();
}

export function clearAccessToken() {
  __accessToken = "";
  emitAuthChanged();
}

export function getDevToken() {
  try {
    // Only meaningful if no access token exists
    const bearer = getAccessToken();
    if (bearer) return "";
    const v = localStorage.getItem(KEY_DEV);
    return v ? String(v) : "";
  } catch {
    return "";
  }
}

export function setDevToken(devToken) {
  const t = String(devToken || "").trim();
  try {
    const bearer = getAccessToken();
    if (bearer) {
      localStorage.removeItem(KEY_DEV);
      emitAuthChanged();
      return;
    }
    if (!t) {
      localStorage.removeItem(KEY_DEV);
      emitAuthChanged();
      return;
    }
    localStorage.setItem(KEY_DEV, t);
    emitAuthChanged();
  } catch {
    // no-op
  }
}

export function clearDevToken() {
  try {
    localStorage.removeItem(KEY_DEV);
    emitAuthChanged();
  } catch {
    // no-op
  }
}

export function getAuthMode() {
  const bearer = getAccessToken();
  if (bearer) return "BEARER";
  const dev = getDevToken();
  if (dev) return "DEV";
  return "UNAUTH";
}
