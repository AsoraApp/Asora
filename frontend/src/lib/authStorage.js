const KEY_BEARER = "asora_auth:bearer";
const KEY_DEV = "asora_auth:dev_token";

/**
 * Bearer supersedes dev_token.
 * UI must fail-closed; these helpers do not validate, only store/read.
 */

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
  if (!t) {
    clearBearerToken();
    return;
  }
  try {
    localStorage.setItem(KEY_BEARER, t);
    // Supersedes dev_token.
    localStorage.removeItem(KEY_DEV);
  } catch {
    // fail-closed: no-op
  }
}

export function clearBearerToken() {
  try {
    localStorage.removeItem(KEY_BEARER);
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
      return;
    }
    if (!t) {
      localStorage.removeItem(KEY_DEV);
      return;
    }
    localStorage.setItem(KEY_DEV, t);
  } catch {
    // no-op
  }
}

export function clearDevToken() {
  try {
    localStorage.removeItem(KEY_DEV);
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
