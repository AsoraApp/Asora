// frontend/src/lib/authStorage.js

const KEY_BEARER = "asora_auth:bearer";

function emitAuthChanged() {
  try {
    window.dispatchEvent(new Event("asora:auth-changed"));
  } catch {
    // no-op
  }
}

export function getBearerToken() {
  try {
    const v = localStorage.getItem(KEY_BEARER);
    return v ? String(v) : "";
  } catch {
    return "";
  }
}

export function setBearerToken(token) {
  const t = String(token || "").trim();
  try {
    if (!t) {
      localStorage.removeItem(KEY_BEARER);
      emitAuthChanged();
      return;
    }
    localStorage.setItem(KEY_BEARER, t);
    emitAuthChanged();
  } catch {
    // no-op
  }
}

export function clearBearerToken() {
  try {
    localStorage.removeItem(KEY_BEARER);
    emitAuthChanged();
  } catch {
    // no-op
  }
}

export function getAuthMode() {
  const bearer = getBearerToken();
  if (bearer) return "BEARER";
  return "UNAUTH";
}
