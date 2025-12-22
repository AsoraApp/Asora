const KEY_BEARER = "asora_auth:bearer";
const KEY_DEV = "asora_auth:dev_token";

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
    // Bearer supersedes dev_token
    localStorage.removeItem(KEY_DEV);
    emitAuthChanged();
  } catch {
    // fail-closed: no-op
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

export function getDevToken() {
  try {
    // Only meaningful if Bearer does not exist.
    const bearer = getBearerToken();
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
    // Only store if Bearer absent.
    const bearer = getBearerToken();
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
  const bearer = getBearerToken();
  if (bearer) return "BEARER";
  const dev = getDevToken();
  if (dev) return "DEV";
  return "UNAUTH";
}
